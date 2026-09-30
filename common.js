/* Shared by index.html (phone app) and dashboard.html (desktop):
 * Firebase setup, username/password sign-in, staff accounts and the
 * activity log. Exposes window.SC. */
(function () {
  "use strict";

  /* Firebase project config (Firebase console > Project settings > Your apps). */
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyDW-xKGl69U3JUDLT-LwnE25xFPEf1DLM0",
    authDomain: "stockchek-1dbe4.firebaseapp.com",
    projectId: "stockchek-1dbe4",
    storageBucket: "stockchek-1dbe4.firebasestorage.app",
    messagingSenderId: "714433759504",
    appId: "1:714433759504:web:d040322449afeb2d33bd95"
  };

  var db = null, auth = null;
  var profile = null; // { uid, username, name, role, active }
  var authCb = null, holdAuth = false, profileUnsub = null;

  function isNative() {
    var C = window.Capacitor;
    return !!(C && C.isNativePlatform && C.isNativePlatform());
  }

  function configured() {
    return typeof firebase !== "undefined" && typeof firebase.auth === "function" &&
      FIREBASE_CONFIG.apiKey.indexOf("YOUR_") !== 0;
  }

  // Windows desktop app (Electron); its preload script sets window.desktopApp
  function isDesktopApp() { return !!window.desktopApp; }

  // Inside the iOS and desktop apps, leave authDomain out: with it, Firebase
  // Auth loads a hidden sign-in iframe on start-up that never finishes inside
  // an app, and sign-in hangs. Username/password sign-in doesn't need it.
  function appConfig() {
    var c = Object.assign({}, FIREBASE_CONFIG);
    if (isNative() || isDesktopApp()) delete c.authDomain;
    return c;
  }

  // Local emulators for automated tests: window.FIREBASE_EMULATORS = "localhost"
  function useEmulators(a, d) {
    var host = window.FIREBASE_EMULATORS;
    if (!host) return;
    if (a) a.useEmulator("http://" + host + ":9099", { disableWarnings: true });
    if (d) d.useEmulator(host, 8080);
  }

  async function init() {
    if (db) return { db: db, auth: auth };
    if (!configured()) return null;
    if (!firebase.apps.length) firebase.initializeApp(appConfig());
    auth = firebase.auth();
    db = firebase.firestore();
    useEmulators(auth, db);
    // Offline cache: counts saved without signal are sent once back online
    if (!window.FIREBASE_EMULATORS) {
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      checkRestoredWrites();
    }
    return { db: db, auth: auth };
  }

  /* ---------------- usernames ---------------- */

  function normalizeUsername(raw) { return String(raw || "").trim().toLowerCase(); }
  function validUsername(u) { return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u); }

  // Sign-in accounts are keyed by a generated address that nobody receives
  // mail at; people only ever see and type their username.
  function newEmailFor(username) {
    var rand = Math.random().toString(36).slice(2, 8);
    return username + "." + rand + "@" + FIREBASE_CONFIG.projectId + ".firebaseapp.com";
  }

  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }

  // Rejects with code "timeout" if the promise takes longer than ms
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(err("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function friendlyError(e) {
    var code = (e && e.code) || "";
    var map = {
      "auth/wrong-password": "Wrong username or password.",
      "auth/invalid-credential": "Wrong username or password.",
      "auth/invalid-login-credentials": "Wrong username or password.",
      "auth/user-not-found": "Wrong username or password.",
      "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
      "auth/network-request-failed": "No connection. Check your internet and try again.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/requires-recent-login": "Please sign out and sign in again first.",
      "auth/operation-not-allowed": "Username sign-in isn't switched on in Firebase yet (Authentication > Sign-in method > Email/Password).",
      "auth/configuration-not-found": "Username sign-in isn't switched on in Firebase yet (Authentication > Sign-in method > Email/Password).",
      "inactive": "This account has been switched off. Ask your manager.",
      "timeout": "The server didn't answer. Check your internet connection and try again.",
      "unavailable": "No connection to the server. Check your internet connection and try again.",
      "username-taken": "That username is already in use.",
      "bad-username": "Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.",
      "permission-denied": "You don't have permission to do that.",
      "setup-done": "Setup has already been completed. Sign in instead.",
      "last-admin": "You're the only admin. Make someone else an admin first.",
      "list-incomplete": "The product list didn't load completely. Check your connection and reopen the app."
    };
    return map[code] || (e && e.message) || "Something went wrong.";
  }

  async function lookupUsername(username) {
    var snap = await db.doc("usernames/" + username).get();
    return snap.exists ? snap.data() : null;
  }

  async function isSetupDone() {
    var snap = await db.doc("meta/setup").get();
    return snap.exists;
  }

  /* ---------------- activity log ---------------- */

  function clean(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  }

  // Never throws: a failed log write must not block the action itself
  function log(action, data) {
    if (!db || !profile) return Promise.resolve();
    var entry = clean(Object.assign({
      at: firebase.firestore.FieldValue.serverTimestamp(),
      uid: profile.uid,
      username: profile.username,
      name: profile.name,
      action: action
    }, data || {}));
    return db.collection("activity").add(entry).catch(function (e) {
      console.warn("activity log failed", action, e);
    });
  }

  var ACTION_LABELS = {
    setup: "Set up the app",
    login: "Signed in",
    logout: "Signed out",
    count_saved: "Counted",
    count_added: "Added to count",
    extra_added: "Added extra item",
    import: "Started a new stock check",
    reset_counts: "Reset all counts",
    stock_deleted: "Deleted the stock check",
    export: "Exported results",
    staff_created: "Added staff member",
    staff_deactivated: "Switched off account",
    staff_reactivated: "Switched on account",
    role_changed: "Changed role",
    password_reset: "Reset password",
    password_changed: "Changed own password",
    account_deleted: "Deleted own account",
    recount_requested: "Asked for a recount",
    recount_saved: "Recounted",
    recount_accepted: "Used the recount",
    recount_kept: "Kept the first count",
    area_added: "Added area",
    area_renamed: "Renamed area",
    area_deleted: "Deleted area",
    area_merged: "Moved counts to an area",
    task_assigned: "Assigned a task",
    task_done: "Finished a task"
  };

  /* ---------------- stock data ----------------
   * Built for lists of 50,000+ items:
   * - The product list is stored as a few large text documents,
   *   catalog/{listId}_{n}, one "barcode<TAB>description" line per item, so a
   *   device loads the whole list with a handful of reads and looks barcodes
   *   up locally (instant, and works offline once loaded).
   * - counts/{barcodeId} exists only for items someone has counted.
   * - meta/stats.counted is the running total the progress bars show, so
   *   phones never need to download every count. */

  var MAX_ITEMS = 100000;
  var CHUNK_BYTES = 700000; // Firestore documents max out at 1 MiB

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function sanitizeId(raw) {
    var s = String(raw == null ? "" : raw).trim();
    s = s.replace(/[^A-Za-z0-9_\-.~:@+]/g, "_");
    if (s.length > 190) s = s.slice(0, 190);
    if (!s) s = "item_" + Math.random().toString(36).slice(2, 10);
    if (/^\.\.?$/.test(s) || /^__.*__$/.test(s)) s = "id_" + s;
    return s;
  }

  function oneLine(v) { return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").trim(); }

  // rows: [{ barcode, description }] -> text chunks under CHUNK_BYTES each
  function buildChunks(rows) {
    var enc = new TextEncoder();
    var chunks = [], cur = [], size = 0;
    rows.forEach(function (r) {
      var line = oneLine(r.barcode) + "\t" + oneLine(r.description).slice(0, 1000);
      var b = enc.encode(line).length + 1;
      if (size + b > CHUNK_BYTES && cur.length) { chunks.push(cur.join("\n")); cur = []; size = 0; }
      cur.push(line);
      size += b;
    });
    if (cur.length) chunks.push(cur.join("\n"));
    return chunks;
  }

  // Cleans and de-duplicates imported rows (first occurrence of a barcode wins)
  function prepareRows(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var barcode = oneLine(r.barcode);
      if (!barcode) return;
      var id = sanitizeId(barcode);
      if (seen[id]) return;
      seen[id] = true;
      out.push({ barcode: barcode, description: oneLine(r.description) });
    });
    return out.slice(0, MAX_ITEMS);
  }

  var catalogCache = { listId: null, promise: null };

  // -> Promise<{ items: { id: { barcode, description } }, order: [id...] }> or null
  function loadCatalog(session) {
    if (!session || !session.listId) return Promise.resolve(null);
    if (catalogCache.listId === session.listId) return catalogCache.promise;
    catalogCache.listId = session.listId;
    catalogCache.promise = (async function () {
      var n = session.listChunks || 0, reads = [];
      for (var i = 0; i < n; i++) reads.push(db.doc("catalog/" + session.listId + "_" + i).get());
      var snaps = await Promise.all(reads);
      var items = {}, order = [];
      snaps.forEach(function (snap) {
        if (!snap.exists) throw err("list-incomplete");
        String(snap.data().lines || "").split("\n").forEach(function (line) {
          if (!line) return;
          var t = line.indexOf("\t");
          var barcode = t < 0 ? line : line.slice(0, t);
          var id = sanitizeId(barcode);
          if (items[id]) return;
          items[id] = { barcode: barcode, description: t < 0 ? "" : line.slice(t + 1) };
          order.push(id);
        });
      });
      return { items: items, order: order };
    })();
    catalogCache.promise.catch(function () { catalogCache.listId = null; });
    return catalogCache.promise;
  }

  /* ---------------- saving without signal ----------------
   * Firestore keeps writes made offline on the device and sends them when the
   * connection returns, but its promises only resolve once the server has
   * them. track() lets the app carry on: it resolves when the server has the
   * write, or after QUEUE_MS if it's still waiting, and counts the writes still
   * waiting so the pages can show "3 counts waiting to upload". A write that
   * fails after that is reported through onWriteError. */
  var QUEUE_MS = 1500;
  var sync = { online: typeof navigator === "undefined" || navigator.onLine !== false, waiting: 0, restored: false };
  var syncListeners = [], writeErrorListeners = [];
  function notifySync() { var s = Object.assign({}, sync); syncListeners.forEach(function (f) { try { f(s); } catch (e) {} }); }
  function onSync(cb) { syncListeners.push(cb); cb(Object.assign({}, sync)); }
  function onWriteError(cb) { writeErrorListeners.push(cb); }
  if (typeof window !== "undefined") {
    window.addEventListener("online", function () { sync.online = true; notifySync(); });
    window.addEventListener("offline", function () { sync.online = false; notifySync(); });
  }
  function track(p) {
    var queued = false;
    var timer = setTimeout(function () { queued = true; sync.waiting++; notifySync(); }, QUEUE_MS);
    function settle() { clearTimeout(timer); if (queued) { sync.waiting--; notifySync(); } }
    p.then(settle, function (e) { settle(); if (queued) writeErrorListeners.forEach(function (f) { f(e); }); });
    return new Promise(function (resolve, reject) {
      setTimeout(function () { if (queued) resolve({ queued: true }); }, QUEUE_MS + 1);
      p.then(function () { if (!queued) resolve({ queued: false }); }, function (e) { if (!queued) reject(e); });
    });
  }
  // Writes saved in an earlier visit that are still waiting (the offline cache keeps them)
  function checkRestoredWrites() {
    if (!db || typeof db.waitForPendingWrites !== "function") return;
    var done = false;
    db.waitForPendingWrites().then(function () { done = true; if (sync.restored) { sync.restored = false; notifySync(); } }, function () {});
    setTimeout(function () { if (!done) { sync.restored = true; notifySync(); } }, 2500);
  }

  // The item's count, or null if it has none. Without signal it falls back to
  // the copy on this device; if there is none it throws code "unavailable".
  async function getCount(id) {
    var ref = db.doc("counts/" + id);
    try {
      var snap = await withTimeout(ref.get(), 4000);
      return snap.exists ? snap.data() : null;
    } catch (e) {
      var cached = await ref.get({ source: "cache" }).catch(function () { throw err("unavailable"); });
      return cached.exists ? cached.data() : null;
    }
  }

  /* A count is made of parts: parts/{partId} = { qty, by, byUid, at }, and
   * qty is their total. Scanning a counted item again adds a part (an item on
   * several shelves: 12 + 6 = 18) instead of replacing the count. Additions
   * use increments, so two people adding at once can't overwrite each other.
   * Counts saved before parts existed have no parts field: see countParts. */

  function newPartId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // A count's parts, oldest first (a count without parts is one part)
  function countParts(c) {
    if (!c) return [];
    var p = c.parts;
    if (!p || typeof p !== "object") return [{ id: "all", qty: c.qty, by: c.by || "", byUid: c.byUid || "", at: c.at || "" }];
    return Object.keys(p).map(function (k) { return Object.assign({ id: k }, p[k]); })
      .filter(function (x) { return x.qty; })
      .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  }

  // Admins: makes each count's total the sum of its parts again where they
  // differ. Returns how many were fixed.
  async function fixCountTotals(counts) {
    var ids = Object.keys(counts).filter(function (id) {
      var c = counts[id];
      if (!c || !c.parts || typeof c.parts !== "object") return false;
      var sum = countParts(c).reduce(function (t, x) { return t + (x.qty || 0); }, 0);
      return sum !== c.qty;
    });
    for (var i = 0; i < ids.length; i += 400) {
      var batch = db.batch();
      ids.slice(i, i + 400).forEach(function (id) {
        var sum = countParts(counts[id]).reduce(function (t, x) { return t + (x.qty || 0); }, 0);
        batch.update(db.doc("counts/" + id), { qty: Math.max(0, sum) });
      });
      await batch.commit();
    }
    return ids.length;
  }

  // "12 + 6 = 18", or "" for a single part
  function partsText(c) {
    var parts = countParts(c);
    if (parts.length < 2) return "";
    return parts.map(function (x) { return x.qty; }).join(" + ") + " = " + c.qty;
  }

  // The area being counted on this device ({ id, name } or null), stored on each part
  var area = null;
  function setArea(a) { area = a && a.id ? { id: a.id, name: a.name || "" } : null; }
  function part(qty, at) {
    var p = { qty: qty, by: profile.name, byUid: profile.uid, at: at };
    if (area) { p.area = area.id; p.areaName = area.name; }
    return p;
  }

  // Replaces the whole count. item: { id, barcode, description };
  // before: the item's existing count doc (or null)
  async function saveCount(item, qty, before) {
    var now = new Date().toISOString(), parts = {};
    parts[newPartId()] = part(qty, now);
    var batch = db.batch();
    batch.set(db.doc("counts/" + item.id), {
      barcode: item.barcode, description: item.description || "", qty: qty,
      by: profile.name, byUid: profile.uid, at: now, parts: parts
    });
    if (!before) batch.set(db.doc("meta/stats"), { counted: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    var res = await track(batch.commit());
    log("count_saved", { barcode: item.barcode, description: item.description || "", qty: qty, prevQty: before ? before.qty : null });
    return res;
  }

  // Adds n (may be negative, to undo) to the count as part partId (a new part
  // unless given; Quick count keeps adding to one part per item). before: the
  // item's count doc as last seen, or null if it had none. Resolves as track()
  // does: when the server has it, or once it's kept on the device.
  function addToCount(item, n, partId, before) {
    var inc = firebase.firestore.FieldValue.increment, now = new Date().toISOString(), parts = {};
    // A count saved without parts (older versions, recount results) keeps its total as the first part
    if (before && !before.parts) parts.all = { qty: before.qty, by: before.by || "", byUid: before.byUid || "", at: before.at || now };
    // A new part is written as a plain number, so if a write is ever applied
    // twice (signal lost before the server's answer arrived) the total no longer
    // matches the parts and an admin's dashboard puts it right (fixCountTotals)
    parts[partId || newPartId()] = part(partId ? inc(n) : n, now);
    var batch = db.batch();
    batch.set(db.doc("counts/" + item.id), {
      barcode: item.barcode, description: item.description || "", qty: inc(n),
      by: profile.name, byUid: profile.uid, at: now, parts: parts
    }, { merge: true });
    if (!before) batch.set(db.doc("meta/stats"), { counted: inc(1) }, { merge: true });
    return track(batch.commit());
  }

  // Deletes every document in a collection, 400 per batch; returns how many
  async function deleteAll(collection, onProgress) {
    var snap = await db.collection(collection).get();
    for (var i = 0; i < snap.docs.length; i += 400) {
      var batch = db.batch();
      snap.docs.slice(i, i + 400).forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
      if (onProgress) onProgress(Math.min(i + 400, snap.docs.length), snap.docs.length);
    }
    return snap.size;
  }

  // Removes every stored list except keepListId (the one just uploaded, if any).
  // Lists are only a few documents each, so reading them all is cheap.
  async function deleteCatalog(keepListId) {
    var snap = await db.collection("catalog").get();
    var old = snap.docs.filter(function (d) { return !keepListId || d.data().listId !== keepListId; });
    for (var i = 0; i < old.length; i += 400) {
      var batch = db.batch();
      old.slice(i, i + 400).forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
    }
  }

  async function fetchAllCounts() {
    var snap = await db.collection("counts").get();
    var map = {};
    snap.docs.forEach(function (d) { map[d.id] = d.data(); });
    return map;
  }

  // Admins: starts a new stock check, replacing the current one (oldSession).
  // onProgress(message) reports each step for long lists.
  async function importList(rawRows, fileName, oldSession, onProgress) {
    var rows = prepareRows(rawRows);
    if (!rows.length) throw err("empty-list", "No rows with a barcode found.");
    var say = onProgress || function () {};
    var listId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var chunks = buildChunks(rows);
    for (var i = 0; i < chunks.length; i++) {
      say("Uploading list (" + (i + 1) + " of " + chunks.length + ")…");
      await db.doc("catalog/" + listId + "_" + i).set({ listId: listId, n: i, lines: chunks[i] });
    }
    say("Clearing old counts…");
    await deleteAll("counts");
    await deleteAll("extras");
    await deleteAll("recounts");
    await deleteAll("tasks"); // tasks belong to one stock check; areas stay
    await deleteAll("products"); // lists saved before this format
    await db.doc("meta/stats").set({ counted: 0 });
    await db.doc("meta/session").set({
      name: String(fileName || "Stock check").replace(/\.[^.]+$/, ""), sourceFileName: fileName || "",
      totalProducts: rows.length, startedAt: new Date().toISOString(), startedBy: profile.name,
      listId: listId, listChunks: chunks.length
    });
    say("Tidying up…");
    try { await deleteCatalog(listId); } catch (e) { console.warn("old list cleanup failed", e); }
    await log("import", { detail: fileName + " · " + plural(rows.length, "product") });
    return rows.length;
  }

  // Admins: converts a stock check saved in the old format (one products/
  // document per item, up to 1,000) to the list format above, keeping its
  // counts. Safe to run twice: it writes the same documents again, and the old
  // products/ documents stay until the next import or delete clears them.
  async function migrateLegacyList(session) {
    if (!session || session.listId) return false;
    var snap = await db.collection("products").get();
    var rows = [], counted = [];
    snap.docs.forEach(function (d) {
      var p = d.data();
      rows.push({ barcode: p.barcode || d.id, description: p.description || "" });
      if (p.countedQty !== null && p.countedQty !== undefined) counted.push({ id: d.id, p: p });
    });
    rows = prepareRows(rows);
    var listId = "legacy";
    var chunks = buildChunks(rows);
    for (var i = 0; i < chunks.length; i++) {
      await db.doc("catalog/" + listId + "_" + i).set({ listId: listId, n: i, lines: chunks[i] });
    }
    for (var j = 0; j < counted.length; j += 400) {
      var batch = db.batch();
      counted.slice(j, j + 400).forEach(function (c) {
        batch.set(db.doc("counts/" + c.id), {
          barcode: c.p.barcode || c.id, description: c.p.description || "", qty: c.p.countedQty,
          by: c.p.updatedBy || "", byUid: c.p.updatedByUid || profile.uid, at: c.p.updatedAt || new Date().toISOString()
        });
      });
      await batch.commit();
    }
    await db.doc("meta/stats").set({ counted: counted.length });
    await db.doc("meta/session").set({ listId: listId, listChunks: chunks.length, totalProducts: rows.length }, { merge: true });
    return true;
  }

  /* ---------------- recounts ----------------
   * recounts/{barcodeId}: an admin asks for a second, blind count of an item.
   * It keeps the first count as it was when asked (firstQty, firstBy…);
   * someone other than the first counter saves recountQty without seeing the
   * first number; the admin then uses the recount or keeps the first count. */

  // items: [{ id, barcode, description, count: { qty, by, byUid, at } }]
  async function requestRecounts(items) {
    var now = new Date().toISOString();
    for (var i = 0; i < items.length; i += 400) {
      var batch = db.batch();
      items.slice(i, i + 400).forEach(function (it) {
        batch.set(db.doc("recounts/" + it.id), {
          barcode: it.barcode, description: it.description || "", status: "open",
          requestedBy: profile.name, requestedByUid: profile.uid, requestedAt: now,
          firstQty: it.count.qty, firstBy: it.count.by || "", firstByUid: it.count.byUid || "", firstAt: it.count.at || ""
        });
      });
      await batch.commit();
    }
    await log("recount_requested", items.length === 1
      ? { barcode: items[0].barcode, description: items[0].description || "" }
      : { detail: plural(items.length, "item") });
    return items.length;
  }

  async function saveRecount(id, rec, qty) {
    await track(db.doc("recounts/" + id).update({
      status: "done", recountQty: qty, recountBy: profile.name, recountByUid: profile.uid, recountAt: new Date().toISOString()
    }));
    log("recount_saved", { barcode: rec.barcode, description: rec.description || "", qty: qty });
  }

  // Admins: useRecount true makes the recount the item's count; false keeps the first count
  async function resolveRecount(id, rec, useRecount) {
    var batch = db.batch();
    if (useRecount) {
      batch.set(db.doc("counts/" + id), {
        barcode: rec.barcode, description: rec.description || "", qty: rec.recountQty,
        by: rec.recountBy || "", byUid: rec.recountByUid || profile.uid, at: rec.recountAt || new Date().toISOString()
      });
    }
    batch.delete(db.doc("recounts/" + id));
    await batch.commit();
    await log(useRecount ? "recount_accepted" : "recount_kept", {
      barcode: rec.barcode, description: rec.description || "",
      qty: useRecount ? rec.recountQty : rec.firstQty, prevQty: useRecount ? rec.firstQty : rec.recountQty
    });
  }

  async function cancelRecount(id) { await db.doc("recounts/" + id).delete(); }

  /* ---------------- areas and tasks ----------------
   * areas/{id} = { name, order }: places counted separately ("Aisle 3",
   * "Warehouse"). Every part of a count records the area it was counted in.
   * tasks/{id} = { uid, name, areaId, areaName, items: [barcodeId], note, done }:
   * work an admin assigns to one person: an area, a list of items, or both. */

  async function saveArea(name, id) {
    name = String(name || "").trim();
    if (!name) throw err("bad-name", "Enter a name for the area.");
    if (id) await db.doc("areas/" + id).update({ name: name });
    else await db.collection("areas").add({ name: name, order: Date.now(), createdAt: new Date().toISOString(), createdBy: profile.name });
    log(id ? "area_renamed" : "area_added", { detail: name });
  }
  async function deleteArea(id, name) {
    await db.doc("areas/" + id).delete();
    log("area_deleted", { detail: name || "" });
  }

  // Admins: records every part counted in fromAreaId ("" = no area) as
  // counted in area { id, name }. counts: id -> count doc. Returns how many
  // items changed. Counts saved before parts existed get one part, "all".
  async function moveToArea(counts, fromAreaId, area, fromName) {
    var ids = [], FP = firebase.firestore.FieldPath;
    Object.keys(counts).forEach(function (id) {
      if (countParts(counts[id]).some(function (p) { return (p.area || "") === fromAreaId; })) ids.push(id);
    });
    for (var i = 0; i < ids.length; i += 400) {
      var batch = db.batch();
      ids.slice(i, i + 400).forEach(function (id) {
        var c = counts[id], ref = db.doc("counts/" + id);
        if (!c.parts || typeof c.parts !== "object") {
          batch.update(ref, { parts: { all: { qty: c.qty, by: c.by || "", byUid: c.byUid || "", at: c.at || "", area: area.id, areaName: area.name } } });
          return;
        }
        var args = [];
        Object.keys(c.parts).forEach(function (pid) {
          if ((c.parts[pid].area || "") !== fromAreaId) return;
          args.push(new FP("parts", pid, "area"), area.id, new FP("parts", pid, "areaName"), area.name);
        });
        batch.update.apply(batch, [ref].concat(args));
      });
      await batch.commit();
    }
    log("area_merged", { detail: (fromName || "No area") + " \u2192 " + area.name + " \u00b7 " + plural(ids.length, "item") });
    return ids.length;
  }

  var MAX_TASK_ITEMS = 20000; // keeps a task document well under Firestore's 1 MiB
  // t: { uid, name, areaId, areaName, items: [barcodeId] or null, note }
  async function createTask(t) {
    var items = (t.items || []).slice(0, MAX_TASK_ITEMS);
    await db.collection("tasks").add({
      uid: t.uid, name: t.name || "", areaId: t.areaId || "", areaName: t.areaName || "",
      items: items, itemCount: items.length, note: String(t.note || "").trim(), done: false,
      createdAt: new Date().toISOString(), createdBy: profile.name
    });
    log("task_assigned", { target: t.username || "", detail: [t.areaName, items.length ? plural(items.length, "item") : ""].filter(Boolean).join(" \u00b7 ") });
  }
  async function deleteTask(id) { await db.doc("tasks/" + id).delete(); }
  async function setTaskDone(task, done) {
    await track(db.doc("tasks/" + task.id).update({ done: !!done, doneAt: done ? new Date().toISOString() : "" }));
    if (done) log("task_done", { detail: [task.areaName, task.itemCount ? plural(task.itemCount, "item") : ""].filter(Boolean).join(" \u00b7 ") });
  }

  async function resetCounts(onProgress) {
    var n = await deleteAll("counts", onProgress);
    await deleteAll("recounts");
    await db.doc("meta/stats").set({ counted: 0 });
    await log("reset_counts", { detail: plural(n, "item") });
    return n;
  }

  // Admins: removes the product list, every count, the extra items and the
  // stock check details, to start fresh. Staff accounts and the activity log stay.
  async function deleteStockCheck(session) {
    var out = { products: session ? session.totalProducts || 0 : 0, extras: 0 };
    await deleteCatalog();
    await deleteAll("counts");
    out.extras = await deleteAll("extras");
    await deleteAll("recounts");
    await deleteAll("tasks");
    out.products += await deleteAll("products");
    await db.doc("meta/session").delete();
    await db.doc("meta/stats").delete();
    await log("stock_deleted", { detail: plural(out.products, "product") + " · " + plural(out.extras, "extra item") });
    return out;
  }

  /* ---------------- sessions ---------------- */

  async function loadProfile(uid) {
    var snap = await db.doc("users/" + uid).get();
    if (!snap.exists) return null;
    return Object.assign({ uid: uid }, snap.data());
  }

  // ref.onSnapshot(onNext) that reconnects by itself. Firestore stops a live
  // listener for good after any error; one can fail for a moment right after
  // signing in (while the new sign-in reaches the server) or on a bad
  // connection, and the page would then stop updating. Returns unsubscribe.
  function listen(ref, onNext, onError, options) {
    var unsub = null, timer = null, stopped = false, delay = 1000;
    function start() {
      unsub = ref.onSnapshot(options || {}, function (snap) { delay = 1000; onNext(snap); }, function (e) {
        if (onError) onError(e);
        unsub = null;
        if (stopped || !auth || !auth.currentUser) return;
        timer = setTimeout(start, delay);
        delay = Math.min(delay * 2, 30000);
      });
    }
    start();
    return function () { stopped = true; clearTimeout(timer); if (unsub) unsub(); };
  }

  // Follows the signed-in account's own document, so switching an account
  // off or changing its role takes effect straight away on every device.
  function watchProfile(uid) {
    if (profileUnsub) profileUnsub();
    profileUnsub = listen(db.doc("users/" + uid), function (snap) {
      if (!profile || profile.uid !== uid) return;
      var d = snap.exists ? snap.data() : null;
      if (!d || !d.active) {
        profile = null;
        auth.signOut();
        if (authCb) authCb(null, err("inactive"));
        return;
      }
      if (d.role !== profile.role || d.name !== profile.name) {
        profile = Object.assign({ uid: uid }, d);
        if (authCb) authCb(profile);
      }
    }, function () {});
  }

  // After a refresh or restart the saved sign-in comes back before the
  // connection is up. Reading the account record can then fail for a moment;
  // that must not sign the person out. Falls back to the offline copy and
  // keeps retrying. Resolves null only when the record really doesn't exist.
  async function restoreProfile(u) {
    for (var attempt = 0; ; attempt++) {
      try { return await withTimeout(loadProfile(u.uid), 10000); } catch (e) {
        // The server turned this sign-in down (account removed): not a connection problem
        if (e && (e.code === "permission-denied" || e.code === "unauthenticated")) return null;
        console.warn("profile load failed", e);
      }
      try {
        var cached = await db.doc("users/" + u.uid).get({ source: "cache" });
        if (cached.exists) return Object.assign({ uid: u.uid }, cached.data());
      } catch (e) {}
      if (auth.currentUser !== u) throw err("signed-out");
      await new Promise(function (r) { setTimeout(r, Math.min(2000 * (attempt + 1), 10000)); });
    }
  }

  // cb(profile) when signed in with an active account, cb(null, error?) otherwise.
  // onRestoring() runs when a saved sign-in is found and is being checked.
  function onAuth(cb, onRestoring) {
    authCb = cb;
    return auth.onAuthStateChanged(async function (u) {
      if (holdAuth) return;
      if (!u) {
        if (profileUnsub) { profileUnsub(); profileUnsub = null; }
        profile = null; cb(null); return;
      }
      // signIn() already opened the app for this account
      if (profile && profile.uid === u.uid) return;
      if (onRestoring) onRestoring();
      var p = null;
      try { p = await restoreProfile(u); } catch (e) { return; }
      if (!p || !p.active) {
        profile = null;
        await auth.signOut();
        cb(null, p ? err("inactive") : null);
        return;
      }
      profile = p;
      watchProfile(u.uid);
      cb(p);
    });
  }

  async function signIn(rawUsername, password) {
    var username = normalizeUsername(rawUsername);
    var entry = validUsername(username) ? await withTimeout(lookupUsername(username), 15000) : null;
    if (!entry) throw err("auth/invalid-credential");
    var cred = await withTimeout(auth.signInWithEmailAndPassword(entry.email, password), 20000);
    var p = await withTimeout(loadProfile(cred.user.uid), 15000);
    if (!p || !p.active) { await auth.signOut(); throw err("inactive"); }
    profile = p;
    await log("login");
    // Open the app now instead of waiting for the sign-in listener to catch up
    watchProfile(p.uid);
    if (authCb) authCb(p);
    return p;
  }

  async function signOut() {
    await log("logout");
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    profile = null;
    await auth.signOut();
  }

  // First run only: creates the first admin account
  async function setupFirstAdmin(name, rawUsername, password) {
    var username = normalizeUsername(rawUsername);
    if (!validUsername(username)) throw err("bad-username");
    if (await isSetupDone()) throw err("setup-done");
    var email = newEmailFor(username);
    // The new account signs in before its admin record exists; hold the
    // sign-in handler until the record is written.
    holdAuth = true;
    try {
      var cred = await auth.createUserWithEmailAndPassword(email, password);
    } catch (e) { holdAuth = false; throw e; }
    var uid = cred.user.uid;
    var now = firebase.firestore.FieldValue.serverTimestamp();
    var batch = db.batch();
    batch.set(db.doc("users/" + uid), { username: username, name: name.trim(), role: "admin", active: true, createdAt: now, createdBy: uid });
    batch.set(db.doc("usernames/" + username), { uid: uid, email: email });
    batch.set(db.doc("meta/setup"), { done: true, by: uid, at: now });
    try {
      await batch.commit();
    } catch (e) {
      // Someone else finished setup first: remove the half-made account
      holdAuth = false;
      await cred.user.delete().catch(function () { return auth.signOut(); });
      throw e.code === "permission-denied" ? err("setup-done") : e;
    }
    holdAuth = false;
    profile = await loadProfile(uid);
    await log("setup");
    watchProfile(uid);
    if (authCb) authCb(profile);
    return profile;
  }

  /* ---------------- staff management (admins) ---------------- */

  // Creating an account on the main Auth instance would sign the admin out,
  // so new sign-in accounts are made on a short-lived second instance.
  async function createAuthAccount(email, password) {
    var app2 = firebase.initializeApp(appConfig(), "account-maker-" + Date.now());
    try {
      var a2 = app2.auth();
      useEmulators(a2, null);
      await a2.setPersistence(firebase.auth.Auth.Persistence.NONE);
      var cred = await a2.createUserWithEmailAndPassword(email, password);
      await a2.signOut();
      return cred.user.uid;
    } finally {
      app2.delete().catch(function () {});
    }
  }

  async function createStaff(opts) {
    var username = normalizeUsername(opts.username);
    if (!validUsername(username)) throw err("bad-username");
    if (await lookupUsername(username)) throw err("username-taken");
    var email = newEmailFor(username);
    var uid = await createAuthAccount(email, opts.password);
    var batch = db.batch();
    batch.set(db.doc("users/" + uid), {
      username: username, name: opts.name.trim(), role: opts.role === "admin" ? "admin" : "staff",
      active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: profile.uid
    });
    batch.set(db.doc("usernames/" + username), { uid: uid, email: email });
    await batch.commit();
    await log("staff_created", { target: username, detail: opts.role === "admin" ? "admin" : "staff" });
    return uid;
  }

  // Admins can't change someone else's password from the browser, so a reset
  // makes a fresh sign-in account under the same username and switches the
  // old one off. The username, name and role carry over.
  async function resetPassword(user, newPassword) {
    var email = newEmailFor(user.username);
    var newUid = await createAuthAccount(email, newPassword);
    var batch = db.batch();
    batch.set(db.doc("users/" + newUid), {
      username: user.username, name: user.name, role: user.role, active: true,
      createdAt: user.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: user.createdBy || profile.uid, previousUid: user.uid
    });
    batch.update(db.doc("usernames/" + user.username), { uid: newUid, email: email });
    batch.update(db.doc("users/" + user.uid), { active: false, replacedBy: newUid });
    await batch.commit();
    await log("password_reset", { target: user.username });
    return newUid;
  }

  async function setActive(user, active) {
    if (user.uid === profile.uid) throw err("permission-denied", "You can't switch off your own account.");
    await db.doc("users/" + user.uid).update({ active: !!active });
    await log(active ? "staff_reactivated" : "staff_deactivated", { target: user.username });
  }

  async function setRole(user, role, allUsers) {
    if (user.role === "admin" && role !== "admin") {
      var admins = (allUsers || []).filter(function (u) { return u.role === "admin" && u.active && !u.replacedBy; });
      if (admins.length <= 1) throw err("last-admin");
    }
    await db.doc("users/" + user.uid).update({ role: role });
    await log("role_changed", { target: user.username, detail: role });
  }

  /* ---------------- own account ---------------- */

  async function reauth(password) {
    var u = auth.currentUser;
    var cred = firebase.auth.EmailAuthProvider.credential(u.email, password);
    await u.reauthenticateWithCredential(cred);
    return u;
  }

  async function changeOwnPassword(current, next) {
    var u = await reauth(current);
    await u.updatePassword(next);
    await log("password_changed");
  }

  async function deleteOwnAccount(password, allAdmins) {
    if (profile.role === "admin" && allAdmins !== undefined && allAdmins <= 1) throw err("last-admin");
    var u = await reauth(password);
    await log("account_deleted");
    var batch = db.batch();
    var entry = await lookupUsername(profile.username);
    if (entry && entry.uid === u.uid) batch.delete(db.doc("usernames/" + profile.username));
    batch.delete(db.doc("users/" + u.uid));
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    await batch.commit();
    profile = null;
    await u.delete();
  }

  window.SC = {
    config: FIREBASE_CONFIG,
    configured: configured,
    isNative: isNative,
    isDesktopApp: isDesktopApp,
    listen: listen,
    init: init,
    onAuth: onAuth,
    signIn: signIn,
    signOut: signOut,
    isSetupDone: isSetupDone,
    setupFirstAdmin: setupFirstAdmin,
    createStaff: createStaff,
    resetPassword: resetPassword,
    setActive: setActive,
    setRole: setRole,
    deleteStockCheck: deleteStockCheck,
    plural: plural,
    sanitizeId: sanitizeId,
    MAX_ITEMS: MAX_ITEMS,
    loadCatalog: loadCatalog,
    getCount: getCount,
    saveCount: saveCount,
    addToCount: addToCount,
    track: track,
    fixCountTotals: fixCountTotals,
    onSync: onSync,
    onWriteError: onWriteError,
    setArea: setArea,
    saveArea: saveArea,
    deleteArea: deleteArea,
    moveToArea: moveToArea,
    createTask: createTask,
    deleteTask: deleteTask,
    setTaskDone: setTaskDone,
    MAX_TASK_ITEMS: MAX_TASK_ITEMS,
    newPartId: newPartId,
    countParts: countParts,
    partsText: partsText,
    fetchAllCounts: fetchAllCounts,
    importList: importList,
    resetCounts: resetCounts,
    migrateLegacyList: migrateLegacyList,
    requestRecounts: requestRecounts,
    saveRecount: saveRecount,
    resolveRecount: resolveRecount,
    cancelRecount: cancelRecount,
    changeOwnPassword: changeOwnPassword,
    deleteOwnAccount: deleteOwnAccount,
    log: log,
    actionLabel: function (a) { return ACTION_LABELS[a] || a; },
    friendlyError: friendlyError,
    withTimeout: withTimeout,
    normalizeUsername: normalizeUsername,
    validUsername: validUsername,
    profile: function () { return profile; },
    db: function () { return db; }
  };
})();
