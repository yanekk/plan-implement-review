// The runs list with its new-plan box (dashboard-plan-box §2.1–§2.7, T04): the component alone, on pi-tui's
// stub host as brief-box.test.mjs drives the brief box. Keys in, lines and callbacks out, no terminal. The
// same component under a real pty, mounted by runTui, is T05's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';

import { createListView, rootsLabel, tildify, TYPED_HINT, BARE_HINT_SUFFIX } from './list-view.mjs';
import { buildDashboard, initialUi } from '../core/dashboard.mjs';

const ESC = '\x1b';
const TAB = '\t';
const ENTER = '\r';
const CTRL_S = '\x13';
const CTRL_C = '\x03';
const PASTE = (s) => `\x1b[200~${s}\x1b[201~`;
const plain = (l) => l.replace(/\x1b\[[0-9;]*m|\x1b_[^\x07]*\x07/g, '');
const settle = () => new Promise((r) => setTimeout(r, 60)); // the @ pop-up is debounced 20ms, then async

const HOME = '/home/p';
const REPOS = [
  { name: 'skaut', path: '/home/p/src/skaut' },
  { name: 'shop', path: '/home/p/src/shop' },
  { name: 'plan-implement-review', path: '/home/p/src/plan-implement-review' },
];
const VIEWS = [
  { slug: 'alpha', state: 'running', repo: 'repoA', progress: { done: 3, total: 8 }, workers: 2 },
  { slug: 'beta', state: 'crashed', repo: 'repoB', progress: { done: 1, total: 5 }, workers: 0 },
];
const manyViews = (n) => Array.from({ length: n }, (_, i) => ({ slug: `run-${String(i).padStart(2, '0')}`, state: 'finished', repo: 'r', progress: { done: 1, total: 1 }, workers: 0 }));

function view({ rows = 24, columns = 80, views = VIEWS, ui = initialUi() } = {}) {
  const calls = { submit: [], list: [], quit: 0, repos: 0 };
  const tui = { requestRender() {}, terminal: { rows, columns } };
  const v = createListView({
    tui,
    colour: false,
    repos: () => {
      calls.repos += 1;
      return REPOS;
    },
    roots: '~/src',
    dashboard: buildDashboard(views),
    ui,
    onSubmit: (t) => calls.submit.push(t),
    onListKey: (d) => calls.list.push(d),
    onQuit: () => (calls.quit += 1),
    home: HOME,
  });
  v.focused = true;
  const type = (s) => {
    for (const ch of s) v.handleInput(ch);
  };
  return { v, calls, type, tui };
}

const fitsWidth = (lines, w) => lines.every((l) => visibleWidth(l) <= w);

test('bare: the list, then head `start with @repo`, the box showing @, and the list footer', () => {
  const { v } = view();
  const lines = v.render(80).map(plain);
  assert.equal(lines.length, 24, 'the whole screen: the box pinned to the bottom');
  assert.match(lines[0], /pir {2}runs on this machine/);
  assert.match(lines.join('\n'), /▎ alpha/);
  const head = lines.findIndex((l) => l.startsWith('new plan'));
  assert.equal(lines[head], 'new plan  start with @repo');
  assert.match(lines[head + 2], /^@/, 'the box line under its top border shows @');
  assert.equal(lines.at(-1), '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit', 'the footer, the suffix not fitting 80');
  assert.equal(v.text, '@');
});

test('bare at 120 columns: the footer gains ` · type to plan (@repo)`; every line fits the width', () => {
  const { v } = view({ columns: 120, rows: 40 });
  const lines = v.render(120);
  assert.ok(plain(lines.at(-1)).endsWith(BARE_HINT_SUFFIX));
  assert.ok(fitsWidth(lines, 120));
  assert.ok(fitsWidth(view().v.render(80), 80));
});

test('typed: the head names the repo, amber when it is not one, and the hint is the typing hint', async () => {
  const { v, type } = view();
  type('@skaut/plan a list');
  let lines = v.render(80).map(plain);
  assert.ok(lines.includes('new plan  plan in skaut'));
  assert.equal(lines.at(-1), TYPED_HINT);
  v.reset();
  type('nope x');
  lines = v.render(80).map(plain);
  assert.ok(lines.includes('new plan  @nope is not a repo in ~/src'));
  v.reset();
  v.handleInput('\x7f'); // backspace to an empty, still bare, box
  type(' x');
  assert.ok(v.render(80).map(plain).includes('new plan  start with @repo'), 'no name at all');
  await settle();
});

test('typed `@sk` opens the pop-up once it settles; Tab gives `@skaut `', async () => {
  const { v, type } = view();
  type('sk');
  assert.equal(v.text, '@sk');
  await settle();
  assert.ok(v.completing, 'the repo pop-up is open');
  const lines = v.render(80).map(plain).join('\n');
  assert.match(lines, /@skaut.*~\/src\/skaut/, 'the row shows the name and its path, home as ~');
  assert.doesNotMatch(lines, /@shop/, 'only names containing `sk`');
  v.handleInput(TAB);
  assert.equal(v.text, '@skaut ');
  assert.equal(v.completing, false);
});

test('the pop-up takes Enter to pick; nothing is submitted', async () => {
  const { v, type, calls } = view();
  type('pl');
  await settle();
  assert.ok(v.completing);
  v.handleInput(ENTER);
  assert.equal(v.text, '@plan-implement-review ');
  assert.deepEqual(calls.submit, []);
});

test('no pop-up on a bare box, nor once the cursor leaves the first token', async () => {
  const { v, type } = view();
  type('@');
  await settle();
  assert.equal(v.completing, false, 'bare');
  type('skaut @sh');
  await settle();
  assert.equal(v.completing, false, 'an @ inside the brief is text');
});

test('a 200-character brief at 80 columns wraps to three box lines, every line within 80', () => {
  const { v } = view();
  const brief = ('a packing list for the scout camp with tents and food ' .repeat(4)).slice(0, 193);
  v.handleInput(PASTE('skaut ' + brief));
  assert.equal(v.text.length, 200);
  const lines = v.render(80);
  const p = lines.map(plain);
  const head = p.findIndex((l) => l.startsWith('new plan'));
  const boxLines = p.slice(head + 2, -2);
  assert.equal(boxLines.length, 3, 'three text lines between the borders');
  assert.ok(fitsWidth(lines, 80));
  assert.equal(lines.length, 24, 'the list gave up the rows');
});

test('30 runs at 80×12: the selected row shows at top, middle and bottom with the right counts', () => {
  for (const [sel, up, down] of [[0, 0, 26], [15, 14, 13], [29, 26, 0]]) {
    const { v } = view({ rows: 12, views: manyViews(30), ui: { ...initialUi(), sel } });
    const lines = v.render(80).map(plain);
    const text = lines.join('\n');
    assert.equal(lines.length, 12);
    assert.match(text, new RegExp(`▎ run-${String(sel).padStart(2, '0')}`));
    assert.doesNotMatch(text, /runs on this machine/, 'the title went, after the spacers');
    assert.match(text, /SLUG/, 'the header stays');
    assert.match(text, /30 runs/, 'the counts stay');
    if (up) assert.match(text, new RegExp(`↑ ${up} more`));
    if (down) assert.match(text, new RegExp(`↓ ${down} more`));
  }
});

test('a short screen with room for one row shows the selected one and no marker', () => {
  const { v, type } = view({ rows: 12, views: manyViews(30), ui: { ...initialUi(), sel: 7 } });
  v.update({ note: 'a note' });
  type('skaut ');
  v.handleInput(PASTE('tent '.repeat(60).trim())); // four box text lines: 12 − 6 box − note − head − hint = 3
  const lines = v.render(80).map(plain);
  assert.equal(lines.length, 12);
  assert.match(lines[0], /SLUG/, 'the header stays');
  assert.match(lines[1], /^▎ run-07/, 'the one row is the selected one');
  assert.match(lines[2], /30 runs/, 'the counts stay');
  assert.doesNotMatch(lines.join('\n'), /more/);
});

test('update with an armed chord shows the armed footer on a bare box', () => {
  const { v } = view();
  v.update({ ui: { ...initialUi(), armed: { action: 'stop', slug: 'alpha' } } });
  assert.equal(plain(v.render(80).at(-1)), '⚠ Ctrl+S again to stop alpha now — this kills its in-flight workers');
  v.update({ note: 'no repo @x in ~/src — pick one from the list' });
  const lines = v.render(80).map(plain);
  const head = lines.findIndex((l) => l.startsWith('new plan'));
  assert.equal(lines[head - 1], 'no repo @x in ~/src — pick one from the list', 'the note sits above the head line');
});

// T06 drill: over a typed brief the typing hint hid the armed line, so a second Ctrl+S stopped a run with no
// warning on screen (user, 2026-09-27: show it).
test('an armed chord shows its ⚠ line over a typed box too; disarmed, the typing hint is back', () => {
  const { v, type } = view();
  type('@skaut a list');
  v.update({ ui: { ...initialUi(), armed: { action: 'stop', slug: 'alpha' } } });
  assert.equal(plain(v.render(80).at(-1)), '⚠ Ctrl+S again to stop alpha now — this kills its in-flight workers');
  v.update({ ui: initialUi() });
  assert.equal(plain(v.render(80).at(-1)), TYPED_HINT);
});

test('repos() is called once per typed stretch, and again after reset()', () => {
  const { v, calls, type } = view();
  v.render(80);
  assert.equal(calls.repos, 0, 'a bare box never scans');
  type('sk');
  v.render(80);
  type('aut x');
  v.render(80);
  assert.equal(calls.repos, 1);
  v.reset();
  assert.equal(v.text, '@');
  type('s');
  v.render(80);
  assert.equal(calls.repos, 2);
  v.handleInput('\x7f'); // back to bare by hand
  type('s');
  v.render(80);
  assert.equal(calls.repos, 3);
});

test('Esc and Ctrl+C on a typed box reset it to @ and clear the note, calling neither onQuit nor onListKey', () => {
  const { v, calls, type } = view();
  for (const key of [ESC, CTRL_C]) {
    type('skaut half');
    v.update({ note: 'say what to plan after @skaut' });
    v.handleInput(key);
    assert.equal(v.text, '@');
    assert.equal(calls.quit, 0);
    assert.deepEqual(calls.list, []);
    assert.ok(!v.render(80).map(plain).includes('say what to plan after @skaut'));
  }
  v.handleInput(ESC);
  assert.equal(calls.quit, 1, 'the second Esc, on the bare box, quits');
});

test('on a bare box the list keys go to the list; Enter on a typed box submits the text', () => {
  const { v, calls, type } = view();
  for (const k of ['\x1b[A', '\x1b[B', '\x1b[C', ENTER, CTRL_S, '\n']) v.handleInput(k);
  assert.deepEqual(calls.list, ['\x1b[A', '\x1b[B', '\x1b[C', ENTER, CTRL_S, '\n']);
  calls.list.length = 0;
  type('skaut a list');
  v.handleInput('\n'); // ctrl+j: a new line, not a submit
  type('two');
  v.handleInput(CTRL_S); // a chord still reaches the list
  assert.deepEqual(calls.list, [CTRL_S]);
  v.handleInput(ENTER);
  assert.deepEqual(calls.submit, ['@skaut a list\ntwo']);
  assert.equal(v.text, '@skaut a list\ntwo', 'the box keeps its text; the caller resets it on a start');
});

test('typing or pasting `@skaut` on a bare box gives `@skaut`, not `@@skaut`', () => {
  const a = view();
  a.type('@skaut');
  assert.equal(a.v.text, '@skaut');
  const b = view();
  b.v.handleInput(PASTE('@skaut go'));
  assert.equal(b.v.text, '@skaut go');
});

test('tildify and rootsLabel write the home folder as ~', () => {
  assert.equal(tildify('/home/p/src/a', HOME), '~/src/a');
  assert.equal(tildify('/home/pa/src', HOME), '/home/pa/src');
  assert.equal(rootsLabel(['/home/p/src', '/work'], HOME), '~/src, /work');
  assert.equal(rootsLabel('~/src', HOME), '~/src');
});
