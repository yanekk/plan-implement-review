import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { encodePng, drawIcon, crc32, ICON_PATH, BACKGROUND, FOREGROUND } from './notify-icon.mjs';

// Walk the chunks of a PNG: [{ type, data, crcOk }].
function chunks(png) {
  const out = [];
  let o = 8;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString('ascii', o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + len);
    const crc = png.readUInt32BE(o + 8 + len);
    out.push({ type, data, crcOk: crc === crc32(png.subarray(o + 4, o + 8 + len)) });
    o += 12 + len;
  }
  return out;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
});

test('encodePng: signature, IHDR, one IDAT of filter-0 rows, IEND, valid CRCs', () => {
  const width = 3, height = 2;
  const rgba = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 37) & 0xff);
  const png = encodePng({ width, height, rgba });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const cs = chunks(png);
  assert.deepEqual(cs.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.ok(cs.every((c) => c.crcOk));
  const ihdr = cs[0].data;
  assert.equal(ihdr.readUInt32BE(0), width);
  assert.equal(ihdr.readUInt32BE(4), height);
  assert.equal(ihdr[8], 8);
  assert.equal(ihdr[9], 6);
  assert.deepEqual([...ihdr.subarray(10)], [0, 0, 0]);
  const raw = inflateSync(cs[1].data);
  assert.equal(raw.length, (width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (width * 4 + 1), (y + 1) * (width * 4 + 1));
    assert.equal(row[0], 0);
    assert.deepEqual([...row.subarray(1)], [...rgba.subarray(y * width * 4, (y + 1) * width * 4)]);
  }
  assert.equal(cs[2].data.length, 0);
});

test('encodePng rejects a pixel buffer of the wrong size', () => {
  assert.throws(() => encodePng({ width: 2, height: 2, rgba: new Uint8Array(15) }), /rgba length/);
});

test('drawIcon: deterministic, square, both colours present, letters inside the frame', () => {
  const a = drawIcon();
  const b = drawIcon();
  assert.equal(a.width, 256);
  assert.equal(a.height, 256);
  assert.deepEqual(a.rgba, b.rgba);
  const key = (p) => a.rgba.subarray(p * 4, p * 4 + 4).join(',');
  const counts = new Map();
  for (let p = 0; p < 256 * 256; p++) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  assert.deepEqual([...counts.keys()].sort(), [BACKGROUND.join(','), FOREGROUND.join(',')].sort());
  // The edges stay background: the word is centred with a margin, not clipped.
  for (let i = 0; i < 256; i++) {
    for (const p of [i, 255 * 256 + i, i * 256, i * 256 + 255]) assert.equal(key(p), BACKGROUND.join(','));
  }
  const small = drawIcon(64);
  assert.equal(small.width, 64);
  assert.equal(small.rgba.length, 64 * 64 * 4);
});

test('the committed PNG equals a fresh encode and is under 20 KB', () => {
  const committed = readFileSync(ICON_PATH);
  assert.ok(committed.length < 20 * 1024, `${committed.length} bytes`);
  assert.ok(committed.equals(encodePng(drawIcon())), 'assets/pir-notify-icon.png is stale: run node src/shell/notify-icon.mjs');
});
