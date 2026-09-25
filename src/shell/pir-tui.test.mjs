// The dashboard TUI (DESIGN §2.3, §2.4, §2.6, §2.7, §2.11; T12). What the tests CAN prove: the list frame
// builder produces the right lines and the §2.11 colours from a fixed set of run views; the watch frame is
// render.mjs's own display (its text equals formatLines(buildDisplay(...)), not a reimplementation); the
// key-decode table maps the bound bytes to reducer events; a stale/final run renders its last frame with a
// stale marker; an empty list shows the get-started line; and raw mode and the alternate screen are always
// restored on exit, including a paint that throws. What they cannot prove — that the painted block reads
// and feels right to a person moving and opening runs at a real terminal — is hand-verified (§5.1, T12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  readLogTail,
} from './pir-tui.mjs';
import { FrameView, SGR, clipSpans } from './pir-view.mjs';
import { visibleWidth } from '@earendil-works/pi-tui';
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
  const s2 = createScreen({ stream: tty, colour: true, terminal: fakeTerminal(tty) });
  s2.paint(buildListFrame(buildDashboard(VIEWS), initialUi()));
  const coloured = tty.text();
  assert.ok(coloured.includes('\x1b[32m'), 'a colour TTY tints green (running)');
  assert.ok(coloured.includes('\x1b[31m'), 'and red (crashed)');
  assert.ok(coloured.includes('\x1b[?1049h') && coloured.includes('\x1b[?25l'), 'and enters the alternate screen, hiding the cursor');
});

test('createScreen clips each line to the terminal width and cuts the frame at its rows, keeping the top', () => {
  const tty = fakeStream({ isTTY: true, columns: 20, rows: 3 });
  const s = createScreen({ stream: tty, colour: false, terminal: fakeTerminal(tty) });
  s.paint(buildListFrame(buildDashboard(VIEWS), initialUi()));
  const rows = drawnRows(tty.text());
  assert.equal(rows.length, 3, 'exactly the terminal\'s rows are drawn');
  for (const ln of rows) assert.ok([...ln].length <= 20, `no drawn line exceeds the width: ${JSON.stringify(ln)}`);
  assert.equal(rows[0], 'pir  runs on this ma', 'the frame is cut from the top, as before: the title stays');
  assert.match(rows[2], /^  SLUG/, 'the third line is the column header, not the tail of the frame');
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
  createScreen({ stream: tty, colour: false, terminal: fakeTerminal(tty) }).paint(frame);
  const painted = drawnRows(tty.text()).join('').replace(/ /g, '');
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
  // The byte budget is a parameter (T13): a cut drops the partial first line, n = Infinity keeps every whole line.
  assert.deepEqual(readLogTail(p, Infinity, { maxBytes: 14 }), ['line4', 'line5'], 'the cut "3" was a partial line and is dropped');
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

// pi-tui's Terminal seam over a fakeStream: output goes to the stream, input is fed with `press`, and
// start/stop are recorded (a real ProcessTerminal sets and restores raw mode in exactly those two calls).
function fakeTerminal(stream) {
  const t = {
    started: 0,
    stopped: 0,
    onInput: null,
    onResize: null,
    start(onInput, onResize) {
      t.started += 1;
      t.onInput = onInput;
      t.onResize = onResize;
    },
    stop() {
      t.stopped += 1;
      t.onInput = null;
    },
    drainInput: async () => {},
    write: (d) => stream.write(d),
    get columns() {
      return stream.columns;
    },
    get rows() {
      return stream.rows;
    },
    kittyProtocolActive: false,
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    press: (data) => t.onInput?.(data),
  };
  return t;
}

// The rows pi-tui left on screen after its paints: it addresses each row absolutely (`CSI row;1H`), so
// replaying the writes into a row map and stripping every other escape gives the drawn text per row.
function drawnRows(out) {
  const rows = [];
  const re = /\x1b\[(\d+);1H/g;
  let m;
  const marks = [];
  while ((m = re.exec(out))) marks.push({ row: Number(m[1]) - 1, at: m.index + m[0].length });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at - `\x1b[${marks[i + 1].row + 1};1H`.length : out.length;
    rows[mk.row] = out
      .slice(mk.at, end)
      .replace(/\x1b\][^\x07]*\x07/g, '') // OSC (pi-tui closes each line's hyperlink)
      .replace(/\x1b_[^\x1b]*\x1b\\/g, '') // APC
      .replace(/\x1b\[[0-9;?<>=]*[A-Za-z]/g, ''); // CSI
  });
  while (rows.length && !rows.at(-1)) rows.pop();
  return rows.map((r) => r ?? '');
}

test('a running watch frame draws a merge conflict\'s paste-in prompt under the live block, orange head, exact lines (user 2026-09-24)', () => {
  const PROMPT = 'Merge conflict on T05 clash — the run parked it for you (DESIGN §2.8).\n\n----- copy -----\n  git merge pir/alpha\n  1. Resolve\n----- end -----\n';
  const runState = { branch: 'pir/alpha', ceiling: 2, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in FINDINGS.md', prompt: PROMPT }] };
  const snap = { version: 1, proc: {}, finalState: null, runState };
  const frame = buildWatchFrame({ slug: 'alpha', state: 'running', repo: 'repoA', snap, record: { pid: 1, branch: 'pir/alpha' } }, { now: NOW, columns: 120 });
  const text = frameText(frame);
  assert.ok(text.includes('----- copy -----\n  git merge pir/alpha\n  1. Resolve\n----- end -----'), 'the paste block is drawn verbatim, indentation kept');
  assert.equal(findSpan(frame, 'Merge conflict on T05').style, 'conflict');
  assert.equal(findSpan(frame, 'merge conflict   ').style, 'conflict', 'the task row is orange');

  const stale = buildWatchFrame({ slug: 'alpha', state: 'stopped', repo: 'repoA', snap, record: { pid: 1, branch: 'pir/alpha' } }, { now: NOW, columns: 120 });
  assert.ok(!frameText(stale).includes('git merge pir/alpha'), 'a run that is not running does not offer a stale prompt');
});

test('a conflict sent to its live worker draws no paste block in the watch frame (live-workers T08)', () => {
  const runState = { branch: 'pir/alpha', ceiling: 2, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in a.txt', prompt: 'The run could not merge your branch\n  git merge pir/alpha\n', conflictSent: true }] };
  const snap = { version: 1, proc: {}, finalState: null, runState };
  const frame = buildWatchFrame({ slug: 'alpha', state: 'running', repo: 'repoA', snap, record: { pid: 1, branch: 'pir/alpha' } }, { now: NOW, columns: 120 });
  const text = frameText(frame);
  assert.ok(!text.includes('git merge pir/alpha'), 'the sent prompt is not drawn for the person');
  assert.ok(text.includes('fixing conflict'), 'the row reads fixing conflict');
  assert.equal(findSpan(frame, 'fixing conflict').style, 'active');
});

test('↓ reaches every row when two repos share a slug, and stop acts on the selected repo\'s run (user 2026-09-25)', async () => {
  // Pinned by slug, ↓ onto the second `parallel-pir` re-resolved to the first and snapped back, so the
  // fifth row was unreachable; the stop intent would also have resolved to the other repo's run.
  const rec = (repo, slug, state) => ({ key: `${repo}__${slug}`, slug, repo, state, progress: { done: 0, total: 1 }, workers: 0, record: { repo, slug } });
  const rows = [
    rec('a-repo', 'alpha', 'finished'),
    rec('a-repo', 'beta', 'finished'),
    rec('pir-run', 'parallel-pir', 'running'),
    rec('plan-implement-review', 'parallel-pir', 'running'),
    rec('z-repo', 'zeta', 'finished'),
  ];
  let onData = null;
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const frames = [];
  const stopped = [];
  const done = openDashboard({
    stdin,
    stdout: {},
    refreshMs: 60_000,
    makeScreen: () => ({ paint: (f) => frames.push(f), close: () => {} }),
    load: () => buildDashboard(rows),
    stop: async (record) => stopped.push(record.repo),
  });
  const selectedRow = () => frameText(frames.at(-1)).split('\n').find((l) => l.startsWith('▎'));

  for (let i = 0; i < 3; i++) await onData('\x1b[B');
  assert.match(selectedRow(), /parallel-pir.*plan-implement-rev/, 'the second same-slug row is selectable');
  await onData('\x13');
  await onData('\x13');
  assert.deepEqual(stopped, ['plan-implement-review'], 'stop resolved to the selected repo, not the first same-slug row');
  await onData('\x1b[B');
  assert.match(selectedRow(), /zeta/, 'the fifth row is reachable');

  await onData('\x1b');
  await done;
});

test('FrameView paints a span in the same SGR sequence render.mjs\'s map produces, and plain with colour off', () => {
  // render.mjs does not export its map, so read its six codes from its source: this is the proof the
  // reused watch frame colours exactly as the coordinator paints it.
  const src = readFileSync(new URL('./render.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const SGR = {'), src.indexOf('};', src.indexOf('const SGR = {')));
  const renderMap = Object.fromEntries([...block.matchAll(/(\w+): '([^']*)'/g)].map(([, k, v]) => [k, v.replace(/\\x1b/g, '\x1b')]));
  assert.deepEqual(Object.keys(renderMap).sort(), ['active', 'asking', 'conflict', 'done', 'idle', 'red']);
  for (const [style, code] of Object.entries(renderMap)) {
    assert.equal(SGR[style], code, `pir-view carries render.mjs's ${style} code unchanged`);
    const [line] = new FrameView(() => [[{ text: 'T05 work', style }]]).render(80);
    assert.equal(line, `${code}T05 work\x1b[0m`, `a ${style} span paints as render.mjs would`);
  }
  const [mixed] = new FrameView(() => [[{ text: 'a', style: 'head' }, { text: 'b', style: null }]]).render(80);
  assert.equal(mixed, '\x1b[1ma\x1b[0mb', 'a plain span gets no escape');
  const [plain] = new FrameView(() => [[{ text: 'a', style: 'head' }]], { colour: false }).render(80);
  assert.equal(plain, 'a', 'colour off paints the bare text');
});

test('FrameView clips a line to the width across spans, never wraps, and counts wide characters as two', () => {
  const view = new FrameView(() => [[{ text: '漢字', style: 'done' }, { text: 'abcdef', style: null }], [{ text: 'x'.repeat(50) }]]);
  const lines = view.render(7);
  assert.equal(lines.length, 2, 'one output line per frame line: nothing wraps');
  assert.equal(lines[0], '\x1b[32m漢字\x1b[0mabc', 'the two wide characters take four of the seven columns');
  assert.equal(visibleWidth(lines[1]), 7);
  assert.equal(new FrameView(() => [[{ text: 'ab漢' }]], { colour: false }).render(3)[0], 'ab', 'a wide character straddling the edge is dropped, not half-drawn');
  assert.deepEqual(clipSpans([{ text: 'abc', style: 'x' }], 0), [], 'zero width draws nothing');
});

test('decodeKey reads the Kitty-protocol forms pi-tui may negotiate, and ignores key-ups and terminal replies', () => {
  assert.equal(decodeKey('\x1b[27u'), 'quit', 'Kitty Esc');
  assert.equal(decodeKey('\x1b[13u'), 'open', 'Kitty Enter');
  assert.equal(decodeKey('\x1b[99;5u'), 'quit', 'Kitty Ctrl+C');
  assert.equal(decodeKey('\x1b[115;5u'), 'ctrlS', 'Kitty Ctrl+S');
  assert.equal(decodeKey('\x1b[120;5u'), 'ctrlX', 'Kitty Ctrl+X');
  assert.equal(decodeKey('\x1b[1;1:3A'), null, 'a key release is not a press');
  assert.equal(decodeKey('\x1b[6;16;8t'), null, 'the cell-size reply is not a key (FINDINGS 2026-09-25)');
  assert.equal(decodeKey(''), null);
});

test('through pi-tui: keys move and open, Esc quits, and the terminal is stopped and the alternate screen left', async () => {
  const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
  const term = fakeTerminal(tty);
  const rows = [
    { key: 'r__alpha', slug: 'alpha', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'alpha' } },
    { key: 'r__beta', slug: 'beta', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'beta' } },
  ];
  const done = openDashboard({
    stdin: { setRawMode: () => assert.fail('pi-tui owns raw mode; the loop must not touch stdin') },
    stdout: tty,
    refreshMs: 60_000,
    makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
    load: () => buildDashboard(rows),
  });
  assert.equal(term.started, 1, 'the pi-tui terminal is started once');
  const selected = () => drawnRows(tty.text()).find((l) => l.startsWith('▎'));
  assert.match(selected(), /alpha/);
  term.press('\x1b[B');
  await new Promise((r) => setImmediate(r));
  assert.match(selected(), /beta/, '↓ moved the selection');
  term.press('\x1b[C');
  await new Promise((r) => setImmediate(r));
  assert.ok(drawnRows(tty.text()).some((l) => l.startsWith('beta')), '→ opened the run');
  term.press('\x1b');
  await done;
  assert.equal(term.stopped, 1, 'the terminal is stopped (raw mode restored) exactly once');
  assert.ok(tty.text().endsWith('\x1b[?1049l\x1b[?25h\x1b[?2026l'), 'the alternate screen is left last, cursor shown, and no frame printed after it');
});

test('through pi-tui: a throw inside painting stops the terminal and leaves the alternate screen before rethrowing (§2.14)', async () => {
  const tty = fakeStream({ isTTY: true });
  const term = fakeTerminal(tty);
  const boom = { toString: () => { throw new Error('paint blew up'); } };
  await assert.rejects(
    openDashboard({
      stdin: {},
      stdout: tty,
      makeScreen: (opts) => {
        const screen = createScreen({ ...opts, terminal: term });
        return { ...screen, paint: () => screen.paint([[{ text: boom, style: null }]]) };
      },
      load: () => buildDashboard([]),
    }),
    /paint blew up/,
  );
  assert.equal(term.started, 1);
  assert.equal(term.stopped, 1, 'the terminal is stopped on the way out');
  assert.ok(tty.text().includes('\x1b[?1049l'), 'the alternate screen is left');
});

test('through pi-tui: a throw in a render pi-tui starts on its own (a resize) reaches the loop, which restores and rethrows', async () => {
  const tty = fakeStream({ isTTY: true });
  const term = fakeTerminal(tty);
  let bad = false;
  // A span that paints fine until `bad` is set, so the loop's own paints succeed and only pi-tui's
  // resize render, on its own timer outside the loop's try, meets the throw.
  const flaky = { toString: () => { if (bad) throw new Error('resize paint'); return 'ok'; } };
  const done = openDashboard({
    stdin: {},
    stdout: tty,
    refreshMs: 60_000,
    makeScreen: (opts) => {
      const screen = createScreen({ ...opts, terminal: term });
      return { ...screen, paint: () => screen.paint([[{ text: flaky, style: null }]]) };
    },
    load: () => buildDashboard([]),
  });
  bad = true;
  term.onResize();
  await assert.rejects(done, /resize paint/, 'the error is rethrown from the loop, not left uncaught on a timer');
  assert.equal(term.stopped, 1, 'the terminal is stopped');
  assert.ok(tty.text().includes('\x1b[?1049l'), 'the alternate screen is left');
});

// --- the task row in the run live view (live-workers T12, DESIGN §2.11) -----------------------------

const T12_TASKS = [
  { id: 'T01', slug: 'one', deps: [], done: true, phase: null, worker: { id: 'w1', live: false, logPath: '/c/w1.jsonl' } },
  { id: 'T02', slug: 'two', deps: [], done: false, phase: 'building', since: NOW - 5000, worker: { id: 'w2', live: true, logPath: '/c/w2.jsonl' } },
  { id: 'T03', slug: 'three', deps: ['T02'], done: false, phase: null, worker: null },
];
const tasksRun = (tasks, over = {}) => ({
  key: 'repo__plan',
  slug: 'plan',
  state: 'running',
  repo: 'repo',
  progress: { done: 0, total: tasks.length },
  workers: 0,
  snap: { runState: { branch: 'pir/plan', ceiling: 2, tasks } },
  record: { repo: 'repo', slug: 'plan' },
  ...over,
});

test('the selection bar draws on the selected task row in the list\'s style; every other line is the coordinator\'s', () => {
  const run = tasksRun(T12_TASKS);
  const ui = { ...initialUi(), view: 'watch', openSlug: 'plan', taskSel: 1 };
  const frame = buildWatchFrame(run, { now: NOW, ui });
  const block = formatLines(buildDisplay(run.snap.runState, { now: NOW }), { spinnerChar: '⠋' });
  const drawn = frame.slice(2, 2 + block.length);
  drawn.forEach((line, i) => {
    const text = line.map((s) => s.text).join('');
    if (i === 2) {
      assert.equal(line[0].text, '▎ ');
      assert.equal(line[0].style, 'selected', 'the same span style the list uses for its bar');
      assert.equal(text, '▎ ' + block[i].slice(2), 'the bar replaces the row\'s leading two spaces');
    } else {
      assert.equal(text, block[i], `line ${i} is unchanged`);
    }
  });
  // The list's own bar is the same span.
  const listBar = buildListFrame(buildDashboard(VIEWS), initialUi()).flat().find((s) => s.text === '▎ ');
  assert.deepEqual(listBar, frame.flat().find((s) => s.text === '▎ '));
});

test('a task selection past the end draws the bar on the last task row', () => {
  const frame = buildWatchFrame(tasksRun(T12_TASKS), { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 9 } });
  assert.match(frameText(frame).split('\n').find((l) => l.startsWith('▎')), /T03/);
});

test('the watch footer shows the no-worker note above the key hint, and the hint names the task keys', () => {
  const ui = { ...initialUi(), view: 'watch', note: 'T03 has no worker yet — it starts when T02 is merged.' };
  const text = frameText(buildWatchFrame(tasksRun(T12_TASKS), { now: NOW, ui })).split('\n');
  assert.equal(text.at(-2), 'T03 has no worker yet — it starts when T02 is merged.');
  assert.equal(text.at(-1), '↑↓ pick a task · → open its worker · ← back · Ctrl+S Ctrl+S stop this run · esc quit');
  assert.equal(findSpan(buildWatchFrame(tasksRun(T12_TASKS), { now: NOW, ui }), 'has no worker').style, 'dim');
});

test('the list frame is byte-identical whatever the task-selection fields hold (T11\'s list)', () => {
  const t11Ui = { view: 'list', sel: 1, openSlug: null, openKey: null, armed: null };
  const t12Ui = { ...t11Ui, taskSel: 3, openWorker: null, note: null };
  assert.deepEqual(buildListFrame(buildDashboard(VIEWS), t12Ui), buildListFrame(buildDashboard(VIEWS), t11Ui));
});

// Drive runTui with a scripted loader; `rows()` is re-read on every refresh/keypress.
function driveTui(rows, extra = {}) {
  let onData = null;
  const frames = [];
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const done = openDashboard({
    stdin,
    stdout: {},
    refreshMs: 60_000,
    now: () => NOW,
    makeScreen: () => ({ paint: (f) => frames.push(f), close: () => {} }),
    load: () => buildDashboard(rows()),
    ...extra,
  });
  const text = () => frameText(frames.at(-1));
  const barRow = () => text().split('\n').find((l) => l.startsWith('▎'));
  return { key: (k) => onData(k), text, barRow, done, frames };
}

test('runTui: → on a task opens its worker, ← comes back to the same task, ↑↓ never move the list selection', async () => {
  const other = { key: 'a__first', slug: 'first', state: 'finished', repo: 'a', progress: { done: 0, total: 0 }, workers: 0, record: {} };
  const t = driveTui(() => [other, tasksRun(T12_TASKS, { key: 'r__plan', repo: 'r' })]);
  await t.key('\x1b[B'); // list: onto `plan`
  await t.key('\r'); // open the run
  assert.match(t.barRow(), /T01/, 'the task selection starts at the first task');
  await t.key('\x1b[B'); // T02
  assert.match(t.barRow(), /T02/);
  await t.key('\x1b[C'); // → opens T02's live worker
  assert.match(t.text(), /T02  worker w2 · live/);
  await t.key('\x1b[D'); // ← back to the live view
  assert.match(t.barRow(), /T02/, 'the task selection is kept');
  await t.key('\x1b[D'); // ← back to the list
  assert.match(t.barRow(), /plan/, 'the list selection did not drift while ↑↓ moved the task row');
  await t.key('\x1b');
  await t.done;
});

test('runTui: → on a task with no worker shows the note; a finished worker opens read-only', async () => {
  const t = driveTui(() => [tasksRun(T12_TASKS)]);
  await t.key('\r');
  await t.key('\x1b[B');
  await t.key('\x1b[B'); // T03
  await t.key('\x1b[C');
  assert.match(t.barRow(), /T03/);
  assert.match(t.text(), /T03 has no worker yet — it starts when T02 is merged\./);
  await t.key('\x1b[A');
  assert.doesNotMatch(t.text(), /has no worker/, 'the note clears on the next key');
  await t.key('\x1b[A'); // T01, finished
  await t.key('\r');
  assert.match(t.text(), /T01  worker w1 · finished, read only/);
  await t.key('\x1b[D'); // ← back: in the worker view Esc does not quit (T13)
  await t.key('\x1b');
  await t.done;
});

test('runTui: the task selection survives a refresh that adds or removes task rows (pinned by id)', async () => {
  let tasks = T12_TASKS;
  const t = driveTui(() => [tasksRun(tasks)]);
  await t.key('\r');
  await t.key('\x1b[B'); // T02
  await t.key('\x1b[B'); // T03
  // Ctrl+X is inert in watch on a running run, so it serves as "repaint from a fresh read".
  const refresh = () => t.key('\x18');
  tasks = [{ id: 'T00', slug: 'zero', deps: [], done: true, phase: null, worker: null }, ...T12_TASKS];
  await refresh();
  assert.match(t.barRow(), /T03/, 'a row added above does not move the selection off T03');
  tasks = T12_TASKS.filter((x) => x.id !== 'T01');
  await refresh();
  assert.match(t.barRow(), /T03/, 'a row removed above does not move it either');
  tasks = [{ id: 'T00', slug: 'zero', deps: [], done: true, phase: null, worker: null }, ...T12_TASKS];
  await t.key('\x1b[A'); // the read this key makes has T00 on top again: ↑ goes from T03 to T02
  assert.match(t.barRow(), /T02/, 'an arrow moves from where the task is now, not from a stale index');
  await t.key('\x1b[B');
  tasks = T12_TASKS.filter((x) => x.id !== 'T03');
  await refresh();
  assert.match(t.barRow(), /T02/, 'the selected task gone: the index clamps to the last row');
  await t.key('\x1b');
  await t.done;
});

test('runTui: two runs of one slug keep their own task selection, by run key', async () => {
  const a = tasksRun(T12_TASKS, { key: 'a__plan', repo: 'a' });
  const b = tasksRun(T12_TASKS, { key: 'b__plan', repo: 'b' });
  const t = driveTui(() => [a, b]);
  await t.key('\r'); // open a
  await t.key('\x1b[B');
  await t.key('\x1b[B'); // a: T03
  await t.key('\x1b[D'); // list
  await t.key('\x1b[B'); // onto b
  await t.key('\r');
  assert.match(t.barRow(), /T01/, 'b starts at its own first task, not a\'s T03');
  await t.key('\x1b[B'); // b: T02
  await t.key('\x1b[D');
  await t.key('\x1b[A'); // onto a
  await t.key('\r');
  assert.match(t.barRow(), /T03/, 'a kept its selection');
  await t.key('\x1b');
  await t.done;
});

test('runTui: Ctrl+S Ctrl+S in watch still stops the open run with a task selected', async () => {
  const stopped = [];
  const t = driveTui(() => [tasksRun(T12_TASKS)], { stop: async (record) => stopped.push(record.slug) });
  await t.key('\r');
  await t.key('\x1b[B');
  await t.key('\x13');
  assert.match(t.text(), /Ctrl\+S again to stop plan/);
  await t.key('\x13');
  assert.deepEqual(stopped, ['plan']);
  await t.key('\x1b');
  await t.done;
});

// --- the conversation view mounted in runTui (live-workers T13, DESIGN §2.11) -----------------------

test('runTui: in the worker view Esc and Ctrl+C go to the conversation, not quit; ← steps out; Ctrl+C quits in watch', async () => {
  const drops = [];
  const log = [
    { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'Build T02.' },
    { t: 2, dir: 'request', requestId: 'r1', toolName: 'Bash', input: { command: 'rm -rf x' }, suggestions: [] },
  ];
  let alive = true;
  const t = driveTui(() => [tasksRun(T12_TASKS, { state: alive ? 'running' : 'stopped' })], {
    follow: (_p, { onEntries }) => {
      onEntries(log.map((e) => JSON.stringify(e)));
      return { stop() {} };
    },
    drop: (dir, input, { coordinatorAlive }) => {
      if (!coordinatorAlive()) return { ok: false, reason: 'not-running' };
      drops.push(input);
      return { ok: true };
    },
  });
  await t.key('\r');
  await t.key('\x1b[B'); // T02, live
  await t.key('\x1b[C');
  assert.match(t.text(), /pir ▸ Build T02\./, 'the conversation is drawn');
  assert.match(t.text(), /⚑ T02 wants to use Bash/);
  await t.key('\x1b');
  await t.key('\x03');
  assert.deepEqual(drops, [{ to: 'w2', kind: 'interrupt' }, { to: 'w2', kind: 'interrupt' }], 'Esc and Ctrl+C interrupted the worker');
  await t.key('n');
  assert.deepEqual(drops.at(-1), { to: 'w2', kind: 'permission', requestId: 'r1', decision: 'deny' });
  alive = false; // the open run is no longer `running`: nothing is dropped
  await t.key('x');
  await t.key('\r');
  assert.equal(drops.length, 3);
  assert.match(t.text(), /the run is not running — your message was not sent/);
  alive = true;
  await t.key('\x03'); // clears the box
  await t.key('\x1b[D'); // ← with an empty box
  assert.match(t.barRow(), /T02/, 'back in the live view on the same task');
  await t.key('\x03'); // Ctrl+C in watch still quits
  await t.done;
});

test('through pi-tui: the conversation view is mounted in the frame\'s place, takes typing, and ← puts the frame back', async () => {
  const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
  const term = fakeTerminal(tty);
  const drops = [];
  const done = openDashboard({
    stdin: {},
    stdout: tty,
    refreshMs: 60_000,
    now: () => NOW,
    makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
    load: () => buildDashboard([tasksRun(T12_TASKS)]),
    follow: (_p, { onEntries }) => {
      onEntries([JSON.stringify({ t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'Build T02.' })]);
      return { stop() {} };
    },
    drop: (_d, input) => (drops.push(input), { ok: true }),
  });
  const tick = () => new Promise((r) => setImmediate(r));
  const rows = () => drawnRows(tty.text());
  term.press('\r');
  await tick();
  term.press('\x1b[B');
  await tick();
  term.press('\x1b[C');
  await tick();
  assert.ok(rows().some((l) => /pir ▸ Build T02\./.test(l)), 'the conversation is on screen');
  assert.equal(rows().filter((l) => l !== undefined).length <= 30, true, 'it fits the terminal rows');
  for (const c of 'hi') term.press(c);
  await tick();
  assert.ok(rows().some((l) => /│?\s*hi/.test(l) && !/Build/.test(l)), 'the typed text is in the box');
  term.press('\r');
  await tick();
  assert.deepEqual(drops, [{ to: 'w2', kind: 'message', text: 'hi' }]);
  term.press('\x1b[D');
  await tick();
  assert.ok(rows().some((l) => l?.startsWith('▎') && /T02/.test(l)), 'the live view is back, T02 selected');
  term.press('\x1b');
  await done;
  assert.equal(term.stopped, 1);
});
