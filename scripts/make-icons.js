// Builds every app icon from resources/icon-source.jpg (the 1024x1024 green
// and gold "The H Stock Management" artwork). Needs Playwright:
//   NODE_PATH=$(npm root -g) node scripts/make-icons.js
//
// The artwork is a rounded green card with a thin outline; it is cropped just
// inside the card so each system can round the corners in its own shape.
//   resources/icon.png, iOS AppIcon      1024, square, opaque (iOS rounds it)
//   desktop/build/icon.png               Windows: rounded square
//   desktop/build/icon-mac.png           macOS: rounded square with margin
//   android mipmaps + drawable           launcher icons and start-up icon
//   app-icon.png                         browser tab, home screen and in-app logo
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.join(__dirname, "..");
const source = path.join(root, "resources", "icon-source.jpg");
const res = path.join(root, "android", "app", "src", "main", "res");
const CROP = { x: 41, y: 30, size: 940 }; // inside the card's outline

// Runs in the page. shape: "square" | "rounded" | "circle"; inset: margin
// around the artwork (fraction of the size); scale: artwork size within the
// shape (Android's adaptive layer is cropped by the launcher)
function render(src, crop, S, shape, inset, scale) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = S;
      const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
      const m = S * inset, w = S - 2 * m;
      g.save();
      if (shape === "circle") { g.beginPath(); g.arc(S / 2, S / 2, w / 2, 0, Math.PI * 2); g.clip(); }
      if (shape === "rounded") { g.beginPath(); g.roundRect(m, m, w, w, w * 0.225); g.clip(); }
      const a = w * scale, o = m + (w - a) / 2;
      g.drawImage(img, crop.x, crop.y, crop.size, crop.size, o, o, a, a);
      g.restore();
      resolve(Array.from(g.getImageData(0, 0, S, S).data));
    };
    img.src = src;
  });
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// alpha false: opaque RGB (App Store icons must not have transparency)
function png(rgba, S, alpha) {
  const ch = alpha ? 4 : 3, raw = Buffer.alloc((S * ch + 1) * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, o = y * (S * ch + 1) + 1 + x * ch;
    for (let k = 0; k < ch; k++) raw[o + k] = rgba[i + k];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const src = "data:image/jpeg;base64," + fs.readFileSync(source).toString("base64");
  async function write(file, S, shape, opts) {
    opts = opts || {};
    const px = await page.evaluate(([fn, a]) => new Function("return " + fn)()(...a),
      [render.toString(), [src, CROP, S, shape, opts.inset || 0, opts.scale || 1]]);
    file = path.join(root, file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png(px, S, shape !== "square" || !!opts.inset));
  }

  await write("resources/icon.png", 1024, "square");
  await write("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024, "square");
  await write("desktop/build/icon.png", 1024, "rounded");
  await write("desktop/build/icon-mac.png", 1024, "rounded", { inset: 0.098 });
  await write("app-icon.png", 256, "rounded");

  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = "android/app/src/main/res/mipmap-" + d + "/";
    await write(dir + "ic_launcher.png", 48 * k, "rounded");
    await write(dir + "ic_launcher_round.png", 48 * k, "circle");
    // Adaptive icon layer (108dp): launchers show roughly the middle 72dp, so
    // the artwork fills 80% and the green background layer covers the rest
    await write(dir + "ic_launcher_foreground.png", 108 * k, "square", { inset: 0.1 });
  }
  await write("android/app/src/main/res/drawable/splash_icon.png", 288, "circle");

  await browser.close();
  console.log("Icons written");
})();
