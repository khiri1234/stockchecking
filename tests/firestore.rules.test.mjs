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

// --- products ---
await t('admin creates product', assertSucceeds(setDoc(doc(alice, 'products/123'), { barcode: '123', description: 'Milk', countedQty: null, updatedBy: null, updatedByUid: null, updatedAt: null })));
await t('staff cannot create product', assertFails(setDoc(doc(bob, 'products/999'), { barcode: '999', description: 'X', countedQty: null })));
await t('staff reads products', assertSucceeds(getDoc(doc(bob, 'products/123'))));
await t('no-profile user cannot read products', assertFails(getDoc(doc(eve, 'products/123'))));
await t('inactive user cannot read products', assertFails(getDoc(doc(carl, 'products/123'))));
await t('anon cannot read products', assertFails(getDoc(doc(anon, 'products/123'))));
await t('staff saves count', assertSucceeds(updateDoc(doc(bob, 'products/123'), { countedQty: 5, updatedBy: 'Bob', updatedByUid: 'bob', updatedAt: 'x' })));
await t('staff cannot spoof uid', assertFails(updateDoc(doc(bob, 'products/123'), { countedQty: 6, updatedBy: 'Alice', updatedByUid: 'alice', updatedAt: 'x' })));
await t('staff cannot change description', assertFails(updateDoc(doc(bob, 'products/123'), { description: 'Beer', countedQty: 6, updatedByUid: 'bob' })));
await t('staff cannot set non-int qty', assertFails(updateDoc(doc(bob, 'products/123'), { countedQty: 'lots', updatedByUid: 'bob' })));
await t('staff cannot delete product', assertFails(deleteDoc(doc(bob, 'products/123'))));
await t('admin resets count', assertSucceeds(updateDoc(doc(alice, 'products/123'), { countedQty: null, updatedBy: null, updatedByUid: null, updatedAt: null })));
await t('admin deletes product', assertSucceeds(deleteDoc(doc(alice, 'products/123'))));

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
