// docs/single-runs.md and the README against the code (single-runs T13). Every text the docs quote — the
// box's notes, head line and hint, the refusal words, the red-round message, the row's states and
// progress, the steps view, the alerts — is generated here by the code that produces it and must appear
// in the docs verbatim (after joining wrapped lines), so a later rewording of either side fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COMMANDS, NOTES, headLine, startSingleFailedNote } from '../core/planbox.mjs';
import { RED_LIMIT, redMessage, leftoverMessage, singleProgress, singleSessionName, helperInstruction } from '../core/singleflow.mjs';
import { commandsRefusalText } from '../core/basebranch.mjs';
import { singleEndAlert, alertText, endAlert, holdAlert, finisherAlert } from '../core/notify.mjs';
import { finisherOpening } from '../core/finisher-brief.mjs';
import { singleChecks, singleRunState } from './single-run.mjs';
import { singleNoSessionNote } from '../core/dashboard.mjs';
import { SINGLE_HINT } from './list-view.mjs';
import { SINGLE_FOLLOW_LINE, MERGED_CHECK_MS } from './pir-tui.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Markdown wraps prose and table cells across lines; a quoted text is compared with the wrapping undone.
const flat = (s) => s.replace(/\s*\n\s*(?:\|\s*)?/g, ' ').replace(/\s+/g, ' ');
const DOC = flat(read('../../docs/single-runs.md'));
const FINISHER = flat(read('../../docs/finisher.md'));
const PLANNING = flat(read('../../docs/planning-runs.md'));
const README = read('../../README.md');

const has = (doc, text, where) => assert.ok(doc.includes(flat(text)), `${where} should quote: ${text}`);

test('docs/single-runs.md: the box texts are the code’s', () => {
  const single = COMMANDS.find((c) => c.name === 'single');
  has(DOC, `\`${single.description}\``, 'single-runs.md');
  has(DOC, NOTES.emptyPrompt('{name}'), 'single-runs.md');
  has(DOC, startSingleFailedNote('{name}', '{reason}'), 'single-runs.md');
  has(DOC, headLine('@r/single x', [{ name: 'r' }], { roots: '~/src' }).text.replace('r', '{name}'), 'single-runs.md');
  has(DOC, SINGLE_HINT, 'single-runs.md');
  const words = {
    'not-a-repo': {},
    'no-base-setting': {},
    'no-base-branch': { base: '{base}' },
    'fetch-failed': { remote: '{remote}' },
    diverged: { base: '{base}', remote: '{remote}' },
    'bad-settings': { why: '{why}' },
    'no-commands': {},
    'empty-prompt': {},
  };
  for (const [code, detail] of Object.entries(words)) {
    const text = startSingleFailedNote('N', code, detail).replace('Could not start the change in N: ', '');
    has(DOC, `| \`${code}\` | \`${text}\` |`, 'single-runs.md');
  }
});

test('docs/planning-runs.md: the box section names the third command with the code’s texts', () => {
  has(PLANNING, `\`${NOTES.noAt()}\``, 'planning-runs.md');
  has(PLANNING, `\`${NOTES.noCommand('{name}')}\``, 'planning-runs.md');
  has(PLANNING, `\`${NOTES.unknownCommand('{name}', '{command}')}\``, 'planning-runs.md');
  has(PLANNING, NOTES.emptyPrompt('{name}'), 'planning-runs.md');
  has(PLANNING, SINGLE_HINT, 'planning-runs.md');
  has(PLANNING, '`in {name} — /plan, /start or /single`', 'planning-runs.md');
  has(PLANNING, '`/{command} is not a command — /plan, /start or /single`', 'planning-runs.md');
  for (const c of COMMANDS) has(PLANNING, `\`${c.name}\` (\`${c.description}\`)`, 'planning-runs.md');
});

test('docs/single-runs.md: the refusal for missing commands is commandsRefusalText’s', () => {
  const text = commandsRefusalText({ reason: 'no-commands' }, { repo: '{repo}', repoFile: '{repoFile}', userFile: '{userFile}' });
  has(DOC, text, 'single-runs.md');
});

test('docs/single-runs.md: the red-round and leftover messages are the code’s', () => {
  const base = { sha: 'abcdef0123', reason: '{reason}', logPath: '{logPath}', tail: '', base: '{base}', baseSha: '0123456789' };
  const lines = (round, baseline) => redMessage({ ...base, round, baseline }).split('\n');
  const red = lines(1, { ok: true });
  has(DOC, red[0].replace('abcdef0', '{sha7}').replace('Round 1', 'Round {n}'), 'single-runs.md');
  has(DOC, red[1].replace('0123456', '{sha7}'), 'single-runs.md');
  has(DOC, red.at(-1), 'single-runs.md');
  has(DOC, lines(1, { ok: false, half: 'test' })[1].replace('0123456', '{sha7}'), 'single-runs.md');
  has(DOC, lines(1, { ok: false, half: 'setup', reason: '{reason}' })[1], 'single-runs.md');
  has(DOC, lines(RED_LIMIT + 1, { ok: true }).at(-1).replace(`round ${RED_LIMIT + 1}`, 'round {n}'), 'single-runs.md');
  has(DOC, leftoverMessage({ sha: 'abcdef0123', dirty: '' }).split('\n')[0].replace('abcdef0', '{sha7}'), 'single-runs.md');
});

test('docs/single-runs.md: progress cells, session names, steps-view notes and the follow line are the code’s', () => {
  const cells = [
    { step: 'build', phase: 'working' },
    { step: 'build', phase: 'testing' },
    { step: 'review', phase: 'working' },
    { step: 'review', phase: 'testing' },
    { step: 'review', outcome: 'ready' },
    { step: 'build', outcome: 'dropped' },
    { step: 'review', outcome: 'dropped' },
  ];
  for (const rs of cells) has(DOC, `\`${singleProgress(rs)}\``, 'single-runs.md');
  has(DOC, `\`${singleSessionName({ repo: '{repo}', run: '{id-or-name}', step: 'build' })}\``, 'single-runs.md');
  has(DOC, `\`${singleSessionName({ repo: '{repo}', run: '{name}', step: 'review' })}\``, 'single-runs.md');
  has(DOC, singleNoSessionNote({ id: 'review' }), 'single-runs.md');
  has(DOC, singleNoSessionNote({ id: 'merge' }), 'single-runs.md');
  has(DOC, SINGLE_FOLLOW_LINE, 'single-runs.md');
  assert.equal(MERGED_CHECK_MS, 30000);
  has(DOC, 'at most once every 30 s per row', 'single-runs.md');
});

test('docs/single-runs.md: the alerts are the code’s', () => {
  const end = singleEndAlert({ name: '{name}', base: '{base}' });
  has(DOC, `\`${end.title}\``, 'single-runs.md');
  has(DOC, `\`${end.message}\``, 'single-runs.md');
  assert.equal(alertText({ plan: '{name-or-label}', name: 'builder', kind: 'question', lastText: 'x' }).title, '{name-or-label} · builder');
  has(DOC, '`{name-or-label} · builder`', 'single-runs.md');
});

test('docs/README.md links single-runs.md; README.md links it and names @repo/single', () => {
  assert.match(read('../../docs/README.md'), /\]\(single-runs\.md\)/);
  assert.match(README, /\]\(docs\/single-runs\.md\)/);
  assert.match(README, /## Small changes without a plan — `@repo\/single`/);
  assert.match(README, /\(#small-changes-without-a-plan--reposingle\)/);
  assert.match(README, /pir-single\//);
});

// single-finisher T09: the end sequence's texts — the sync, its helpers, the finisher, the rows, the alerts.
test('docs/single-runs.md: the end sequence’s cells, names, notes and opening lines are the code’s', () => {
  const cells = [
    { step: 'sync', phase: 'working' },
    { step: 'sync', phase: 'testing' },
    { step: 'wait', end: { tests: 'green' } },
    { step: 'wait', end: { tests: 'red' } },
    { step: 'wait', outcome: 'finished' },
    { step: 'wait', outcome: 'merged' },
    { step: 'wait', outcome: 'closed' },
  ];
  for (const rs of cells) has(DOC, `\`${singleProgress(rs)}\``, 'single-runs.md');
  for (const step of ['resolve', 'fix']) {
    has(DOC, `\`${singleSessionName({ repo: '{repo}', run: '{name}', step })}\``, 'single-runs.md');
  }
  has(DOC, '`{repo} / {name} / single / finisher`', 'single-runs.md');
  has(FINISHER, '`{repo} / {name} / single / finisher`', 'finisher.md');
  has(DOC, singleNoSessionNote({ id: 'sync' }, { base: '{base}' }), 'single-runs.md');
  const head = helperInstruction({ role: 'fix', name: '{name}', base: '{base}', reportsDir: 'R' }).split('\n')[0];
  has(DOC, head.slice(0, head.indexOf(' Reports folder')).replace('fix', '{role}'), 'single-runs.md');
  const opening = finisherOpening({ kind: 'single', slug: '{name}', branch: 'pir/{name}', base: '{base}', promptPath: 'P' }).split('\n')[0];
  has(FINISHER, opening.replace('Invoke the pir-finisher skill and follow it. ', ''), 'finisher.md');
  const resolved = singleChecks({
    kind: 'resolved', name: 'n', run: { name: 'n' }, worktree: 'w',
    git: () => ({ ok: true, stdout: '' }), syncPending: () => true,
  });
  has(DOC, resolved.failures[0], 'single-runs.md');
});

test('docs/single-runs.md: the sync and merge rows read as singleRunState paints them', () => {
  const rows = (state, finisher = null) => {
    const steps = singleRunState({ id: 'single-0000', name: '{name}', base: '{base}', outcome: null, sessions: {}, ...state }, { finisher }).steps;
    return Object.fromEntries(steps.map((st) => [st.id, st.text]));
  };
  has(DOC, `\`${rows({ step: 'review' }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'sync', end: { phase: 'prepare' } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'sync', end: { phase: 'resolving' } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'sync', end: { phase: 'fixing' } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'sync', end: { phase: 'testing' } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'wait', end: { tests: 'green', sync: { state: 'up-to-date' } } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'wait', end: { tests: 'green', sync: { state: 'merged' } } }).sync}\``, 'single-runs.md');
  const red = rows({ step: 'wait', end: { tests: 'red', sync: { state: 'merged' } } });
  has(DOC, `\`${red.sync}\``, 'single-runs.md');
  has(DOC, `\`${red.merge}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'wait', end: { tests: 'red', sync: { state: 'unresolved' } } }).sync}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'sync', end: { phase: 'prepare' } }).merge}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'wait', end: { tests: 'green', finisher: 'fallback', fallback: 'failed' } }).merge}\``, 'single-runs.md');
  has(DOC, `\`${rows({ step: 'wait', outcome: 'finished' }).merge}\``, 'single-runs.md');
  assert.match(rows({ step: 'wait', end: { tests: 'green', finisher: 'on' } }).merge, /^◆ finisher {2}/);
});

test('docs/single-runs.md: the end sequence’s alerts are the code’s', () => {
  has(DOC, `\`${holdAlert({ slug: '{name}', hold: { text: 'x' } }).title}\``, 'single-runs.md');
  has(DOC, `\`${endAlert({ slug: '{name}', ready: false }).title}\``, 'single-runs.md');
  has(DOC, `\`${endAlert({ slug: '{name}', ready: false, reason: '{reason}' }).message}\``, 'single-runs.md');
  has(DOC, `\`${endAlert({ slug: '{name}', ready: false, unresolved: true, base: '{base}' }).message}\``, 'single-runs.md');
  for (const phase of ['awaiting-go', 'stuck', 'done', 'gave-up']) {
    has(DOC, `\`${finisherAlert({ slug: '{name}', phase, steps: ['x'], summary: 's' }).title}\``, 'single-runs.md');
  }
  assert.equal(alertText({ plan: '{name}', name: 'resolve', kind: 'question', lastText: 'x' }).title, '{name} · resolve');
  has(DOC, '`{name} · resolve`', 'single-runs.md');
  has(DOC, '`{name} · fix`', 'single-runs.md');
});

test('no doc says a single run has no finisher; the README names its finisher and links the doc', () => {
  // Build-only sentences (`--no-coordinator` has no finisher) are fine; a single run's are not.
  // A dropped run gets "no sync and no finisher"; the old claims were "No finisher" and "has no finisher".
  assert.doesNotMatch(DOC, /\bNo finisher|has no finisher|and no finisher: you merge/, 'single-runs.md should not say a single run has no finisher');
  for (const f of ['finisher.md', 'human-flow.md', 'control-folder.md', 'detached-runs.md', 'README.md']) {
    const text = flat(read(`../../docs/${f}`));
    assert.doesNotMatch(text, /single run[^.]*no finisher/i, `docs/${f} should not say a single run has no finisher`);
  }
  const section = README.slice(README.indexOf('## Small changes without a plan'), README.indexOf('## You set how much'));
  assert.match(section, /finisher/);
  assert.match(section, /`Go`/);
  assert.match(section, /\]\(docs\/single-runs\.md\)/);
  assert.doesNotMatch(flat(section), /no finisher/i);
});
