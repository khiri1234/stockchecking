// Security rule tests. Run from tests/: npm install && npm test
// (starts the Firestore emulator; needs Java 11+).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, addDoc, getDocs, serverTimestamp, query, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-stockcheck', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; } catch (e) { fail++; console.log('FAIL', name, e.message.split('\n')[0]); } }

const anon = env.unauthenticatedContext().firestore();
const alice = env.authenticatedContext('alice').firestore();   // first admin
const bob = env.authenticatedContext('bob').firestore();       // staff
const eve = env.authenticatedContext('eve').firestore();       // signed up via API, no users doc
const carl = env.authenticatedContext('carl').firestore();     // deactivated staff

// --- first-run setup ---
await t('meta/setup readable by anyone', assertSucceeds(getDoc(doc(anon, 'meta/setup'))));
await t('setup without meta/setup in batch fails', assertFails(setDoc(doc(alice, 'users/alice'), { username: 'alice', name: 'A', role: 'admin', active: true })));
{ const b = writeBatch(alice);
  b.set(doc(alice, 'users/alice'), { username: 'alice', name: 'Alice', role: 'admin', active: true });
  b.set(doc(alice, 'usernames/alice'), { uid: 'alice', email: 'a@x.com' });
  b.set(doc(alice, 'meta/setup'), { done: true, by: 'alice' });
  await t('setup batch succeeds', assertSucceeds(b.commit())); }
{ const b = writeBatch(eve);
  b.set(doc(eve, 'users/eve'), { username: 'eve', name: 'Eve', role: 'admin', active: true });
  b.set(doc(eve, 'meta/setup'), { done: true, by: 'eve' });
  await t('second setup blocked', assertFails(b.commit())); }
await t('eve cannot self-create users doc', assertFails(setDoc(doc(eve, 'users/eve'), { username: 'eve', name: 'Eve', role: 'staff', active: true })));

// --- admin creates staff ---
{ const b = writeBatch(alice);
  b.set(doc(alice, 'users/bob'), { username: 'bob', name: 'Bob', role: 'staff', active: true });
  b.set(doc(alice, 'usernames/bob'), { uid: 'bob', email: 'b@x.com' });
  b.set(doc(alice, 'users/carl'), { username: 'carl', name: 'Carl', role: 'staff', active: false });
  await t('admin creates staff', assertSucceeds(b.commit())); }
await t('anon can get a username', assertSucceeds(getDoc(doc(anon, 'usernames/bob'))));
await t('anon cannot list usernames', assertFails(getDocs(collection(anon, 'usernames'))));
await t('staff cannot create users', assertFails(setDoc(doc(bob, 'users/zed'), { username: 'zed', name: 'Z', role: 'admin', active: true })));
await t('staff cannot promote self', assertFails(updateDoc(doc(bob, 'users/bob'), { role: 'admin' })));
await t('staff reads own user doc', assertSucceeds(getDoc(doc(bob, 'users/bob'))));
await t('staff cannot read others', assertFails(getDoc(doc(bob, 'users/alice'))));
await t('staff cannot list users', assertFails(getDocs(collection(bob, 'users'))));
await t('admin lists users', assertSucceeds(getDocs(collection(alice, 'users'))));
await t('admin deactivates', assertSucceeds(updateDoc(doc(alice, 'users/carl'), { active: false })));
await t('admin cannot rename username', assertFails(updateDoc(doc(alice, 'users/carl'), { username: 'carlos' })));

// --- product list (catalog chunks) ---
await t('admin writes list chunk', assertSucceeds(setDoc(doc(alice, 'catalog/L1_0'), { listId: 'L1', n: 0, lines: '123\tMilk\n456\tBread' })));
await t('staff cannot write list', assertFails(setDoc(doc(bob, 'catalog/L1_1'), { listId: 'L1', n: 1, lines: 'x' })));
await t('staff reads list', assertSucceeds(getDoc(doc(bob, 'catalog/L1_0'))));
await t('no-profile user cannot read list', assertFails(getDoc(doc(eve, 'catalog/L1_0'))));
await t('inactive user cannot read list', assertFails(getDoc(doc(carl, 'catalog/L1_0'))));
await t('anon cannot read list', assertFails(getDoc(doc(anon, 'catalog/L1_0'))));

// --- counts ---
await t('staff saves count', assertSucceeds(setDoc(doc(bob, 'counts/123'), { barcode: '123', description: 'Milk', qty: 5, by: 'Bob', byUid: 'bob', at: 'x' })));
await t('staff cannot spoof uid', assertFails(setDoc(doc(bob, 'counts/123'), { barcode: '123', description: 'Milk', qty: 6, by: 'Alice', byUid: 'alice', at: 'x' })));
await t('staff cannot set non-int qty', assertFails(setDoc(doc(bob, 'counts/123'), { barcode: '123', qty: 'lots', byUid: 'bob' })));
await t('negative qty rejected', assertFails(setDoc(doc(bob, 'counts/123'), { barcode: '123', qty: -1, byUid: 'bob' })));
await t('inactive cannot count', assertFails(setDoc(doc(carl, 'counts/456'), { barcode: '456', qty: 1, byUid: 'carl' })));
await t('admin keeps another counter on a count', assertSucceeds(setDoc(doc(alice, 'counts/789'), { barcode: '789', description: 'Eggs', qty: 3, by: 'Bob', byUid: 'bob', at: 'x' })));
await t('admin still needs a whole qty', assertFails(setDoc(doc(alice, 'counts/789'), { barcode: '789', qty: -2, byUid: 'bob' })));
await t('staff cannot delete count', assertFails(deleteDoc(doc(bob, 'counts/123'))));
await t('admin deletes count', assertSucceeds(deleteDoc(doc(alice, 'counts/123'))));

// --- running total ---
await t('staff creates total at 1', assertSucceeds(setDoc(doc(bob, 'meta/stats'), { counted: 1 })));
await t('staff adds one', assertSucceeds(setDoc(doc(bob, 'meta/stats'), { counted: 2 })));
await t('staff cannot jump the total', assertFails(setDoc(doc(bob, 'meta/stats'), { counted: 50 })));
await t('staff cannot lower the total', assertFails(setDoc(doc(bob, 'meta/stats'), { counted: 1 })));
await t('admin sets total', assertSucceeds(setDoc(doc(alice, 'meta/stats'), { counted: 0 })));
await t('staff reads total', assertSucceeds(getDoc(doc(bob, 'meta/stats'))));

// --- recounts ---
const rec = { barcode: '123', description: 'Milk', status: 'open', requestedBy: 'Alice', requestedByUid: 'alice', requestedAt: 'x', firstQty: 5, firstBy: 'Alice', firstByUid: 'alice', firstAt: 'x' };
const recount = (qty, uid) => ({ status: 'done', recountQty: qty, recountBy: 'Bob', recountByUid: uid, recountAt: 'y' });
await t('staff cannot ask for a recount', assertFails(setDoc(doc(bob, 'recounts/123'), rec)));
await t('admin asks for a recount', assertSucceeds(setDoc(doc(alice, 'recounts/123'), rec)));
await t('staff reads recounts', assertSucceeds(getDoc(doc(bob, 'recounts/123'))));
await t('inactive cannot read recounts', assertFails(getDoc(doc(carl, 'recounts/123'))));
await t('recount must be a whole number', assertFails(updateDoc(doc(bob, 'recounts/123'), recount(-1, 'bob'))));
await t('staff cannot recount as someone else', assertFails(updateDoc(doc(bob, 'recounts/123'), recount(6, 'alice'))));
await t('staff cannot change the first count', assertFails(updateDoc(doc(bob, 'recounts/123'), Object.assign(recount(6, 'bob'), { firstQty: 6 }))));
await t('staff saves the recount', assertSucceeds(updateDoc(doc(bob, 'recounts/123'), recount(6, 'bob'))));
await t('a finished recount cannot be overwritten', assertFails(updateDoc(doc(bob, 'recounts/123'), recount(7, 'bob'))));
await t('staff cannot delete a recount', assertFails(deleteDoc(doc(bob, 'recounts/123'))));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'recounts/456'), Object.assign({}, rec, { barcode: '456', firstByUid: 'bob', firstBy: 'Bob' })));
await t('first counter cannot recount their own count', assertFails(updateDoc(doc(bob, 'recounts/456'), recount(3, 'bob'))));
await t('admin closes a recount', assertSucceeds(deleteDoc(doc(alice, 'recounts/123'))));

// --- areas ---
await t('admin adds area', assertSucceeds(setDoc(doc(alice, 'areas/a1'), { name: 'Aisle 3', order: 1 })));
await t('staff reads areas', assertSucceeds(getDocs(collection(bob, 'areas'))));
await t('staff cannot add area', assertFails(setDoc(doc(bob, 'areas/a2'), { name: 'Mine' })));
await t('inactive cannot read areas', assertFails(getDoc(doc(carl, 'areas/a1'))));

// --- tasks ---
await t('admin assigns task', assertSucceeds(setDoc(doc(alice, 'tasks/t1'), { uid: 'bob', name: 'Bob', areaId: 'a1', items: ['123'], itemCount: 1, done: false })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'tasks/t2'), { uid: 'alice', name: 'Alice', items: [], done: false }));
await t('staff reads own task', assertSucceeds(getDoc(doc(bob, 'tasks/t1'))));
await t('staff cannot read others task', assertFails(getDoc(doc(bob, 'tasks/t2'))));
await t('staff lists own tasks', assertSucceeds(getDocs(query(collection(bob, 'tasks'), where('uid', '==', 'bob')))));
await t('staff cannot list all tasks', assertFails(getDocs(collection(bob, 'tasks'))));
await t('staff marks own task done', assertSucceeds(updateDoc(doc(bob, 'tasks/t1'), { done: true, doneAt: 'x' })));
await t('staff cannot change task items', assertFails(updateDoc(doc(bob, 'tasks/t1'), { items: ['1', '2'] })));
await t('staff cannot take others task', assertFails(updateDoc(doc(bob, 'tasks/t2'), { done: true })));
await t('staff cannot create task', assertFails(setDoc(doc(bob, 'tasks/t3'), { uid: 'bob', items: [], done: false })));
await t('staff cannot delete task', assertFails(deleteDoc(doc(bob, 'tasks/t1'))));
await t('admin deletes task', assertSucceeds(deleteDoc(doc(alice, 'tasks/t1'))));

// --- old-format product lists ---
await t('staff cannot write old products', assertFails(setDoc(doc(bob, 'products/9'), { barcode: '9', description: 'X' })));
await t('admin writes old product', assertSucceeds(setDoc(doc(alice, 'products/9'), { barcode: '9', description: 'X', countedQty: null })));
await t('older app: staff counts old product', assertSucceeds(updateDoc(doc(bob, 'products/9'), { countedQty: 4, updatedBy: 'Bob', updatedByUid: 'bob', updatedAt: 'x' })));
await t('older app: staff cannot rename old product', assertFails(updateDoc(doc(bob, 'products/9'), { description: 'Y', updatedByUid: 'bob' })));
await t('admin clears old products', assertSucceeds(deleteDoc(doc(alice, 'products/9'))));

// --- extras ---
await t('staff adds extra', assertSucceeds(setDoc(doc(bob, 'extras/555'), { barcode: '555', description: 'Found', qty: 2, addedBy: 'Bob', addedByUid: 'bob', addedAt: 'x' })));
await t('staff extra spoof blocked', assertFails(setDoc(doc(bob, 'extras/556'), { barcode: '556', description: 'F', qty: 2, addedByUid: 'alice' })));
await t('staff cannot delete extra', assertFails(deleteDoc(doc(bob, 'extras/555'))));

// --- session ---
await t('staff reads session', assertSucceeds(getDoc(doc(bob, 'meta/session'))));
await t('staff cannot write session', assertFails(setDoc(doc(bob, 'meta/session'), { name: 'x' })));
await t('admin writes session', assertSucceeds(setDoc(doc(alice, 'meta/session'), { name: 'x', totalProducts: 0 })));

// --- activity ---
await t('staff logs activity', assertSucceeds(addDoc(collection(bob, 'activity'), { at: serverTimestamp(), uid: 'bob', action: 'count_saved' })));
await t('staff cannot log as someone else', assertFails(addDoc(collection(bob, 'activity'), { at: serverTimestamp(), uid: 'alice', action: 'x' })));
await t('client timestamps rejected', assertFails(addDoc(collection(bob, 'activity'), { at: new Date(), uid: 'bob', action: 'x' })));
await t('inactive cannot log', assertFails(addDoc(collection(carl, 'activity'), { at: serverTimestamp(), uid: 'carl', action: 'x' })));
await t('staff cannot read activity', assertFails(getDocs(collection(bob, 'activity'))));
await t('admin reads activity', assertSucceeds(getDocs(collection(alice, 'activity'))));
const act = (await env.withSecurityRulesDisabled(async c => (await getDocs(collection(c.firestore(), 'activity'))).docs[0].id));
await t('admin cannot edit activity', assertFails(updateDoc(doc(alice, 'activity/' + act), { action: 'y' })));
await t('admin cannot delete activity', assertFails(deleteDoc(doc(alice, 'activity/' + act))));

// --- self delete ---
await t('staff deletes own username+user', assertSucceeds((() => { const b = writeBatch(bob); b.delete(doc(bob, 'usernames/bob')); b.delete(doc(bob, 'users/bob')); return b.commit(); })()));
await t('other paths denied', assertFails(setDoc(doc(alice, 'random/x'), { a: 1 })));

// --- businesses: each one is separate ---
const olga = env.authenticatedContext('olga').firestore();   // owner of business B1
const sam = env.authenticatedContext('sam').firestore();     // staff in B1
const pete = env.authenticatedContext('pete').firestore();   // owner of business B2
const B1 = 'businesses/B1/', B2 = 'businesses/B2/';
function createBusiness(c, uid, biz, code, extra) {
  const b = writeBatch(c);
  b.set(doc(c, 'businesses/' + biz), Object.assign({ name: 'Shop ' + biz, code, ownerUid: uid, createdAt: 'x' }, extra || {}));
  b.set(doc(c, 'codes/' + code), { biz });
  b.set(doc(c, 'members/' + uid), { biz });
  b.set(doc(c, 'businesses/' + biz + '/users/' + uid), { username: uid, name: uid, role: 'admin', active: true });
  b.set(doc(c, 'businesses/' + biz + '/usernames/' + uid), { uid, email: uid + '@x.com' });
  b.set(doc(c, 'businesses/' + biz + '/meta/setup'), { done: true, by: uid });
  return b.commit();
}
await t('owner creates business B1', assertSucceeds(createBusiness(olga, 'olga', 'B1', 'AAAAAA')));
await t('owner creates business B2', assertSucceeds(createBusiness(pete, 'pete', 'B2', 'BBBBBB')));
await t('cannot take over an existing business', assertFails(createBusiness(eve, 'eve', 'B1', 'CCCCCC')));
await t('cannot reuse a business code', assertFails(createBusiness(eve, 'eve', 'B3', 'AAAAAA')));
await t('business needs a well-formed code', assertFails(createBusiness(eve, 'eve', 'B4', 'bad')));
await t('cannot create a business owned by someone else', assertFails((() => {
  const b = writeBatch(eve);
  b.set(doc(eve, 'businesses/B5'), { name: 'X', code: 'DDDDDD', ownerUid: 'olga' });
  b.set(doc(eve, 'codes/DDDDDD'), { biz: 'B5' });
  b.set(doc(eve, 'businesses/B5/users/eve'), { username: 'eve', name: 'E', role: 'admin', active: true });
  return b.commit(); })()));
await t('anyone looks up a business code', assertSucceeds(getDoc(doc(anon, 'codes/AAAAAA'))));
await t('codes cannot be listed', assertFails(getDocs(collection(anon, 'codes'))));
await t('anyone looks up a username in a business', assertSucceeds(getDoc(doc(anon, B1 + 'usernames/olga'))));
await t('business usernames cannot be listed', assertFails(getDocs(collection(anon, B1 + 'usernames'))));
await t('owner reads own business', assertSucceeds(getDoc(doc(olga, 'businesses/B1'))));
await t('other owner cannot read the business', assertFails(getDoc(doc(pete, 'businesses/B1'))));
await t('root admin cannot read a business', assertFails(getDoc(doc(alice, 'businesses/B1'))));
await t('owner reads own member doc', assertSucceeds(getDoc(doc(olga, 'members/olga'))));
await t('others cannot read a member doc', assertFails(getDoc(doc(pete, 'members/olga'))));

// staff in B1
{ const b = writeBatch(olga);
  b.set(doc(olga, B1 + 'users/sam'), { username: 'sam', name: 'Sam', role: 'staff', active: true });
  b.set(doc(olga, B1 + 'usernames/sam'), { uid: 'sam', email: 's@x.com' });
  b.set(doc(olga, 'members/sam'), { biz: 'B1' });
  await t('owner adds staff with member doc', assertSucceeds(b.commit())); }
await t('other owner cannot add staff to B1', assertFails(setDoc(doc(pete, B1 + 'users/zed'), { username: 'zed', name: 'Z', role: 'admin', active: true })));
await t('other owner cannot claim a member for B1', assertFails(setDoc(doc(pete, 'members/zed'), { biz: 'B1' })));
await t('cannot claim a member without a user there', assertFails(setDoc(doc(olga, 'members/nobody'), { biz: 'B1' })));
await t('member docs never point to root', assertFails(setDoc(doc(alice, 'members/zz'), { biz: 'root' })));
await t('admin lists own members', assertSucceeds(getDocs(query(collection(olga, 'members'), where('biz', '==', 'B1')))));
await t('admin cannot list another business members', assertFails(getDocs(query(collection(olga, 'members'), where('biz', '==', 'B2')))));

// data stays inside each business
await t('owner writes list in B1', assertSucceeds(setDoc(doc(olga, B1 + 'catalog/L_0'), { listId: 'L', n: 0, lines: '1\tA' })));
await t('staff saves count in B1', assertSucceeds(setDoc(doc(sam, B1 + 'counts/1'), { barcode: '1', description: 'A', qty: 2, by: 'Sam', byUid: 'sam', at: 'x' })));
await t('staff adds one to B1 total', assertSucceeds(setDoc(doc(sam, B1 + 'meta/stats'), { counted: 1 })));
await t('staff reads B1 list', assertSucceeds(getDoc(doc(sam, B1 + 'catalog/L_0'))));
await t('B2 owner cannot read B1 list', assertFails(getDoc(doc(pete, B1 + 'catalog/L_0'))));
await t('B2 owner cannot read B1 counts', assertFails(getDocs(collection(pete, B1 + 'counts'))));
await t('B2 owner cannot write B1 counts', assertFails(setDoc(doc(pete, B1 + 'counts/2'), { barcode: '2', qty: 1, byUid: 'pete' })));
await t('root admin cannot read B1 counts', assertFails(getDocs(collection(alice, B1 + 'counts'))));
await t('B1 staff cannot read root counts', assertFails(getDocs(collection(sam, 'counts'))));
await t('B1 owner cannot read root list', assertFails(getDoc(doc(olga, 'catalog/L1_0'))));
await t('B1 staff cannot read B1 activity', assertFails(getDocs(collection(sam, B1 + 'activity'))));
await t('B1 staff logs in B1', assertSucceeds(addDoc(collection(sam, B1 + 'activity'), { at: serverTimestamp(), uid: 'sam', action: 'login' })));
await t('B1 staff cannot log in B2', assertFails(addDoc(collection(sam, B2 + 'activity'), { at: serverTimestamp(), uid: 'sam', action: 'login' })));
await t('no data under businesses/root', assertFails(setDoc(doc(alice, 'businesses/root/counts/1'), { barcode: '1', qty: 1, byUid: 'alice' })));
await t('staff cannot promote self in B1', assertFails(updateDoc(doc(sam, B1 + 'users/sam'), { role: 'admin' })));

// business doc: name, code, owner, subscription status
await t('owner renames business', assertSucceeds(updateDoc(doc(olga, 'businesses/B1'), { name: 'Olga Shop' })));
await t('code never changes', assertFails(updateDoc(doc(olga, 'businesses/B1'), { code: 'EEEEEE' })));
await t('owner never changes', assertFails(updateDoc(doc(olga, 'businesses/B1'), { ownerUid: 'sam' })));
await t('staff cannot rename business', assertFails(updateDoc(doc(sam, 'businesses/B1'), { name: 'Mine' })));
await t('staff device records subscription', assertSucceeds(updateDoc(doc(sam, 'businesses/B1'), { plan: { active: true, expiresAt: 'x' } })));
await t('other business cannot touch subscription', assertFails(updateDoc(doc(pete, 'businesses/B1'), { plan: { active: true } })));
await t('staff counts one free item', assertSucceeds(updateDoc(doc(sam, 'businesses/B1'), { used: 1 })));
await t('staff counts the next free item', assertSucceeds(updateDoc(doc(sam, 'businesses/B1'), { used: 2 })));
await t('free allowance cannot jump', assertFails(updateDoc(doc(sam, 'businesses/B1'), { used: 10 })));
await t('free allowance cannot be reset by staff', assertFails(updateDoc(doc(sam, 'businesses/B1'), { used: 0 })));
await t('free allowance cannot be reset by the owner', assertFails(updateDoc(doc(olga, 'businesses/B1'), { used: 0 })));
await t('owner rename keeps the allowance', assertSucceeds(updateDoc(doc(olga, 'businesses/B1'), { name: 'Olga Fruit' })));
await t('other business cannot use B1 allowance', assertFails(updateDoc(doc(pete, 'businesses/B1'), { used: 3 })));

// the first business gets a code too
{ const b = writeBatch(alice);
  b.set(doc(alice, 'businesses/root'), { name: 'H Stock', code: 'HHHHHH', ownerUid: 'alice' });
  b.set(doc(alice, 'codes/HHHHHH'), { biz: 'root' });
  await t('root admin gives the first business a code', assertSucceeds(b.commit())); }
await t('B1 owner cannot claim a code for root', assertFails(setDoc(doc(olga, 'codes/JJJJJJ'), { biz: 'root' })));
await t('root admin reads root business', assertSucceeds(getDoc(doc(alice, 'businesses/root'))));

// deleting a business (owner only)
await t('staff cannot delete the business', assertFails(deleteDoc(doc(sam, 'businesses/B1'))));
await t('other owner cannot delete B1', assertFails(deleteDoc(doc(pete, 'businesses/B1'))));
const b1act = (await env.withSecurityRulesDisabled(async c => (await getDocs(collection(c.firestore(), B1 + 'activity'))).docs[0].id));
await t('staff cannot delete B1 activity', assertFails(deleteDoc(doc(sam, B1 + 'activity/' + b1act))));
await t('owner deletes B1 activity', assertSucceeds(deleteDoc(doc(olga, B1 + 'activity/' + b1act))));
await t('root admin still cannot delete root activity', assertFails(deleteDoc(doc(alice, 'activity/' + act))));
await t('owner deletes B1 data', assertSucceeds((() => { const b = writeBatch(olga);
  b.delete(doc(olga, B1 + 'catalog/L_0')); b.delete(doc(olga, B1 + 'counts/1')); b.delete(doc(olga, B1 + 'meta/stats'));
  b.delete(doc(olga, B1 + 'users/sam')); b.delete(doc(olga, B1 + 'usernames/sam')); b.delete(doc(olga, 'members/sam'));
  return b.commit(); })()));
await t('owner deletes the business last', assertSucceeds((() => { const b = writeBatch(olga);
  b.delete(doc(olga, B1 + 'meta/setup')); b.delete(doc(olga, 'codes/AAAAAA'));
  b.delete(doc(olga, B1 + 'usernames/olga')); b.delete(doc(olga, 'members/olga'));
  b.delete(doc(olga, 'businesses/B1')); b.delete(doc(olga, B1 + 'users/olga'));
  return b.commit(); })()));
await t('B2 untouched', assertSucceeds(getDoc(doc(pete, 'businesses/B2'))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
