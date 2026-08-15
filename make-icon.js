// Generates a simple app icon (icon.ico with a 256x256 PNG entry) using only
// Node built-ins (zlib), so no extra dependencies are needed.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 256;

// ── pixel canvas ──────────────────────────────────────────────────────────
const px = new Uint8Array(SIZE * SIZE * 4); // RGBA, transparent by default

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const srcA = a / 255;
  const dstA = px[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  px[i] = Math.round((r * srcA + px[i] * dstA * (1 - srcA)) / outA);
  px[i + 1] = Math.round((g * srcA + px[i + 1] * dstA * (1 - srcA)) / outA);
  px[i + 2] = Math.round((b * srcA + px[i + 2] * dstA * (1 - srcA)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// SDF helpers
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

// ── design ────────────────────────────────────────────────────────────────
const cx = SIZE / 2;
const cy = SIZE / 2;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Rounded-square background (dark navy)
    const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, 118, 118, 52);
    if (d < 0) {
      const t = Math.max(0, Math.min(1, (d + 2) / 4)); // 2px anti-alias
      blend(x, y, 13, 17, 28, Math.round(255 * (1 - t)));
      blend(x, y, 20, 26, 44, Math.round(255 * t));
    }
    // Inner circle (gradient cyan→blue)
    const dc = sdCircle(x + 0.5, y + 0.5, cx, cy, 74);
    if (dc < 0) {
      const t = Math.max(0, Math.min(1, (dc + 2) / 4));
      const grad = (x + y) / (2 * SIZE); // 0..1 diagonal
      const r = Math.round(77 + 40 * grad);
      const g = Math.round(159 + 40 * (1 - grad));
      const b = Math.round(255 - 30 * grad);
      blend(x, y, r, g, b, Math.round(255 * (1 - t)));
    }
    // White "harness" gap: draw a ring (subtract) by painting background color
    const ring = sdCircle(x + 0.5, y + 0.5, cx, cy, 54);
    if (ring < 0) {
      const ring2 = sdCircle(x + 0.5, y + 0.5, cx, cy, 46);
      if (ring2 >= 0) {
        const t = Math.max(0, Math.min(1, (ring + 2) / 4));
        // paint the ring in the background navy color
        blend(x, y, 13, 17, 28, Math.round(255 * (1 - t)));
        blend(x, y, 20, 26, 44, Math.round(255 * t));
      }
    }
  }
}

// ── PNG encode ────────────────────────────────────────────────────────────
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy ? rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const png = encodePNG(SIZE, SIZE, px);

// ── ICO container (single 256x256 PNG entry, Windows Vista+) ──────────────
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 0 => 256
entry[1] = 0; // height 0 => 256
entry[2] = 0; // colors
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8); // size
entry.writeUInt32LE(22, 12); // offset (6 + 16)

const out = Buffer.concat([header, entry, png]);
const dest = path.join(__dirname, "assets", "icon.ico");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log("wrote", dest, out.length, "bytes");
