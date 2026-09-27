import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BARE_TEXT, NOTES, absorbAt, headLine, isBare, parseBoxText, rankRepos, routeBoxKey, startFailedNote } from './planbox.mjs';

const ROOTS = '~/src';
const SKAUT = { name: 'skaut', path: '/Users/p/src/skaut', mtimeMs: 300 };
const PIR = { name: 'plan-implement-review', path: '/Users/p/src/plan-implement-review', mtimeMs: 200 };
const REPOS = [SKAUT, PIR];
const parse = (text, repos = REPOS) => parseBoxText(text, repos, { roots: ROOTS });
const head = (text, repos = REPOS) => headLine(text, repos, { roots: ROOTS });

// ─── isBare / BARE_TEXT (§2.2) ─────────────────────────────────────────────────

test('the box starts as @, and bare is exactly @ or empty', () => {
  assert.equal(BARE_TEXT, '@');
  assert.equal(isBare('@'), true);
  assert.equal(isBare(''), true);
  assert.equal(isBare('@s'), false);
  assert.equal(isBare('@ '), false);
  assert.equal(isBare(' '), false);
  assert.equal(isBare('hello'), false);
});

// ─── routeBoxKey (§2.3) ────────────────────────────────────────────────────────

const BARE = ['@', ''];
const TYPED = '@skaut a packing list';

for (const text of BARE) {
  for (const completing of [false, true]) {
    const at = `bare ${JSON.stringify(text)}${completing ? ', pop-up open' : ''}`;
    test(`${at}: ↑↓ select, → and Enter open — the list's`, () => {
      for (const key of ['up', 'down', 'right', 'enter']) assert.equal(routeBoxKey({ text, key, completing }), 'list', key);
    });
    test(`${at}: ← is the list's (a no-op there, as today)`, () => {
      assert.equal(routeBoxKey({ text, key: 'left', completing }), 'list');
    });
    test(`${at}: Ctrl+S/X/R arm and confirm — the list's`, () => {
      for (const key of ['ctrl+s', 'ctrl+x', 'ctrl+r']) assert.equal(routeBoxKey({ text, key, completing }), 'list', key);
    });
    test(`${at}: Esc and Ctrl+C quit`, () => {
      assert.equal(routeBoxKey({ text, key: 'escape', completing }), 'quit');
      assert.equal(routeBoxKey({ text, key: 'ctrl+c', completing }), 'quit');
    });
    test(`${at}: a printable, a paste and Backspace go to the box`, () => {
      assert.equal(routeBoxKey({ text, key: null, completing }), 'box');
      assert.equal(routeBoxKey({ text, key: 'a', completing }), 'box');
      assert.equal(routeBoxKey({ text, key: 'n', completing }), 'box'); // `n` is the go question's, not the list's
      assert.equal(routeBoxKey({ text, key: 'backspace', completing }), 'box');
      assert.equal(routeBoxKey({ text, key: 'tab', completing }), 'box');
    });
    test(`${at}: Shift+Enter / Ctrl+J (newLine) go to the box`, () => {
      assert.equal(routeBoxKey({ text, key: 'shift+enter', completing, newLine: true }), 'box');
      assert.equal(routeBoxKey({ text, key: 'ctrl+j', completing, newLine: true }), 'box');
    });
    // pi-tui parses a bare LF as 'enter' AND matches it against tui.input.newLine (ctrl+j); the list
    // opens on LF today (pir-tui decodeKey 'Enter (LF)'), and §1 keeps every list key on a bare box.
    test(`${at}: an LF Enter (key 'enter' matching newLine) still opens — the list's`, () => {
      assert.equal(routeBoxKey({ text, key: 'enter', completing, newLine: true }), 'list');
    });
  }
}

test('typed, pop-up open: every key goes to the pop-up (the box), chords and Esc included', () => {
  for (const key of ['up', 'down', 'left', 'right', 'enter', 'tab', 'escape', 'ctrl+c', 'ctrl+s', 'ctrl+x', 'ctrl+r', 'a', null]) {
    assert.equal(routeBoxKey({ text: '@sk', key, completing: true }), 'box', String(key));
  }
});

test('typed: Enter submits', () => {
  assert.equal(routeBoxKey({ text: TYPED, key: 'enter' }), 'submit');
});

test('typed: Enter with newLine true is box, never submit', () => {
  assert.equal(routeBoxKey({ text: TYPED, key: 'enter', newLine: true }), 'box');
  assert.equal(routeBoxKey({ text: TYPED, key: 'shift+enter', newLine: true }), 'box');
  assert.equal(routeBoxKey({ text: TYPED, key: 'ctrl+j', newLine: true }), 'box');
});

test('typed: Esc and Ctrl+C reset', () => {
  assert.equal(routeBoxKey({ text: TYPED, key: 'escape' }), 'reset');
  assert.equal(routeBoxKey({ text: TYPED, key: 'ctrl+c' }), 'reset');
  assert.equal(routeBoxKey({ text: 'hello', key: 'escape' }), 'reset');
});

test('typed: Ctrl+S/X/R go to the list, as on a bare box', () => {
  for (const key of ['ctrl+s', 'ctrl+x', 'ctrl+r']) assert.equal(routeBoxKey({ text: TYPED, key }), 'list', key);
});

test('typed: arrows and everything else go to the editor', () => {
  for (const key of ['up', 'down', 'left', 'right', 'backspace', 'tab', 'home', 'end', 'a', null]) {
    assert.equal(routeBoxKey({ text: TYPED, key }), 'box', String(key));
  }
});

// ─── absorbAt (§2.3) ──────────────────────────────────────────────────────────

test('absorbAt: an @ typed into a box that is exactly @ is dropped', () => {
  assert.equal(absorbAt('@', '@'), '');
  assert.equal(absorbAt('@', '@skaut x'), 'skaut x');
});

test('absorbAt: anything else is unchanged', () => {
  assert.equal(absorbAt('', '@'), '@');
  assert.equal(absorbAt('@s', '@'), '@');
  assert.equal(absorbAt('@', 's'), 's');
  assert.equal(absorbAt('@', 'x@y'), 'x@y');
});

// ─── parseBoxText (§2.5) ──────────────────────────────────────────────────────

test('parse: an exact name and a brief start a run', () => {
  assert.deepEqual(parse('@skaut a packing list'), { ok: true, repo: SKAUT, brief: 'a packing list' });
});

test('parse: no @ is no-at, with §2.5 row 1 note', () => {
  const r = parse('a packing list');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-at');
  assert.equal(r.note, 'start with @repo, then say what to plan');
});

test('parse: @ followed by whitespace (no name) is no-at, as a text without @ is', () => {
  assert.deepEqual(parse('@ a brief'), parse('a brief'));
  assert.equal(parse('@ a brief').reason, 'no-at');
  assert.equal(parse('@').reason, 'no-at');
  assert.equal(parse('').reason, 'no-at');
  assert.equal(parse(' @skaut x').reason, 'no-at');
});

test('parse: an unlisted name is unknown-repo, with §2.5 row 2 note', () => {
  const r = parse('@nope do it');
  assert.equal(r.reason, 'unknown-repo');
  assert.equal(r.name, 'nope');
  assert.equal(r.note, 'no repo @nope in ~/src — pick one from the list');
});

test('parse: exact names only — a prefix of a listed repo is unknown-repo', () => {
  const r = parse('@ska a packing list');
  assert.equal(r.reason, 'unknown-repo');
  assert.equal(r.note, 'no repo @ska in ~/src — pick one from the list');
  assert.equal(parse('@Skaut x').reason, 'unknown-repo'); // exact includes case
});

test('parse: two repos named alike are ambiguous-repo with both paths, §2.5 row 3 note', () => {
  const other = { name: 'skaut', path: '/Users/p/work/skaut', mtimeMs: 1 };
  const r = parse('@skaut a packing list', [SKAUT, other, PIR]);
  assert.equal(r.reason, 'ambiguous-repo');
  assert.equal(r.name, 'skaut');
  assert.deepEqual(r.paths, [SKAUT.path, other.path]);
  assert.equal(r.note, '@skaut is in more than one folder: /Users/p/src/skaut, /Users/p/work/skaut');
});

test('parse: a listed name with no brief is empty-brief, §2.5 row 4 note', () => {
  for (const text of ['@skaut', '@skaut   ', '@skaut\n\n  ']) {
    const r = parse(text);
    assert.equal(r.reason, 'empty-brief', JSON.stringify(text));
    assert.equal(r.name, 'skaut');
    assert.equal(r.note, 'say what to plan after @skaut');
  }
});

test('parse: an unknown name with no brief is unknown-repo (table order)', () => {
  assert.equal(parse('@nope').reason, 'unknown-repo');
});

test('parse: a multi-line brief keeps its newlines, trimmed at the ends', () => {
  assert.deepEqual(parse('@skaut  line one\n\nline two  \n'), { ok: true, repo: SKAUT, brief: 'line one\n\nline two' });
});

test('parse: a name followed by a newline then the brief parses', () => {
  assert.deepEqual(parse('@skaut\na packing list'), { ok: true, repo: SKAUT, brief: 'a packing list' });
});

test('startFailedNote: §2.5 row 5', () => {
  assert.equal(startFailedNote('skaut', 'no main branch'), 'Could not start planning in skaut: no main branch');
});

test('NOTES are §2.5 verbatim', () => {
  assert.equal(NOTES.noAt(), 'start with @repo, then say what to plan');
  assert.equal(NOTES.unknownRepo('x', '~/src'), 'no repo @x in ~/src — pick one from the list');
  assert.equal(NOTES.ambiguousRepo('x', ['/a/x', '/b/x']), '@x is in more than one folder: /a/x, /b/x');
  assert.equal(NOTES.emptyBrief('x'), 'say what to plan after @x');
});

// ─── headLine (§2.6) ──────────────────────────────────────────────────────────

test('headLine: bare is dim "start with @repo"', () => {
  assert.deepEqual(head('@'), { text: 'start with @repo', style: 'dim' });
  assert.deepEqual(head(''), { text: 'start with @repo', style: 'dim' });
});

test('headLine: a listed name is dim "in {name}", brief or not', () => {
  assert.deepEqual(head('@skaut'), { text: 'in skaut', style: 'dim' });
  assert.deepEqual(head('@skaut a packing list'), { text: 'in skaut', style: 'dim' });
});

test('headLine: an unlisted name is amber "@x is not a repo in {roots}"', () => {
  assert.deepEqual(head('@ska'), { text: '@ska is not a repo in ~/src', style: 'your-go' });
  assert.deepEqual(head('@nope do it'), { text: '@nope is not a repo in ~/src', style: 'your-go' });
});

test('headLine: no name at all is amber "start with @repo"', () => {
  assert.deepEqual(head('hello'), { text: 'start with @repo', style: 'your-go' });
  assert.deepEqual(head('@ hello'), { text: 'start with @repo', style: 'your-go' });
});

// ─── rankRepos (§2.4 ordering) ────────────────────────────────────────────────

test('rankRepos: newest first, equal mtimes by name, input not mutated', () => {
  const input = [
    { name: 'b', path: '/b', mtimeMs: 100 },
    { name: 'c', path: '/c', mtimeMs: 500 },
    { name: 'a', path: '/a', mtimeMs: 100 },
    { name: 'd', path: '/d', mtimeMs: 900 },
  ];
  const before = input.map((r) => r.name);
  const out = rankRepos(input);
  assert.deepEqual(out.map((r) => r.name), ['d', 'c', 'a', 'b']);
  assert.notEqual(out, input);
  assert.deepEqual(input.map((r) => r.name), before);
});

test('rankRepos: empty in, empty out', () => {
  assert.deepEqual(rankRepos([]), []);
});
