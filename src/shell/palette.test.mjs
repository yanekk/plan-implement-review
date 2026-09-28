import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASIC_SGR, BASIC_SELECTED_BG, MOCHA_SGR, MOCHA_SELECTED_BG, paletteFor, truecolour } from './palette.mjs';

test('a terminal that says it shows 24-bit colour gets Mocha; any other keeps the basic codes', () => {
  assert.equal(truecolour({ COLORTERM: 'truecolor' }), true);
  assert.equal(truecolour({ COLORTERM: '24bit' }), true);
  assert.equal(truecolour({ FORCE_COLOR: '3' }), true);
  assert.equal(truecolour({}), false, 'no claim, no 24-bit colour');
  assert.equal(truecolour({ COLORTERM: 'yes', FORCE_COLOR: '1' }), false);
  assert.equal(truecolour({ COLORTERM: 'truecolor', NO_COLOR: '' }), false, 'NO_COLOR wins, whatever its value');
  assert.deepEqual(paletteFor({ COLORTERM: 'truecolor' }), { sgr: MOCHA_SGR, selectedBg: MOCHA_SELECTED_BG });
  assert.deepEqual(paletteFor({ TERM: 'xterm' }), { sgr: BASIC_SGR, selectedBg: BASIC_SELECTED_BG });
});

test('both tables colour exactly the same styles, so no style falls back to plain on one of them', () => {
  assert.deepEqual(Object.keys(MOCHA_SGR).sort(), Object.keys(BASIC_SGR).sort());
});

test('Mocha paints Catppuccin Mocha foregrounds and never a page background', () => {
  assert.equal(MOCHA_SGR.running, '\x1b[38;2;166;227;161m', 'running is Mocha green');
  assert.equal(MOCHA_SGR.crashed, '\x1b[38;2;243;139;168m', 'crashed is Mocha red');
  assert.equal(MOCHA_SGR.asking, '\x1b[1;38;2;249;226;175m', 'asking stays bold, in Mocha yellow');
  assert.equal(MOCHA_SGR.pir, '\x1b[38;2;250;179;135m', 'pir is Mocha peach');
  assert.equal(MOCHA_SELECTED_BG, '\x1b[48;2;49;50;68m', 'the selected band is Mocha surface0');
  // Every code is bold and/or a 24-bit foreground, nothing else: no background, so the terminal's shows through.
  for (const [style, code] of Object.entries(MOCHA_SGR)) assert.match(code, /^\x1b\[(1|(1;)?38;2;\d+;\d+;\d+)m$/, style);
});

test('the bold standouts stay bold in Mocha', () => {
  for (const style of ['asking', 'armed', 'your-go', 'prompt', 'head', 'worker']) assert.match(MOCHA_SGR[style], /^\x1b\[1[;m]/, style);
});
