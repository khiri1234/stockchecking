// Builds www/ for the iOS app: copies index.html and swaps the CDN <script>
// tags for local copies from node_modules, so the app starts without a network.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const vendor = path.join(out, "vendor");

// CDN script URL -> [file in node_modules, name in www/vendor]
const scripts = {
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js": ["xlsx/dist/xlsx.full.min.js", "xlsx.full.min.js"],
  "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js": ["@zxing/library/umd/index.min.js", "zxing.min.js"],
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js": ["firebase/firebase-app-compat.js", "firebase-app-compat.js"],
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js": ["firebase/firebase-firestore-compat.js", "firebase-firestore-compat.js"],
};
const modules = path.join(root, "node_modules");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

for (const [url, [mod, name]] of Object.entries(scripts)) {
  if (!html.includes(url)) throw new Error("index.html no longer loads " + url + " - update scripts/build.js");
  fs.copyFileSync(path.join(modules, mod), path.join(vendor, name));
  html = html.replace(url, "vendor/" + name);
}

// Capacitor core adds registerPlugin() on top of the native bridge
fs.copyFileSync(path.join(modules, "@capacitor/core/dist/capacitor.js"), path.join(vendor, "capacitor.js"));
html = html.replace('<script src="vendor/', '<script src="vendor/capacitor.js"></script>\n<script src="vendor/');

fs.writeFileSync(path.join(out, "index.html"), html);
console.log("Built www/ (" + Object.keys(scripts).length + " libraries bundled)");
