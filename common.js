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

  // Inside the iOS app, leave authDomain out: with it, Firebase Auth loads a
  // hidden sign-in iframe on start-up that never finishes in the app's web
  // view, and sign-in hangs. Username/password sign-in doesn't need it.
  function appConfig() {
    var c = Object.assign({}, FIREBASE_CONFIG);
    if (isNative()) delete c.authDomain;
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
      "username-taken": "That username is already in use.",
      "bad-username": "Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.",
      "permission-denied": "You don't have permission to do that.",
      "setup-done": "Setup has already been completed. Sign in instead.",
      "last-admin": "You're the only admin. Make someone else an admin first."
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
    extra_added: "Added extra item",
    import: "Started a new stock check",
    reset_counts: "Reset all counts",
    export: "Exported results",
    staff_created: "Added staff member",
    staff_deactivated: "Switched off account",
    staff_reactivated: "Switched on account",
    role_changed: "Changed role",
    password_reset: "Reset password",
    password_changed: "Changed own password",
    account_deleted: "Deleted own account"
  };

  /* ---------------- sessions ---------------- */

  async function loadProfile(uid) {
    var snap = await db.doc("users/" + uid).get();
    if (!snap.exists) return null;
    return Object.assign({ uid: uid }, snap.data());
  }

  // Follows the signed-in account's own document, so switching an account
  // off or changing its role takes effect straight away on every device.
  function watchProfile(uid) {
    if (profileUnsub) profileUnsub();
    profileUnsub = db.doc("users/" + uid).onSnapshot(function (snap) {
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

  // cb(profile) when signed in with an active account, cb(null, error?) otherwise
  function onAuth(cb) {
    authCb = cb;
    return auth.onAuthStateChanged(async function (u) {
      if (holdAuth) return;
      if (!u) {
        if (profileUnsub) { profileUnsub(); profileUnsub = null; }
        profile = null; cb(null); return;
      }
      var p = null;
      try { p = await loadProfile(u.uid); } catch (e) { console.warn("profile load failed", e); }
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
    var entry = validUsername(username) ? await lookupUsername(username) : null;
    if (!entry) throw err("auth/invalid-credential");
    var cred = await auth.signInWithEmailAndPassword(entry.email, password);
    var p = await loadProfile(cred.user.uid);
    if (!p || !p.active) { await auth.signOut(); throw err("inactive"); }
    profile = p;
    await log("login");
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
    changeOwnPassword: changeOwnPassword,
    deleteOwnAccount: deleteOwnAccount,
    log: log,
    actionLabel: function (a) { return ACTION_LABELS[a] || a; },
    friendlyError: friendlyError,
    normalizeUsername: normalizeUsername,
    validUsername: validUsername,
    profile: function () { return profile; },
    db: function () { return db; }
  };
})();
