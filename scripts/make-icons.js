// Génère les icônes PNG de la PWA sans dépendance (rasterisation maison + encodeur PNG).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public/icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const C1 = [0xb9, 0xa8, 0xff];
const C2 = [0xf7, 0xae, 0xcf];

function insideRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Échantillonne la couleur (prémultipliée) en coordonnées normalisées 0..1.
function sample(x, y, { radius, scale, badge }) {
  // Les cercles sont dessinés dans une zone réduite (scale) pour les icônes "maskable".
  const u = 0.5 + (x - 0.5) / scale;
  const v = 0.5 + (y - 0.5) / scale;
  const R = 110 / 512;
  const inA = (u - 205 / 512) ** 2 + (v - 0.5) ** 2 <= R * R;
  const inB = (u - 307 / 512) ** 2 + (v - 0.5) ** 2 <= R * R;

  if (badge) {
    const a = inA && inB ? 1 : inA || inB ? 0.55 : 0;
    return [a, a, a, a];
  }
  if (!insideRoundRect(x, y, radius)) return [0, 0, 0, 0];
  const t = (x + y) / 2;
  let rgb = C1.map((c, i) => (c + (C2[i] - c) * t) / 255);
  const white = inA && inB ? 1 : inA || inB ? 0.5 : 0;
  rgb = rgb.map((c) => c * (1 - white) + white);
  return [...rgb, 1];
}

function render(size, opts) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      buf[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        buf[i] = Math.round((r / a) * 255);
        buf[i + 1] = Math.round((g / a) * 255);
        buf[i + 2] = Math.round((b / a) * 255);
      }
    }
  }
  return encodePng(size, buf);
}

const icons = [
  ['icon-192.png', 192, { radius: 112 / 512, scale: 1 }],
  ['icon-512.png', 512, { radius: 112 / 512, scale: 1 }],
  ['icon-maskable-512.png', 512, { radius: 0, scale: 0.8 }],
  ['apple-touch-icon.png', 180, { radius: 0, scale: 0.9 }],
  ['badge-96.png', 96, { badge: true, scale: 1.25 }],
];
for (const [name, size, opts] of icons) {
  fs.writeFileSync(path.join(OUT, name), render(size, opts));
  console.log('✓', name);
}
