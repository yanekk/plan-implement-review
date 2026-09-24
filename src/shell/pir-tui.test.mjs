// The dashboard TUI (DESIGN §2.3, §2.4, §2.6, §2.7, §2.11; T12). What the tests CAN prove: the list frame
// builder produces the right lines and the §2.11 colours from a fixed set of run views; the watch frame is
// render.mjs's own display (its text equals formatLines(buildDisplay(...)), not a reimplementation); the
// key-decode table maps the bound bytes to reducer events; a stale/final run renders its last frame with a
// stale marker; an empty list shows the get-started line; and raw mode and the alternate screen are always
// restored on exit, including a paint that throws. What they cannot prove — that the painted block reads
// and feels right to a person moving and opening runs at a real terminal — is hand-verified (§5.1, T12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildListFrame,
  buildWatchFrame,
  watchDisplayLines,
  decodeKey,
  createScreen,
  loadDashboard,
  openDashboard,
  wrapLine,
  readLogTail,
} from './pir-tui.mjs';
import { buildDashboard, initialUi } from '../core/dashboard.mjs';
import { buildDisplay } from '../core/display.mjs';
import { formatLines } from './render.mjs';
import { writeRecord, recordPath } from './index-store.mjs';
import { writeSnapshot } from './snapshot-store.mjs';

const NOW = 1_000_000;

// A fixed set of resolved run views, one of each state, for the list-frame tests.
const VIEWS = [
  { slug: 'alpha', state: 'running', repo: 'repoA', progress: { done: 3, total: 8 }, workers: 2 },
  { slug: 'beta', state: 'crashed', repo: 'repoB', progress: { done: 1, total: 5 }, workers: 0 },
  { slug: 'gamma', state: 'finished', repo: 'repoC', progress: { done: 4, total: 4 }, workers: 0 },
  { slug: 'delta', state: 'stopped', repo: 'repoD', progress: { done: 0, total: 6 }, workers: 0 },
];

// The flat text a frame paints, for content assertions (the same projection createScreen makes on a
// non-TTY): every span's text, spans joined per line, lines joined by newline.
const frameText = (frame) => frame.map((l) => l.map((s) => s.text).join('')).join('\n');

// The first span anywhere in the frame whose text contains `substr` — for asserting the style a builder
// attached to a particular cell, the way render.test.mjs asserts a line's colour.
function findSpan(frame, substr) {
  for (const line of frame) {
    for (const sp of line) {
      if (sp.text.includes(substr)) return sp;
    }
  }
  return null;
}

test('the list frame builds the title, a row per run, the counts line and the key hint from fixed views', () => {
  const frame = buildListFrame(buildDashboard(VIEWS), initialUi());
  const text = frameText(frame);

  assert.match(text, /pir {2}runs on this machine/, 'the title line');
  assert.match(text, /SLUG.*STATE.*REPO.*PROGRESS.*WK/s, 'the column header');
  assert.match(text, /alpha.*● running.*3\/8/s, 'the running run with its state and progress');
  assert.match(text, /beta.*✕ crashed.*1\/5/s, 'the crashed run');
  assert.match(text, /gamma.*◌ finished.*4\/4/s, 'the finished run');
  assert.match(text, /delta.*◼ stopped.*0\/6/s, 'the stopped run');
  assert.match(text, /4 runs · 1 running · 1 finished · 1 crashed · 1 stopped/, 'the counts line tallies each state');
  assert.match(text, /↑↓ move · ↵ open · Ctrl\+S stop · Ctrl\+X remove · esc quit/, 'the key-hint footer');
});

test('the empty dashboard shows the get-started line, not a blank list (§2.3)', () => {
  const frame = buildListFrame(buildDashboard([]), initialUi());
  const text = frameText(frame);
  assert.match(text, /No runs yet — start one with `pir \{slug\}`/, 'the get-started line stands in for the empty list');
  assert.ok(!text.includes('SLUG'), 'no column header is drawn when there is nothing to list');
  assert.match(text, /0 runs · 0 running/, 'the counts line still reads zero');
});

test('the list frame applies the §2.11 colour mapping: state, progress bar, selection and armed line', () => {
  const frame = buildListFrame(buildDashboard(VIEWS), initialUi());

  // State word colours: running green, crashed red, finished/stopped dim.
  assert.equal(findSpan(frame, '● running').style, 'running', 'a running run is green');
  assert.equal(findSpan(frame, '✕ crashed').style, 'crashed', 'a crashed run is red');
  assert.equal(findSpan(frame, '◌ finished').style, 'ended', 'a finished run is dim');
  assert.equal(findSpan(frame, '◼ stopped').style, 'ended', 'a stopped run is dim');

  // Progress bar: blue when running, red when crashed, dim otherwise.
  assert.equal(findSpan(frame, '3/8').style, 'bar-run', 'a running run\'s progress bar is blue');
  assert.equal(findSpan(frame, '1/5').style, 'bar-crash', 'a crashed run\'s progress bar is red');
  assert.equal(findSpan(frame, '4/4').style, 'bar-idle', 'a finished run\'s progress bar is dim');

  // The selected row carries a blue left-edge marker.
  const selMarker = findSpan(frame, '▎');
  assert.ok(selMarker, 'the selected row has a left-edge marker');
  assert.equal(selMarker.style, 'selected', 'the marker is styled as the blue left edge');

  // The running/crashed counts are green/red.
  assert.equal(findSpan(frame, '1 running').style, 'count-run', 'the running count is green');
  assert.equal(findSpan(frame, '1 crashed').style, 'count-crash', 'the crashed count is red');
});

test('an armed stop/remove shows the amber-bold confirmation line in place of the key hint (§2.7)', () => {
  const armedStop = buildListFrame(buildDashboard(VIEWS), { ...initialUi(), armed: { action: 'stop', slug: 'alpha' } });
  const stopFooter = findSpan(armedStop, 'Ctrl+S again to stop alpha');
  assert.ok(stopFooter, 'the armed stop line names the run and the second press');
  assert.equal(stopFooter.style, 'armed', 'and is amber and bold');

  const armedRemove = buildListFrame(buildDashboard(VIEWS), { ...initialUi(), armed: { action: 'remove', slug: 'beta' } });
  const removeFooter = findSpan(armedRemove, "Ctrl+X again to remove beta's record");
  assert.ok(removeFooter, 'the armed remove line names the run');
  assert.equal(removeFooter.style, 'armed', 'and is amber and bold');
});

test('the watch frame IS the coordinator\'s display: its text equals formatLines(buildDisplay(runState)) (§2.4)', () => {
  const runState = {
    branch: 'pir/demo',
    ceiling: 2,
    tasks: [
      { id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 3200, question: null },
      { id: 'T02', slug: 'b', deps: [], done: false, phase: 'building', since: NOW - 4000, doneMs: null, question: null },
    ],
  };
  const snap = { version: 1, proc: { pid: 1, startTime: 'T', slug: 'demo', repo: 'r', branch: 'pir/demo' }, finalState: null, runState };
  const spinnerChar = '⠋';

  const got = watchDisplayLines(snap, { now: NOW, spinnerChar }).map((l) => l.text);
  const want = formatLines(buildDisplay(runState, { now: NOW }), { spinnerChar });
  assert.deepEqual(got, want, 'the live block is render.mjs\'s own display, not a second rendering');
});

test('a stale/final run renders its last frame with a stale marker (§2.4)', () => {
  const runState = {
    branch: 'pir/beta',
    ceiling: 2,
    tasks: [{ id: 'T01', slug: 'a', deps: [], done: false, phase: 'building', since: NOW - 9000, doneMs: null, question: null }],
  };
  const snap = { version: 1, proc: { pid: 123, startTime: 'T', slug: 'beta', repo: 'repoB', branch: 'pir/beta' }, finalState: null, runState };

  // Crashed: the last frame is shown AND marked stale, in red, pointing at the resume.
  const crashed = buildWatchFrame(
    { slug: 'beta', state: 'crashed', repo: 'repoB', snap, record: { pid: 123, branch: 'pir/beta' } },
    { now: NOW },
  );
  const crashedText = frameText(crashed);
  assert.match(crashedText, /building/, 'the last snapshot\'s frame is still painted');
  const staleMarker = findSpan(crashed, 'this frame is stale');
  assert.ok(staleMarker, 'a stale marker is drawn');
  assert.equal(staleMarker.style, 'crashed', 'the crashed run\'s stale marker is red');
  assert.match(crashedText, /pir beta` resumes it/, 'and names how to resume');

  // Finished and stopped are dim, each with their own resume/hand-off note.
  const finished = buildWatchFrame(
    { slug: 'gamma', state: 'finished', repo: 'repoC', snap, record: { pid: 9, branch: 'pir/gamma' } },
    { now: NOW },
  );
  assert.match(frameText(finished), /finished · this frame is stale.*git merge pir\/gamma/s, 'a finished run shows the hand-off');
  assert.equal(findSpan(finished, 'this frame is stale').style, 'ended', 'a finished run\'s marker is dim');

  const stopped = buildWatchFrame(
    { slug: 'delta', state: 'stopped', repo: 'repoD', snap, record: { pid: 9, branch: 'pir/delta' } },
    { now: NOW },
  );
  assert.match(frameText(stopped), /stopped · this frame is stale.*resumes from committed work/s, 'a stopped run shows the resume note');
});

test('a finished red frame says not ready to merge and never offers `git merge`; green keeps the hand-off (DESIGN §2.8)', () => {
  const tasks = [{ id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 100, question: null }];
  const frameFor = (runState) => frameText(buildWatchFrame(
    { slug: 'gamma', state: 'finished', repo: 'repoC', snap: { version: 1, proc: {}, finalState: 'finished', runState }, record: { pid: 9, branch: 'pir/gamma' } },
    { now: NOW, columns: 200 },
  ));
  const red = frameFor({ branch: 'pir/gamma', ceiling: 2, complete: true, readyToMerge: false, tasks, testsReason: { reason: 'test `make test` exited 2', logPath: '/p/tests.log' } });
  assert.ok(!/git merge/.test(red), 'no merge offer anywhere on a red frame');
  assert.match(red, /Not ready to merge — fix pir\/gamma, see the output above\./);
  assert.match(red, /test `make test` exited 2 · output: \/p\/tests\.log/, 'the footer above carries the reason');

  const green = frameFor({ branch: 'pir/gamma', ceiling: 2, complete: true, readyToMerge: true, tasks });
  assert.match(green, /finished · this frame is stale\. Hand-off: git merge pir\/gamma/);
});

test('a finished run with no snapshot does not guess green: no merge offer, it points at run.log (DESIGN §2.8)', () => {
  const controlDir = '/r/plans/gamma/.parallel/control';
  const text = frameText(buildWatchFrame(
    { slug: 'gamma', state: 'finished', repo: 'repoC', snap: null, record: { pid: 9, branch: 'pir/gamma', controlDir } },
    { now: NOW },
  ));
  assert.ok(!/git merge/.test(text), 'no merge offer without a runState to prove green');
  assert.match(text, /no snapshot recorded — finished/);
  assert.ok(text.includes(`${controlDir}/run.log`), 'and names run.log');
});

test('a running watch frame ticks the spinner and shows the pid/awake note; no snapshot shows a waiting line', () => {
  const runState = { branch: 'pir/alpha', ceiling: 2, tasks: [{ id: 'T01', slug: 'a', deps: [], done: false, phase: 'building', since: NOW, doneMs: null, question: null }] };
  const snap = { version: 1, proc: {}, finalState: null, runState };
  const running = buildWatchFrame({ slug: 'alpha', state: 'running', repo: 'repoA', snap, record: { pid: 4242, branch: 'pir/alpha' } }, { now: NOW, spinnerChar: '⠹' });
  const text = frameText(running);
  assert.match(text, /pid 4242 · holding Mac awake/, 'a running run names its pid and that it holds the Mac awake');
  assert.ok(!text.includes('this frame is stale'), 'a running run is not marked stale');

  const noSnap = buildWatchFrame({ slug: 'alpha', state: 'running', repo: 'repoA', snap: null, record: { pid: 4242 } }, { now: NOW });
  assert.match(frameText(noSnap), /waiting for the first snapshot/, 'a run with no snapshot yet shows a waiting line, not an empty block');
});

test('a crashed run with NO snapshot says it never painted a frame, not that a frame is stale (regression)', () => {
  // The live-run hand-check surfaced this: a coordinator that refused to start (PARALLEL_ALLOW_HERE)
  // wrote only run.log — no status.json — so there is no frame at all. The watch view must not claim a
  // stale frame; it must say the run recorded no snapshot and point at run.log.
  const controlDir = '/repo/plans/beta/.parallel/control';
  const frame = buildWatchFrame(
    { slug: 'beta', state: 'crashed', repo: 'repoB', snap: null, record: { pid: 123, branch: 'pir/beta', controlDir } },
    { now: NOW },
  );
  const text = frameText(frame);
  assert.match(text, /no snapshot recorded — this run ended before it painted a frame/, 'the note says no frame was ever painted');
  assert.match(text, new RegExp(`${controlDir}/run\\.log`), 'and names the FULL run.log path, not just "run.log"');
  assert.ok(!text.includes('this frame is stale'), 'it does NOT claim a stale frame that does not exist');
  assert.ok(!text.includes('died mid-pass'), 'nor that the process died mid-pass — it never reached a pass');
});

test('a crashed run WITH a frozen frame names its run.log path alongside the stale marker', () => {
  const controlDir = '/repo/plans/beta/.parallel/control';
  const runState = { branch: 'pir/beta', ceiling: 2, tasks: [{ id: 'T01', slug: 'a', deps: [], done: false, phase: 'building', since: NOW - 9000, doneMs: null, question: null }] };
  const snap = { version: 1, proc: {}, finalState: null, runState };
  const frame = buildWatchFrame(
    { slug: 'beta', state: 'crashed', repo: 'repoB', snap, record: { pid: 123, branch: 'pir/beta', controlDir } },
    { now: NOW },
  );
  const text = frameText(frame);
  assert.match(text, /this frame is stale/, 'the stale marker is still shown for a real frozen frame');
  assert.match(text, new RegExp(`${controlDir}/run\\.log`), 'and the run.log path is named for the reason');
});

test('decodeKey maps the arrow / Enter / ← / → / Esc / Ctrl-S / Ctrl-X bytes to their intents', () => {
  assert.equal(decodeKey(Buffer.from('\x1b[A')), 'up', 'up arrow');
  assert.equal(decodeKey(Buffer.from('\x1b[B')), 'down', 'down arrow');
  assert.equal(decodeKey(Buffer.from('\x1bOA')), 'up', 'up arrow (application-cursor SS3)');
  assert.equal(decodeKey(Buffer.from('\x1bOB')), 'down', 'down arrow (application-cursor SS3)');
  assert.equal(decodeKey(Buffer.from('\x1b[D')), 'back', 'left arrow steps back a level');
  assert.equal(decodeKey(Buffer.from('\x1bOD')), 'back', 'left arrow (application-cursor SS3)');
  assert.equal(decodeKey(Buffer.from('\r')), 'open', 'Enter (CR)');
  assert.equal(decodeKey(Buffer.from('\n')), 'open', 'Enter (LF)');
  assert.equal(decodeKey(Buffer.from('\x1b')), 'quit', 'a lone Esc quits pir (back moved to ←)');
  assert.equal(decodeKey(Buffer.from([0x13])), 'ctrlS', 'Ctrl+S');
  assert.equal(decodeKey(Buffer.from([0x18])), 'ctrlX', 'Ctrl+X');
  assert.equal(decodeKey(Buffer.from([0x03])), 'quit', 'Ctrl+C leaves pir');
  assert.equal(decodeKey(Buffer.from('\x1b[C')), 'open', 'right arrow opens the selected run, like Enter');
  assert.equal(decodeKey(Buffer.from('\x1bOC')), 'open', 'right arrow (application-cursor SS3)');
  assert.equal(decodeKey(Buffer.from('x')), null, 'an unbound key decodes to null');
});

test('createScreen on a non-TTY appends plain text with no escapes; on a colour TTY it tints by style', () => {
  const nonTty = fakeStream({ isTTY: false });
  const s1 = createScreen({ stream: nonTty });
  s1.paint(buildListFrame(buildDashboard(VIEWS), initialUi()));
  const plain = nonTty.text();
  assert.ok(!/\x1b\[/.test(plain), 'no escape reaches a non-terminal');
  assert.match(plain, /alpha/, 'the content is still there, just plain');

  const tty = fakeStream({ isTTY: true });
  const s2 = createScreen({ stream: tty, colour: true });
  s2.paint(buildListFrame(buildDashboard(VIEWS), initialUi()));
  const coloured = tty.text();
  assert.ok(coloured.includes('\x1b[32m'), 'a colour TTY tints green (running)');
  assert.ok(coloured.includes('\x1b[31m'), 'and red (crashed)');
  assert.ok(coloured.includes('\x1b[?1049h') && coloured.includes('\x1b[?25l'), 'and enters the alternate screen, hiding the cursor');
});

test('createScreen clips each line to the terminal width and caps the frame at its row budget', () => {
  const tty = fakeStream({ isTTY: true, columns: 20, rows: 3 });
  const s = createScreen({ stream: tty, colour: false });
  s.paint(buildListFrame(buildDashboard(VIEWS), initialUi()));
  const body = tty.text().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); // strip escapes, leave drawn text
  const lines = body.split('\n');
  for (const ln of lines) assert.ok([...ln].length <= 20, `no drawn line exceeds the width: ${JSON.stringify(ln)}`);
  assert.ok(lines.length <= 3, `the frame is capped at the row budget, got ${lines.length}`);
});

test('the TUI restores raw mode and leaves the alternate screen even when a paint throws (§5.1, T15)', async () => {
  const raw = [];
  const stdin = {
    setRawMode: (v) => raw.push(v),
    on: () => {},
    off: () => {},
    resume: () => {},
    pause: () => {},
  };
  let closed = 0;
  // A screen whose paint always throws — the failure the loop must still tear down cleanly around.
  const makeScreen = () => ({
    paint: () => {
      throw new Error('paint blew up');
    },
    close: () => {
      closed += 1;
    },
  });

  await assert.rejects(
    openDashboard({
      stdin,
      stdout: {},
      makeScreen,
      load: () => buildDashboard([]),
    }),
    /paint blew up/,
    'the paint error propagates rather than being swallowed',
  );

  assert.deepEqual(raw, [true, false], 'raw mode is turned on, then off again on the way out');
  assert.equal(closed, 1, 'the screen is closed (alternate screen left, cursor shown) exactly once');
});

test('loadDashboard classifies each run and reads its snapshot for progress and workers (§3.4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-index-'));
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-control-'));

  const record = {
    version: 1,
    slug: 'demo',
    repo: 'my-repo',
    repoPath: '/x/my-repo',
    controlDir,
    pid: 4242,
    startTime: 'Tue Sep 22 08:27:37 2026',
    startedAt: null,
    branch: 'pir/demo',
    finalState: null,
    updatedAt: null,
  };
  writeRecord(record, { dir });
  writeSnapshot(controlDir, {
    proc: { pid: 4242, startTime: record.startTime, slug: 'demo', repo: 'my-repo', branch: 'pir/demo' },
    finalState: null,
    runState: {
      branch: 'pir/demo',
      ceiling: 3,
      tasks: [
        { id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 100, question: null },
        { id: 'T02', slug: 'b', deps: [], done: false, phase: 'building', since: NOW - 1000, doneMs: null, question: null },
        { id: 'T03', slug: 'c', deps: [], done: false, phase: 'reviewing', since: NOW - 2000, doneMs: null, question: null },
      ],
    },
  });

  // Inject the process boundary so no real ps/kill runs: the pid is alive and its launch time matches the
  // recorded one, so classifyRun returns 'running'.
  const kill = () => {}; // kill(pid, 0) that does not throw → alive
  const exec = () => ({ ok: true, stdout: `${record.startTime}\n` });

  const dash = loadDashboard({ dir, now: NOW, kill, exec });
  assert.equal(dash.rows.length, 1, 'the one indexed run is listed');
  const row = dash.rows[0];
  assert.equal(row.state, 'running', 'a live process whose launch time matches classifies running');
  assert.deepEqual(row.progress, { done: 1, total: 3 }, 'progress comes from the snapshot');
  assert.equal(row.workers, 2, 'the worker count is the active tasks this pass');
  assert.equal(dash.counts.running, 1, 'the counts reflect the classified state');

  // A gone process (kill throws ESRCH) with no final status classifies crashed.
  const killDead = () => {
    const e = new Error('no such process');
    e.code = 'ESRCH';
    throw e;
  };
  const crashedDash = loadDashboard({ dir, now: NOW, kill: killDead, exec });
  assert.equal(crashedDash.rows[0].state, 'crashed', 'a gone process with no final status is crashed');

  // Tidy the scratch index entry so a re-run does not accrete files (the control dirs are OS temp).
  writeFileSync(recordPath('my-repo', 'demo', { dir }), '', { flag: 'w' });
});

test('wrapLine breaks at spaces and hard-breaks a long token, keeping every segment within the width', () => {
  assert.deepEqual(wrapLine('short', 20), ['short'], 'text within the width is one line');
  const wrapped = wrapLine('the quick brown fox jumps', 10);
  for (const seg of wrapped) assert.ok([...seg].length <= 10, `each segment fits: ${JSON.stringify(seg)}`);
  assert.ok(wrapped.length > 1, 'a long sentence wraps to several lines');
  assert.equal(wrapped.join(' '), 'the quick brown fox jumps', 'word-wrap loses no words');

  // A path has no spaces, so it must HARD-break — the fix for "the run.log path doesn't fit".
  const path = '/Users/x/very/deep/project/plans/some-slug/.parallel/control/run.log';
  const segs = wrapLine(path, 24);
  for (const seg of segs) assert.ok([...seg].length <= 24, `each path segment fits: ${JSON.stringify(seg)}`);
  assert.equal(segs.join(''), path, 'the path is fully reconstructable from its wrapped segments');
});

test('the watch view wraps a long run.log path so it survives painting at a narrow width (regression)', () => {
  const controlDir = '/Users/someone/very/deep/project/path/that/is/quite/long/plans/some-slug/.parallel/control';
  const columns = 40;
  const frame = buildWatchFrame(
    { slug: 'some-slug', state: 'crashed', repo: 'repoZ', snap: null, record: { pid: 5, branch: 'pir/some-slug', controlDir } },
    { now: NOW, columns },
  );

  // The path note lines are wrapped to the width; the fixed footer/header are clipped at paint instead.
  // Paint the frame at 40 cols and confirm the FULL path is still there — if it had not wrapped, the paint
  // would clip it to 40 and lose its tail. rows is generous so no path line is dropped for height.
  const tty = fakeStream({ isTTY: true, columns, rows: 60 });
  createScreen({ stream: tty, colour: false }).paint(frame);
  const painted = tty
    .text()
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\n ]/g, '');
  assert.ok(painted.includes(`${controlDir}/run.log`), 'the full path survives painting at 40 cols — it wrapped, not clipped');
});

test('a crashed run shows the tail of its run.log inline so the reason is visible without opening it', () => {
  const logTail = [
    'LIVE: spawning real workers (PARALLEL_LIVE=1).',
    'Refusing the LIVE run inside "plan-implement-review" — set PARALLEL_ALLOW_HERE=1 for a scratch clone.',
  ];
  const frame = buildWatchFrame(
    { slug: 'beta', state: 'crashed', repo: 'repoB', snap: null, record: { pid: 1, controlDir: '/r/plans/beta/.parallel/control' } },
    { now: NOW, columns: 80, logTail },
  );
  const text = frameText(frame);
  assert.match(text, /last lines of run\.log:/, 'the log tail is introduced');
  assert.match(text, /spawning real workers/, 'the first tail line is shown');
  assert.match(text, /Refusing the LIVE run/, 'and the reason it died');
});

test('readLogTail returns the last N lines of a log, and null when there is none', () => {
  const d = mkdtempSync(join(tmpdir(), 'pir-log-'));
  const p = join(d, 'run.log');
  writeFileSync(p, 'line1\nline2\nline3\nline4\nline5\n');
  assert.deepEqual(readLogTail(p, 3), ['line3', 'line4', 'line5'], 'the last three lines, trailing blank dropped');
  assert.deepEqual(readLogTail(p, 10), ['line1', 'line2', 'line3', 'line4', 'line5'], 'asking for more than exist returns all');
  assert.equal(readLogTail(join(d, 'nope.log'), 3), null, 'a missing log reads as null, never a throw');
  assert.equal(readLogTail(null, 3), null, 'a null path is null');
});

// A fake stream that records everything written and declares its TTY-ness and size, standing in for
// process.stdout without a real terminal (mirrors render.test.mjs's helper).
function fakeStream({ isTTY = true, columns = 80, rows = 24 } = {}) {
  const chunks = [];
  return {
    isTTY,
    columns,
    rows,
    write: (s) => {
      chunks.push(s);
      return true;
    },
    text: () => chunks.join(''),
  };
}
