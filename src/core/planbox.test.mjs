import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BARE_TEXT, COMMANDS, NOTES, absorbAt, completionContext, headLine, isBare, parseBoxText, rankRepos, routeBoxKey,
  startBuildFailedNote, startFailedNote,
} from './planbox.mjs';

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

// ─── parseBoxText (box-commands §2.1, §2.4) ───────────────────────────────────

// A plansOf that records every call, so a test can assert when the scan is (not) read.
function plansSpy(byRepo = { skaut: ['foo', 'foobar', 'packing'] }) {
  const calls = [];
  const fn = (repo) => {
    calls.push(repo.name);
    return (byRepo[repo.name] ?? []).map((slug) => ({ slug }));
  };
  return { fn, calls };
}
const parseWith = (text, plansOf, repos = REPOS) => parseBoxText(text, repos, { roots: ROOTS, plansOf });

test('parse: /plan with a brief plans, the brief trimmed and its newlines kept', () => {
  assert.deepEqual(parse('@skaut/plan a brief\nmore'), { ok: true, command: 'plan', repo: SKAUT, brief: 'a brief\nmore' });
  assert.deepEqual(parse('@skaut/plan  line one\n\nline two  \n'), { ok: true, command: 'plan', repo: SKAUT, brief: 'line one\n\nline two' });
  assert.deepEqual(parse('@skaut/plan\na packing list'), { ok: true, command: 'plan', repo: SKAUT, brief: 'a packing list' });
});

test('parse: /start with an offered slug starts that slug', () => {
  const { fn, calls } = plansSpy();
  assert.deepEqual(parseWith('@skaut/start foo', fn), { ok: true, command: 'start', repo: SKAUT, slug: 'foo' });
  assert.deepEqual(parseWith('@skaut/start   foo  \n', fn), { ok: true, command: 'start', repo: SKAUT, slug: 'foo' });
  assert.deepEqual(calls, ['skaut', 'skaut'], 'plansOf gets the resolved repo');
});

test('parse: no @name is no-at, §2.4 row 1', () => {
  for (const text of ['a packing list', '@ a brief', '@', '', ' @skaut/plan x', '@/plan x']) {
    const r = parse(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.equal(r.reason, 'no-at', JSON.stringify(text));
    assert.equal(r.note, 'start with @repo/plan or @repo/start');
  }
});

test('parse: an unlisted name is unknown-repo, §2.4 row 2, exact names only', () => {
  const r = parse('@nope/plan do it');
  assert.equal(r.reason, 'unknown-repo');
  assert.equal(r.name, 'nope');
  assert.equal(r.note, 'no repo @nope in ~/src — pick one from the list');
  assert.equal(parse('@ska/plan x').reason, 'unknown-repo');
  assert.equal(parse('@Skaut/plan x').reason, 'unknown-repo');
});

test('parse: two repos named alike are ambiguous-repo with both paths, §2.4 row 3', () => {
  const other = { name: 'skaut', path: '/Users/p/work/skaut', mtimeMs: 1 };
  const r = parse('@skaut/plan a packing list', [SKAUT, other, PIR]);
  assert.equal(r.reason, 'ambiguous-repo');
  assert.equal(r.name, 'skaut');
  assert.deepEqual(r.paths, [SKAUT.path, other.path]);
  assert.equal(r.note, '@skaut is in more than one folder: /Users/p/src/skaut, /Users/p/work/skaut');
});

test('parse: no /command is no-command, §2.4 row 4 — the old `@name brief` form included', () => {
  for (const text of ['@skaut brief', '@skaut', '@skaut/', '@skaut/ brief', '@skaut\nbrief']) {
    const r = parse(text);
    assert.equal(r.reason, 'no-command', JSON.stringify(text));
    assert.equal(r.name, 'skaut');
    assert.equal(r.note, 'pick a command: @skaut/plan or @skaut/start');
  }
});

test('parse: any other command is unknown-command, §2.4 row 5, lower case exact', () => {
  for (const cmd of ['Plan', 'START', 'bogus', 'pla', 'planx', 'plan/x']) {
    const r = parse(`@skaut/${cmd} x`);
    assert.equal(r.reason, 'unknown-command', cmd);
    assert.equal(r.command, cmd);
    assert.equal(r.note, `@skaut/${cmd} is not a command — use /plan or /start`);
  }
});

test('parse: /plan with no brief is empty-brief, §2.4 row 6', () => {
  for (const text of ['@skaut/plan', '@skaut/plan   ', '@skaut/plan\n\n  ']) {
    const r = parse(text);
    assert.equal(r.reason, 'empty-brief', JSON.stringify(text));
    assert.equal(r.note, 'say what to plan after @skaut/plan');
  }
});

test('parse: /start with no slug is no-slug, §2.4 row 7', () => {
  for (const text of ['@skaut/start', '@skaut/start  ', '@skaut/start\n']) {
    const r = parse(text);
    assert.equal(r.reason, 'no-slug', JSON.stringify(text));
    assert.equal(r.note, 'name a plan to build after @skaut/start');
  }
});

test('parse: /start with more than one word is extra-words, §2.4 row 8, a newline then a word included', () => {
  for (const text of ['@skaut/start foo bar', '@skaut/start foo\nbar', '@skaut/start foo\tbar']) {
    const r = parse(text);
    assert.equal(r.reason, 'extra-words', JSON.stringify(text));
    assert.equal(r.note, '@skaut/start takes one plan name');
  }
});

test('parse: /start with a slug plansOf does not offer, or a prefix of one, is unknown-slug, §2.4 row 9', () => {
  const { fn } = plansSpy();
  for (const slug of ['nope', 'fo', 'pack', 'Foo']) {
    const r = parseWith(`@skaut/start ${slug}`, fn);
    assert.equal(r.reason, 'unknown-slug', slug);
    assert.equal(r.slug, slug);
    assert.equal(r.note, `${slug} is not a reviewed, unfinished plan in skaut`);
  }
  assert.equal(parse('@skaut/start foo').reason, 'unknown-slug', 'no plansOf offers nothing');
});

test('parse: two rows that could both apply resolve to the earlier', () => {
  assert.equal(parse('@nope/bogus').reason, 'unknown-repo');
  assert.equal(parse('@nope').reason, 'unknown-repo');
  assert.equal(parse('@skaut/bogus').reason, 'unknown-command', 'not empty-brief or no-slug');
  const other = { name: 'skaut', path: '/b/skaut', mtimeMs: 1 };
  assert.equal(parse('@skaut', [SKAUT, other]).reason, 'ambiguous-repo');
});

test('parse: plansOf is not read for /plan, before the repo resolves, or for no-slug/extra-words', () => {
  const { fn, calls } = plansSpy();
  for (const text of ['@skaut/plan x', '@skaut/plan', '@nope/start foo', '@skaut/start', '@skaut/start a b', 'x', '@skaut', '@skaut/bogus x']) {
    parseWith(text, fn);
  }
  assert.deepEqual(calls, []);
});

test('startFailedNote: §2.4 startPlanRun row, codes in plain words', () => {
  assert.equal(startFailedNote('skaut', 'no main branch'), 'Could not start planning in skaut: no main branch');
  assert.equal(startFailedNote('repo', 'not-a-repo'), 'Could not start planning in repo: it is not a git repository');
  assert.equal(startFailedNote('repo', 'empty-brief'), 'Could not start planning in repo: the brief is empty');
  for (const code of ['not-a-repo', 'empty-brief']) assert.ok(startFailedNote('plan-implement-review', code).length <= 80, code);
});

test('startFailedNote: the base-branch refusals in short form (base-branch §2.9), naming base and remote when known', () => {
  const d = { base: 'dev', remote: 'origin' };
  assert.equal(startFailedNote('repo', 'no-base-setting', {}), 'Could not start planning in repo: no base branch is set');
  assert.equal(startFailedNote('repo', 'bad-settings', {}), 'Could not start planning in repo: its pir settings are broken');
  assert.equal(startFailedNote('repo', 'no-base-branch', d), 'Could not start planning in repo: dev does not exist');
  assert.equal(startFailedNote('repo', 'fetch-failed', d), "Could not start planning in repo: can't reach origin");
  assert.equal(startFailedNote('repo', 'diverged', d), 'Could not start planning in repo: dev split from origin/dev');
  // Without the detail each still reads, and the detail argument is optional.
  assert.equal(startFailedNote('repo', 'no-base-branch'), 'Could not start planning in repo: its base branch is missing');
  assert.equal(startFailedNote('repo', 'fetch-failed', null), "Could not start planning in repo: can't reach its remote");
  assert.equal(startFailedNote('repo', 'diverged', {}), 'Could not start planning in repo: base and remote split apart');
  for (const code of ['no-base-setting', 'bad-settings', 'no-base-branch', 'fetch-failed', 'diverged']) {
    assert.ok(startFailedNote('plan-implement-review', code, d).length <= 80, code);
    assert.ok(startFailedNote('plan-implement-review', code).length <= 80, code);
  }
  assert.equal(startFailedNote('repo', 'toString'), 'Could not start planning in repo: toString', 'an inherited name is not a code');
});

test('startBuildFailedNote: §2.4 startRun row, codes in plain words, anything else as it came', () => {
  assert.equal(startBuildFailedNote('skaut', 'foo', 'not-reviewed'), 'Could not start foo in skaut: it is not reviewed');
  assert.equal(startBuildFailedNote('skaut', 'foo', 'no-plan'), 'Could not start foo in skaut: there is no such plan');
  assert.equal(startBuildFailedNote('skaut', 'foo', 'no-test-block'), 'Could not start foo in skaut: no setup/test block');
  assert.equal(startBuildFailedNote('skaut', 'foo', 'disk full'), 'Could not start foo in skaut: disk full');
});

test('NOTES are §2.4 verbatim', () => {
  assert.equal(NOTES.noAt(), 'start with @repo/plan or @repo/start');
  assert.equal(NOTES.unknownRepo('x', '~/src'), 'no repo @x in ~/src — pick one from the list');
  assert.equal(NOTES.ambiguousRepo('x', ['/a/x', '/b/x']), '@x is in more than one folder: /a/x, /b/x');
  assert.equal(NOTES.noCommand('x'), 'pick a command: @x/plan or @x/start');
  assert.equal(NOTES.unknownCommand('x', 'go'), '@x/go is not a command — use /plan or /start');
  assert.equal(NOTES.emptyBrief('x'), 'say what to plan after @x/plan');
  assert.equal(NOTES.noSlug('x'), 'name a plan to build after @x/start');
  assert.equal(NOTES.extraWords('x'), '@x/start takes one plan name');
  assert.equal(NOTES.unknownSlug('x', 'foo'), 'foo is not a reviewed, unfinished plan in x');
});

test('COMMANDS: plan above start, with their pop-up descriptions', () => {
  assert.deepEqual(COMMANDS, [
    { name: 'plan', description: 'plan something new' },
    { name: 'start', description: 'build a reviewed plan' },
  ]);
});

// ─── completionContext (box-commands §2.2) ───────────────────────────────────

test('completionContext: the three contexts at the end of the line', () => {
  const at = (line) => completionContext(line, line.length);
  assert.deepEqual(at('@'), { kind: 'repo', query: '' });
  assert.deepEqual(at('@sk'), { kind: 'repo', query: 'sk' });
  assert.deepEqual(at('@skaut/'), { kind: 'command', name: 'skaut', query: '' });
  assert.deepEqual(at('@skaut/st'), { kind: 'command', name: 'skaut', query: 'st' });
  assert.deepEqual(at('@skaut/start '), { kind: 'slug', name: 'skaut', query: '' });
  assert.deepEqual(at('@skaut/start fo'), { kind: 'slug', name: 'skaut', query: 'fo' });
});

test('completionContext: null outside them', () => {
  const at = (line) => completionContext(line, line.length);
  for (const line of ['@skaut/plan x', '@skaut/plan ', '@skaut/start foo bar', '@skaut/start foo ', '@skaut x', '@skaut ', 'hello', '', '@ x', '@skaut/Start ', '@skaut/st4']) {
    assert.equal(at(line), null, JSON.stringify(line));
  }
});

test('completionContext: reads only the text before the cursor', () => {
  assert.deepEqual(completionContext('@skaut/plan a brief', 3), { kind: 'repo', query: 'sk' });
  assert.deepEqual(completionContext('@skaut/plan a brief', 1), { kind: 'repo', query: '' });
  assert.deepEqual(completionContext('@skaut/start foo bar', 15), { kind: 'slug', name: 'skaut', query: 'fo' });
  assert.deepEqual(completionContext('@skaut/start foo', 9), { kind: 'command', name: 'skaut', query: 'st' });
  assert.equal(completionContext('@skaut/plan a brief', 0), null);
});

// ─── headLine (box-commands §2.5) ────────────────────────────────────────────

test('headLine: every §2.5 row', () => {
  const { fn } = plansSpy({ skaut: ['foo'] });
  const h = (text) => headLine(text, REPOS, { roots: ROOTS, plansOf: fn });
  assert.deepEqual(h('@'), { text: 'start with @repo', style: 'dim' });
  assert.deepEqual(h(''), { text: 'start with @repo', style: 'dim' });
  assert.deepEqual(h('hello'), { text: 'start with @repo', style: 'your-go' });
  assert.deepEqual(h('@ hello'), { text: 'start with @repo', style: 'your-go' });
  assert.deepEqual(h('@ska'), { text: '@ska is not a repo in ~/src', style: 'your-go' });
  assert.deepEqual(h('@nope/plan do it'), { text: '@nope is not a repo in ~/src', style: 'your-go' });
  for (const t of ['@skaut', '@skaut a brief', '@skaut/']) assert.deepEqual(h(t), { text: 'in skaut — /plan or /start', style: 'dim' }, t);
  assert.deepEqual(h('@skaut/bogus x'), { text: '/bogus is not a command — /plan or /start', style: 'your-go' });
  assert.deepEqual(h('@skaut/plan'), { text: 'plan in skaut', style: 'dim' });
  assert.deepEqual(h('@skaut/plan a packing list'), { text: 'plan in skaut', style: 'dim' });
  assert.deepEqual(h('@skaut/start'), { text: 'build in skaut', style: 'dim' });
  assert.deepEqual(h('@skaut/start foo'), { text: 'build in skaut', style: 'dim' });
  assert.deepEqual(h('@plan-implement-review/start '), { text: 'nothing to build in plan-implement-review', style: 'your-go' });
  assert.deepEqual(head('@skaut/start x'), { text: 'nothing to build in skaut', style: 'your-go' }, 'no plansOf offers nothing');
});

test('headLine: plansOf is read only in the /start rows', () => {
  const { fn, calls } = plansSpy();
  for (const t of ['@', '', 'x', '@nope/start', '@skaut', '@skaut/', '@skaut/bogus', '@skaut/plan x']) headLine(t, REPOS, { roots: ROOTS, plansOf: fn });
  assert.deepEqual(calls, []);
  headLine('@skaut/start', REPOS, { roots: ROOTS, plansOf: fn });
  assert.deepEqual(calls, ['skaut']);
});

// ─── 80 columns (box-commands §2.5's last line) ──────────────────────────────

test('every note and head line fits 80 columns at an 18-character repo name and slug', () => {
  const name = 'r'.repeat(18);
  const slug = 's'.repeat(18);
  const repos = [{ name, path: `/Users/p/src/${name}`, mtimeMs: 1 }];
  const notes = [
    NOTES.noAt(), NOTES.unknownRepo(name, ROOTS), NOTES.noCommand(name), NOTES.unknownCommand(name, slug),
    NOTES.emptyBrief(name), NOTES.noSlug(name), NOTES.extraWords(name), NOTES.unknownSlug(name, slug),
    startBuildFailedNote(name, slug, 'not-reviewed'), startBuildFailedNote(name, slug, 'no-plan'),
    startBuildFailedNote(name, slug, 'no-test-block'), startFailedNote(name, 'not-a-repo'),
    ...['no-base-setting', 'bad-settings', 'no-base-branch', 'fetch-failed', 'diverged'].map((c) => startFailedNote(name, c, { base: 'dev', remote: 'origin' })),
  ];
  for (const n of notes) assert.ok(n.length <= 80, `${n.length}: ${n}`);
  // The label `new` and two spaces precede the head words (§2.5).
  const heads = [
    [`@${name}`, () => []], [`@${slug}x`, () => []], [`@${name}/${slug}`, () => []], [`@${name}/plan x`, () => []],
    [`@${name}/start`, () => [{ slug }]], [`@${name}/start`, () => []],
  ].map(([t, plansOf]) => headLine(t, repos, { roots: ROOTS, plansOf }).text);
  for (const h of heads) assert.ok(`new  ${h}`.length <= 80, h);
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
