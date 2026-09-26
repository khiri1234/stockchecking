// Renders resources/icon.png (1024x1024, opaque RGB as App Store requires)
// and copies it into the iOS asset catalog. Needs Playwright:
//   NODE_PATH=$(npm root -g) node scripts/make-icon.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const S = 1024;
const draw = `(() => {
  const c = document.createElement("canvas"); c.width = c.height = ${S};
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, ${S}, ${S});
  bg.addColorStop(0, "#F26A1B"); bg.addColorStop(1, "#C4470A");
  g.fillStyle = bg; g.fillRect(0, 0, ${S}, ${S});
  // barcode
  g.fillStyle = "#FFFFFF";
  const bars = [16,8,24,8,8,16,32,8,16,8,24,16,8,8,24,8,16];
  let x = 212; bars.forEach((w, i) => { if (i % 2 === 0) g.fillRect(x, 250, w * 1.6, 400); x += w * 1.6 + 14; });
  // scan line
  g.fillStyle = "#FFD2B3"; g.fillRect(170, 438, 684, 22);
  // check badge
  g.beginPath(); g.arc(700, 720, 150, 0, Math.PI * 2); g.fillStyle = "#FFFFFF"; g.fill();
  g.strokeStyle = "#0F8F72"; g.lineWidth = 44; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.moveTo(630, 722); g.lineTo(685, 777); g.lineTo(780, 670); g.stroke();
  return Array.from(g.getImageData(0, 0, ${S}, ${S}).data);
})()`;

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
function rgbPng(rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const px = await page.evaluate(draw);
  await browser.close();
  const png = rgbPng(px, S, S);
  const root = path.join(__dirname, "..");
  fs.writeFileSync(path.join(root, "resources/icon.png"), png);
  fs.writeFileSync(path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), png);
  console.log("icon written");
})();
