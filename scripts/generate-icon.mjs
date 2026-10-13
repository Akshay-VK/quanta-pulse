// Generates a 1024x1024 app icon (rounded accent tile with a pulse trace)
// as a PNG using only Node's built-in zlib. Run with: node scripts/generate-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZE = 1024;

// --- CRC32 -----------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- Drawing ---------------------------------------------------------------
const px = new Uint8ClampedArray(SIZE * SIZE * 4);

function set(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const srcA = a / 255;
  const dstA = px[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  px[i] = (r * srcA + px[i] * dstA * (1 - srcA)) / outA;
  px[i + 1] = (g * srcA + px[i + 1] * dstA * (1 - srcA)) / outA;
  px[i + 2] = (b * srcA + px[i + 2] * dstA * (1 - srcA)) / outA;
  px[i + 3] = outA * 255;
}

/** Signed distance to a rounded rectangle (negative = inside). */
function roundedRectSdf(x, y, x0, y0, x1, y1, radius) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - radius;
  const hh = (y1 - y0) / 2 - radius;
  const dx = Math.abs(x - cx) - hw;
  const dy = Math.abs(y - cy) - hh;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function distanceToSegment(px_, py_, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px_ - ax;
  const wy = py_ - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px_ - (ax + t * vx), py_ - (ay + t * vy));
}

// Accent tile: indigo with a subtle vertical gradient.
const TOP = [99, 102, 241];
const BOTTOM = [67, 56, 202];
const BG = [255, 255, 255];

const X0 = 60;
const Y0 = 60;
const X1 = 964;
const Y1 = 964;
const RADIUS = 220;

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

for (let y = 0; y < SIZE; y += 1) {
  const t = y / (SIZE - 1);
  const color = mix(TOP, BOTTOM, t);
  for (let x = 0; x < SIZE; x += 1) {
    const d = roundedRectSdf(x + 0.5, y + 0.5, X0, Y0, X1, Y1, RADIUS);
    const coverage = Math.max(0, Math.min(1, 0.5 - d));
    if (coverage > 0) set(x, y, color, coverage * 255);
  }
}

// White pulse trace (ECG-like) with round joins.
const STROKE = 46;
const points = [
  [150, 512],
  [360, 512],
  [455, 400],
  [560, 690],
  [660, 320],
  [760, 512],
  [880, 512],
];

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let minDist = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      const d = distanceToSegment(
        x + 0.5,
        y + 0.5,
        points[i][0],
        points[i][1],
        points[i + 1][0],
        points[i + 1][1],
      );
      if (d < minDist) minDist = d;
    }
    const coverage = Math.max(0, Math.min(1, STROKE / 2 - minDist));
    if (coverage > 0) set(x, y, BG, coverage * 255);
  }
}

// --- Encode -----------------------------------------------------------------
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE * 4; x += 1) {
    raw[y * (SIZE * 4 + 1) + 1 + x] = px[y * SIZE * 4 + x];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "app-icon.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
