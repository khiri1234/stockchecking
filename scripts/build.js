// Bundles the web pages for the apps, swapping the CDN <script> tags for local
// copies from node_modules so they start without a network.
//
//   node scripts/build.js            -> www/ for the iOS app (index.html + Capacitor)
//   node scripts/build.js --desktop  -> desktop/app/ for the Windows and Mac app
//                                       (dashboard.html + index.html, no Capacitor)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const desktop = process.argv.includes("--desktop");
const out = desktop ? path.join(root, "desktop", "app") : path.join(root, "www");
const pages = desktop ? ["dashboard.html", "index.html"] : ["index.html"];
const vendor = path.join(out, "vendor");

// CDN script URL -> [file in node_modules, name in vendor/]
const scripts = {
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js": ["xlsx/dist/xlsx.full.min.js", "xlsx.full.min.js"],
  "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js": ["@zxing/library/umd/index.min.js", "zxing.min.js"],
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js": ["firebase/firebase-app-compat.js", "firebase-app-compat.js"],
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js": ["firebase/firebase-firestore-compat.js", "firebase-firestore-compat.js"],
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js": ["firebase/firebase-auth-compat.js", "firebase-auth-compat.js"],
};
// Every page must load these (the others are optional per page)
const required = Object.keys(scripts).filter((u) => u.includes("firebase"));
const modules = path.join(root, "node_modules");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

for (const page of pages) {
  let html = fs.readFileSync(path.join(root, page), "utf8");
  for (const url of required) {
    if (!html.includes(url)) throw new Error(page + " no longer loads " + url + " - update scripts/build.js");
  }
  for (const [url, [mod, name]] of Object.entries(scripts)) {
    if (!html.includes(url)) continue;
    fs.copyFileSync(path.join(modules, mod), path.join(vendor, name));
    html = html.replace(url, "vendor/" + name);
  }
  if (!desktop) {
    // Capacitor core adds registerPlugin() on top of the native bridge
    fs.copyFileSync(path.join(modules, "@capacitor/core/dist/capacitor.js"), path.join(vendor, "capacitor.js"));
    html = html.replace('<script src="vendor/', '<script src="vendor/capacitor.js"></script>\n<script src="vendor/');
  }
  fs.writeFileSync(path.join(out, page), html);
}

// Shared sign-in / Firebase code, and the logo shown on the dashboard
fs.copyFileSync(path.join(root, "common.js"), path.join(out, "common.js"));
fs.copyFileSync(path.join(root, "logo.png"), path.join(out, "logo.png"));

console.log("Built " + path.relative(root, out) + "/ (" + pages.join(", ") + ")");
