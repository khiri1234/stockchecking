// Security rule tests. Run from tests/: npm install && npm test
// (starts the Firestore emulator; needs Java 11+).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';

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

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
