// typeInto (paste.mjs): a repeated large paste expands the earlier marker in place. On a bare pi-tui Editor,
// so the private fields it relies on (pastes, pasteCounter, state, setCursorCol) are pinned against the
// installed pi-tui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@earendil-works/pi-tui';

import { typeInto } from './paste.mjs';
import { editorTheme } from './pir-view.mjs';

const PASTE = (s) => `\x1b[200~${s}\x1b[201~`;
const HOST = { requestRender() {}, terminal: { rows: 24, columns: 80 } };
const big = (tag, n = 12) => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');
const editor = () => {
  const e = new Editor(HOST, editorTheme(false));
  e.focused = true;
  return e;
};
const type = (e, s) => {
  for (const ch of s) typeInto(e, ch);
};

test('pi-tui still has the private fields typeInto relies on', () => {
  const e = editor();
  assert.ok(e.pastes instanceof Map);
  assert.equal(typeof e.pasteCounter, 'number');
  assert.ok(Array.isArray(e.state?.lines));
  assert.equal(typeof e.setCursorCol, 'function');
});

test('a first large paste collapses to a marker, as pi-tui does', () => {
  const e = editor();
  type(e, 'brief: ');
  typeInto(e, PASTE(big('a')));
  assert.equal(e.getText(), 'brief: [paste #1 +12 lines]');
  assert.equal(e.getExpandedText(), `brief: ${big('a')}`);
});

test('pasting the same text again expands the earlier marker and adds no second one', () => {
  const e = editor();
  type(e, 'brief: ');
  typeInto(e, PASTE(big('a')));
  type(e, ' end');
  typeInto(e, PASTE(big('a')));
  assert.equal(e.getText(), `brief: ${big('a')} end`);
  // The caret sits just after the expanded text, so typing continues there.
  type(e, '!');
  assert.equal(e.getText(), `brief: ${big('a')}! end`);
});

test('other markers survive an expansion, and a later paste takes a fresh number', () => {
  const e = editor();
  typeInto(e, PASTE(big('a')));
  type(e, ' ');
  typeInto(e, PASTE(big('b')));
  typeInto(e, PASTE(big('a')));
  assert.equal(e.getText(), `${big('a')} [paste #2 +12 lines]`);
  assert.equal(e.getExpandedText(), `${big('a')} ${big('b')}`);
  // The caret is after the expanded text, so the next paste lands there, numbered past every id used.
  type(e, ' ');
  typeInto(e, PASTE(big('c')));
  assert.equal(e.getText(), `${big('a')} [paste #4 +12 lines] [paste #2 +12 lines]`);
  assert.equal(e.getExpandedText(), `${big('a')} ${big('c')} ${big('b')}`);
});

test('a different paste, or one whose earlier marker was deleted, stays collapsed', () => {
  const e = editor();
  typeInto(e, PASTE(big('a')));
  typeInto(e, PASTE(big('b')));
  assert.equal(e.getText(), '[paste #1 +12 lines][paste #2 +12 lines]');
  const f = editor();
  typeInto(f, PASTE(big('a')));
  f.setText('');
  typeInto(f, PASTE(big('a')));
  assert.equal(f.getText(), '[paste #1 +12 lines]');
});

test('keys that are not pastes pass straight through', () => {
  const e = editor();
  type(e, 'hi');
  typeInto(e, '\x7f');
  assert.equal(e.getText(), 'h');
});
