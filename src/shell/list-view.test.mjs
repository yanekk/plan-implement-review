// The runs list with its new-plan box (dashboard-plan-box §2.1–§2.7, T04): the component alone, on pi-tui's
// stub host as brief-box.test.mjs drives the brief box. Keys in, lines and callbacks out, no terminal. The
// same component under a real pty, mounted by runTui, is T05's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, visibleWidth } from '@earendil-works/pi-tui';

import { createListView, rootsLabel, tildify, HEAD_LABEL, TYPED_HINT, START_HINT, BARE_HINT_SUFFIX } from './list-view.mjs';
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

// skaut has two buildable plans, one of them building; shop has none (box-commands §2.2).
const PLANS = {
  '/home/p/src/skaut': [
    { slug: 'tents', done: 3, total: 8 },
    { slug: 'food', done: 0, total: 4 },
  ],
};

function view({ rows = 24, columns = 80, views = VIEWS, ui = initialUi() } = {}) {
  const calls = { submit: [], list: [], quit: 0, repos: 0, plansOf: [] };
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
    plansOf: (repo) => {
      calls.plansOf.push(repo.name);
      return PLANS[repo.path] ?? [];
    },
    building: (repo, slug) => repo.name === 'skaut' && slug === 'tents',
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
  const head = lines.findIndex((l) => l.startsWith('new  '));
  assert.equal(lines[head], 'new  start with @repo');
  assert.match(lines[head + 2], /^@/, 'the box line under its top border shows @');
  assert.equal(lines.at(-1), '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit', 'the footer, the suffix not fitting 80');
  assert.equal(v.text, '@');
});

test('bare at 120 columns: the footer gains ` · type @repo to plan or build`; every line fits the width', () => {
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
  assert.ok(lines.includes('new  plan in skaut'));
  assert.equal(lines.at(-1), TYPED_HINT);
  v.reset();
  type('nope x');
  lines = v.render(80).map(plain);
  assert.ok(lines.includes('new  @nope is not a repo in ~/src'));
  v.reset();
  v.handleInput('\x7f'); // backspace to an empty, still bare, box
  type(' x');
  assert.ok(v.render(80).map(plain).includes('new  start with @repo'), 'no name at all');
  await settle();
});

test('typed `@sk` opens the pop-up once it settles; Tab gives `@skaut/`', async () => {
  const { v, type } = view();
  type('sk');
  assert.equal(v.text, '@sk');
  await settle();
  assert.ok(v.completing, 'the repo pop-up is open');
  const lines = v.render(80).map(plain).join('\n');
  assert.match(lines, /@skaut.*~\/src\/skaut/, 'the row shows the name and its path, home as ~');
  assert.doesNotMatch(lines, /@shop/, 'only names containing `sk`');
  v.handleInput(TAB);
  assert.equal(v.text, '@skaut/');
});

test('the pop-up takes Enter to pick; nothing is submitted', async () => {
  const { v, type, calls } = view();
  type('pl');
  await settle();
  assert.ok(v.completing);
  v.handleInput(ENTER);
  assert.equal(v.text, '@plan-implement-review/');
  assert.deepEqual(calls.submit, []);
  await settle();
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
  const head = p.findIndex((l) => l.startsWith('new  '));
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
  const head = lines.findIndex((l) => l.startsWith('new  '));
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

// A paste over 10 lines sits in the box as pi-tui's `[paste #1 +N lines]` marker; the submit must carry the
// pasted text, not the marker (user 2026-09-29: the planner was handed a brief of just the marker).
test('Enter on a box holding a large paste submits the pasted text, not its marker', () => {
  const { v, calls, type } = view();
  const brief = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
  type('skaut/plan ');
  v.handleInput(PASTE(brief));
  assert.match(v.text, /^@skaut\/plan \[paste #1 \+12 lines\]$/);
  v.handleInput(ENTER);
  assert.deepEqual(calls.submit, [`@skaut/plan ${brief}`]);
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

// ---- box-commands T03: the pop-up walks the grammar (DESIGN §2.2, §2.5, §3.3) ----

const DOWN = '\x1b[B';
const BACKSPACE = '\x7f';
const popup = (v) => v.render(80).map(plain).join('\n');

test('`@sk` Enter → `@skaut/` and the command pop-up is showing, plan above start', async () => {
  const { v, type, calls } = view();
  type('sk');
  await settle();
  v.handleInput(ENTER);
  assert.equal(v.text, '@skaut/');
  await settle();
  assert.ok(v.completing, 'the command pop-up reopened after the repo pick');
  const shown = popup(v);
  assert.match(shown, /plan +plan something new/);
  assert.match(shown, /start +build a reviewed plan/);
  assert.ok(shown.indexOf('plan something new') < shown.indexOf('build a reviewed plan'));
  assert.deepEqual(calls.submit, []);
});

test('Tab on `start` → `@skaut/start ` and the slug pop-up lists the plans with progress and building', async () => {
  const { v, type } = view();
  type('skaut/');
  await settle();
  assert.ok(v.completing);
  v.handleInput(DOWN);
  v.handleInput(TAB);
  assert.equal(v.text, '@skaut/start ');
  await settle();
  assert.ok(v.completing, 'the slug pop-up opened');
  const shown = popup(v);
  assert.match(shown, /food +0\/4 done/);
  assert.match(shown, /tents +3\/8 done · building/);
  assert.doesNotMatch(shown, /food.*building/);
  assert.ok(shown.indexOf('food') < shown.indexOf('tents'), 'in slug order');
});

test('the `sk` ↵ ↓ ↵ ↵ path: a slug pick writes the slug, closes, and nothing reopens it', async () => {
  const { v, type, calls } = view();
  type('sk');
  await settle();
  v.handleInput(ENTER);
  await settle();
  v.handleInput(DOWN);
  v.handleInput(ENTER);
  assert.equal(v.text, '@skaut/start ');
  await settle();
  v.handleInput(ENTER);
  assert.equal(v.text, '@skaut/start food', 'no trailing space');
  assert.equal(v.completing, false);
  v.render(80);
  await settle();
  v.render(80);
  assert.equal(v.completing, false, 'not reopened after a render');
  assert.deepEqual(calls.submit, []);
  v.handleInput(ENTER);
  assert.deepEqual(calls.submit, ['@skaut/start food'], 'a second Enter submits');
});

test('a `plan` pick writes `@skaut/plan ` and opens no pop-up', async () => {
  const { v, type } = view();
  type('skaut/');
  await settle();
  v.handleInput(ENTER);
  assert.equal(v.text, '@skaut/plan ');
  await settle();
  assert.equal(v.completing, false);
});

test('typing `/` by hand after `@skaut` opens the command pop-up; `st` narrows it to start', async () => {
  const { v, type } = view();
  type('skaut');
  await settle();
  v.handleInput(ESC); // close the repo pop-up the name opened
  assert.equal(v.completing, false);
  type('/');
  await settle();
  assert.ok(v.completing, 'opened by the typed /');
  type('st');
  await settle();
  assert.ok(v.completing);
  const shown = popup(v);
  assert.match(shown, /start +build a reviewed plan/);
  assert.doesNotMatch(shown, /plan something new/);
});

test('a slug typed by hand narrows the slug pop-up; a deletion reopens it', async () => {
  const { v, type } = view();
  type('skaut/start ');
  await settle();
  assert.ok(v.completing);
  type('te');
  await settle();
  assert.match(popup(v), /tents/);
  assert.doesNotMatch(popup(v), /food/);
  v.handleInput(ESC);
  assert.equal(v.completing, false);
  v.handleInput(BACKSPACE);
  await settle();
  assert.ok(v.completing, 'the deletion reopened it');
  assert.equal(v.text, '@skaut/start t');
});

test('a repo pick on `@sk/plan brief` with the cursor in the name keeps `/plan brief`, no second `/`', async () => {
  const { v, type } = view();
  v.handleInput(PASTE('sk/plan brief'));
  assert.equal(v.text, '@sk/plan brief');
  for (let i = 0; i < '/plan brief'.length; i++) v.handleInput('\x1b[D'); // cursor back to after `@sk`
  v.handleInput(TAB); // no pop-up open: pi-tui's own Tab completion, one match applied
  await settle();
  assert.equal(v.text, '@skaut/plan brief', 'one match: applied at once');
  await settle();
  assert.equal(v.completing, false, 'the cursor is mid-line: nothing pops over the brief');
});

test('a repo pick on `@sk brief` adds the `/` in front of what followed', async () => {
  const { v } = view();
  v.handleInput(PASTE('sk brief'));
  for (let i = 0; i < ' brief'.length; i++) v.handleInput('\x1b[D');
  v.handleInput(TAB);
  await settle();
  assert.equal(v.text, '@skaut/ brief');
});

test('Esc closes an open pop-up and it stays closed; Esc again resets to @', async () => {
  const { v, type, calls } = view();
  type('skaut/');
  await settle();
  assert.ok(v.completing);
  v.handleInput(ESC);
  assert.equal(v.completing, false);
  assert.equal(v.text, '@skaut/');
  v.render(80);
  await settle();
  v.render(80);
  assert.equal(v.completing, false, 'stays closed');
  v.handleInput(ESC);
  assert.equal(v.text, '@');
  assert.equal(calls.quit, 0);
});

test('a repo with no buildable plan opens no slug pop-up, and the head line says so', async () => {
  const { v, type } = view();
  type('shop/start ');
  await settle();
  assert.equal(v.completing, false);
  assert.ok(v.render(80).map(plain).includes('new  nothing to build in shop'));
});

test('plansOf is called once per repo per typed stretch, and again after the box goes bare', async () => {
  const { v, type, calls } = view();
  type('skaut/plan a list');
  v.render(80);
  await settle();
  assert.deepEqual(calls.plansOf, [], 'typing a brief never scans plans');
  v.reset();
  type('skaut/start ');
  await settle();
  v.render(80);
  type('t');
  await settle();
  v.render(80);
  assert.deepEqual(calls.plansOf, ['skaut']);
  v.reset();
  type('shop/start ');
  await settle();
  v.render(80);
  assert.deepEqual(calls.plansOf, ['skaut', 'shop']);
  for (let i = 0; i < 'shop/start '.length; i++) v.handleInput(BACKSPACE); // bare by hand
  assert.equal(v.text, '@');
  type('skaut/start ');
  await settle();
  v.render(80);
  assert.deepEqual(calls.plansOf, ['skaut', 'shop', 'skaut']);
  assert.equal(v.plansOf(REPOS[0]), v.plansOf(REPOS[0]), 'the view hands its cached scan to the caller');
});

test('pinning: pi-tui Editor still has tryTriggerAutocomplete (box-commands §3.3)', () => {
  assert.equal(typeof Editor.prototype.tryTriggerAutocomplete, 'function');
});

test('head label `new`; `/start` hint; the armed line still wins over it', async () => {
  const { v, type } = view();
  type('skaut/start food');
  await settle();
  let lines = v.render(80).map(plain);
  assert.ok(lines.includes('new  build in skaut'));
  assert.equal(lines.at(-1), START_HINT);
  v.update({ ui: { ...initialUi(), armed: { action: 'stop', slug: 'alpha' } } });
  assert.equal(plain(v.render(80).at(-1)), '⚠ Ctrl+S again to stop alpha now — this kills its in-flight workers');
  v.reset();
  v.update({ ui: initialUi() });
  type('skaut/plan x');
  assert.equal(plain(v.render(80).at(-1)), TYPED_HINT);
  assert.equal(BARE_HINT_SUFFIX, ' · type @repo to plan or build');
  assert.equal(START_HINT, '↵ start the build · esc clear');
  await settle();
});

test('a Tab pick made while no pop-up shows still opens the next pop-up, and a slug Tab pick opens none', async () => {
  // pi-tui applies a lone Tab match only after its async lookup, so the pick lands after the key is handled.
  const { v, type } = view();
  type('sk');
  v.handleInput(TAB); // before the debounce has shown the repo pop-up
  await settle();
  assert.equal(v.text, '@skaut/');
  await settle();
  assert.ok(v.completing, 'the command pop-up opened after the Tab repo pick');
  v.reset();
  type('skaut/st');
  v.handleInput(TAB);
  await settle();
  assert.equal(v.text, '@skaut/start ');
  await settle();
  assert.ok(v.completing, 'the slug pop-up opened after the Tab command pick');
  v.reset();
  type('skaut/start te');
  await settle();
  v.handleInput(ESC);
  v.handleInput(TAB);
  await settle();
  assert.equal(v.text, '@skaut/start tents');
  await settle();
  assert.equal(v.completing, false, 'a slug pick reopens nothing');
});

// --- the mouse (mouse-navigation T05, DESIGN §2.2, §2.6, §3.2) ------------------------------------------

function mouseView(opts = {}) {
  const got = [];
  const tui = { requestRender() {}, terminal: { rows: opts.rows ?? 24, columns: 80 } };
  const v = createListView({
    tui,
    colour: opts.colour ?? false,
    repos: () => REPOS,
    roots: '~/src',
    dashboard: buildDashboard(VIEWS),
    home: HOME,
    onListMouse: (ev, frame) => (got.push({ ev, frame }), opts.answer ?? { handled: true }),
  });
  v.focused = true;
  return { v, got };
}
const ev = (type, y, x = 3, extra = {}) => ({ type, button: type === 'wheel' ? 'none' : 'left', x, y, screenX: x, screenY: y, width: 80, height: 24, ...extra });

test('mouse: an event on the list block reaches onListMouse with the block, whose run rows carry their hits', () => {
  const { v, got } = mouseView();
  const lines = v.render(80).map(plain);
  const alphaY = lines.findIndex((l) => /alpha/.test(l));
  const r = v.handleMouse(ev('click', alphaY));
  assert.deepEqual(r, { handled: true }, "onListMouse's answer is the component's");
  assert.equal(got.length, 1);
  assert.equal(got[0].ev.y, alphaY, 'screen coordinates, unshifted');
  assert.deepEqual(got[0].frame[alphaY].hit, { kind: 'run', index: 0 }, 'the frame is the list block as drawn');
  assert.equal(got[0].frame[0].hit, undefined, 'the title is no row');
});

test('mouse: a click in the box goes to the Editor, shifted to its rows, and never to onListMouse', () => {
  const { v, got } = mouseView();
  for (const ch of '@shop abc'.slice(1)) v.handleInput(ch);
  const lines = v.render(80).map(plain);
  const head = lines.findIndex((l) => l.startsWith(HEAD_LABEL + '  '));
  const r = v.handleMouse(ev('click', head + 2, 1));
  assert.ok(r?.handled && r.focus, 'the Editor took the click and asks for the focus');
  assert.equal(got.length, 0);
  v.handleInput('Z');
  assert.equal(v.text, '@Zshop abc', 'the caret moved to where the click was');
  // Press, drag and release are left alone, in the box as on the list, so text selection keeps working.
  for (const type of ['press', 'drag', 'release']) assert.equal(v.handleMouse(ev(type, head + 2, 1)), undefined, type);
});

test('mouse: a wheel or a pointer move over the box is still the list\'s; the hint line is the list\'s too', () => {
  const { v, got } = mouseView();
  const lines = v.render(80).map(plain);
  const head = lines.findIndex((l) => l.startsWith(HEAD_LABEL + '  '));
  v.handleMouse(ev('wheel', head + 2, 3, { wheelDelta: 3 }));
  v.handleMouse(ev('move', head + 2));
  v.handleMouse(ev('click', lines.length - 1));
  assert.deepEqual(got.map((g) => [g.ev.type, g.ev.y]), [['wheel', head + 2], ['move', head + 2], ['click', lines.length - 1]]);
  assert.equal(got[2].frame[lines.length - 1], undefined, 'no list line there, so no hit');
});

test('mouse: update({ hoverY }) paints that list row hovered, only a row with a hit, never the box', () => {
  const { v } = mouseView({ colour: true });
  const plainLines = v.render(80);
  const betaY = plainLines.map(plain).findIndex((l) => /beta/.test(l));
  v.update({ hoverY: betaY });
  const lit = v.render(80);
  assert.notEqual(lit[betaY], plainLines[betaY], 'beta repainted');
  assert.ok(lit[betaY].includes('\x1b[1m'), 'bold');
  assert.equal(plain(lit[betaY]), plain(plainLines[betaY]), 'the same text');
  lit.forEach((l, y) => y !== betaY && assert.equal(l, plainLines[y], `line ${y} unchanged`));
  v.update({ hoverY: 0 });
  assert.deepEqual(v.render(80), plainLines, 'the title does not hover');
  v.update({ hoverY: null });
  assert.deepEqual(v.render(80), plainLines);
});
