// The picture every ntfy alert carries (reliable-notifications DESIGN §2.5). Drawn in code, with no
// dependency beyond node:zlib, so a redo of the icon is a reviewed code change rather than a binary
// swapped in by hand. Run directly, it writes assets/pir-notify-icon.png; the test checks that the
// committed file equals a fresh encode, so the script and the file cannot drift apart.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ICON_PATH = fileURLToPath(new URL('../../assets/pir-notify-icon.png', import.meta.url));

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 8-bit RGBA, no interlace, every row with filter 0 (None). The icon is two flat colours, so
// deflate alone compresses it to well under the 20 KB budget; a smarter filter would buy nothing.
export function encodePng({ width, height, rgba }) {
  if (rgba.length !== width * height * 4) throw new Error(`rgba length ${rgba.length} != ${width}x${height}x4`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  // Level fixed so the committed file stays byte-equal to a fresh encode.
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Lowercase block glyphs on a 9-row grid: rows 0-1 are ascender (the dot of the i), rows 2-6 the
// x-height, rows 7-8 the descender of the p. Chunky strokes stay legible when the phone shrinks
// the icon to lock-screen size.
const GLYPHS = {
  p: ['....', '....', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  i: ['#', '.', '#', '#', '#', '#', '#', '.', '.'],
  r: ['....', '....', '#.##', '##..', '#...', '#...', '#...', '....', '....'],
};
const WORD = 'pir';
const GAP = 1; // blank grid columns between letters

export const BACKGROUND = [0x3b, 0x3f, 0xb6, 0xff]; // indigo
export const FOREGROUND = [0xff, 0xff, 0xff, 0xff]; // white

export function drawIcon(size = 256) {
  const rows = GLYPHS.p.length;
  const cols = [...WORD].reduce((n, ch, i) => n + GLYPHS[ch][0].length + (i ? GAP : 0), 0);
  // One grid cell is size/16 pixels: the 11×9 word then fits inside the circle a launcher may crop
  // the square to (its corners sit about 0.89 of the radius from the centre at size 256).
  const scale = Math.max(1, Math.floor(size / 16));
  const x0 = Math.floor((size - cols * scale) / 2);
  const y0 = Math.floor((size - rows * scale) / 2);

  const rgba = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) rgba.set(BACKGROUND, p * 4);

  let gx = 0;
  for (const ch of WORD) {
    const g = GLYPHS[ch];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] !== '#') continue;
        for (let dy = 0; dy < scale; dy++) {
          const y = y0 + r * scale + dy;
          for (let dx = 0; dx < scale; dx++) {
            const x = x0 + (gx + c) * scale + dx;
            rgba.set(FOREGROUND, (y * size + x) * 4);
          }
        }
      }
    }
    gx += g[0].length + GAP;
  }
  return { width: size, height: size, rgba };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const png = encodePng(drawIcon());
  mkdirSync(dirname(ICON_PATH), { recursive: true });
  writeFileSync(ICON_PATH, png);
  process.stdout.write(`wrote ${ICON_PATH} (${png.length} bytes)\n`);
}
