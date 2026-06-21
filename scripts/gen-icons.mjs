// Dev utility: generate the PWA PNG icons (committed to assets/img/).
// Not part of the runtime — run with `node scripts/gen-icons.mjs` if the icons
// need regenerating. Builds valid PNGs from raw RGBA using Node's zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x15, 0x17, 0x1c];
const ACCENT = [0x5b, 0x9d, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function u32(n) {
  return Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

// Draw a centered rounded square motif. `fg` square covers `frac` of the icon.
function makeIcon(size, bg, fg, frac) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const sq = Math.round(size * frac);
  const off = Math.round((size - sq) / 2);
  const radius = Math.round(sq * 0.22);

  const inRounded = (x, y) => {
    if (x < off || x >= off + sq || y < off || y >= off + sq) return false;
    const lx = x - off;
    const ly = y - off;
    // round the four corners
    if ((lx < radius || lx > sq - radius) && (ly < radius || ly > sq - radius)) {
      const cx = lx < radius ? radius : sq - radius;
      const cy = ly < radius ? radius : sq - radius;
      return (lx - cx) ** 2 + (ly - cy) ** 2 <= radius ** 2;
    }
    return true;
  };

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 4;
      const c = inRounded(x, y) ? fg : bg;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
      raw[p + 3] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]));
  const idat = chunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

mkdirSync('assets/img', { recursive: true });
writeFileSync('assets/img/icon-192.png', makeIcon(192, BG, ACCENT, 0.6));
writeFileSync('assets/img/icon-512.png', makeIcon(512, BG, ACCENT, 0.6));
// Maskable: accent fills the canvas (survives circular masking), dark motif inside.
writeFileSync('assets/img/icon-maskable-512.png', makeIcon(512, ACCENT, BG, 0.5));
console.log('Generated icon-192.png, icon-512.png, icon-maskable-512.png');
