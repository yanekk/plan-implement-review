// The dashboard TUI (DESIGN §2.3, §2.4, §2.6, §2.7, §2.11; T12). What the tests CAN prove: the list frame
// builder produces the right lines and the §2.11 colours from a fixed set of run views; the watch frame is
// render.mjs's own display (its text equals formatLines(buildDisplay(...)), not a reimplementation); the
// key-decode table maps the bound bytes to reducer events; a stale/final run renders its last frame with a
// stale marker; an empty list shows the get-started line; and raw mode and the alternate screen are always
// restored on exit, including a paint that throws. What they cannot prove — that the painted block reads
// and feels right to a person moving and opening runs at a real terminal — is hand-verified (§5.1, T12).

import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  openPlanner,
  openWatch,
  readLogTail,
  landStep,
  followStep,
  buildLandingFrame,
  FOLLOW_LINE,
  isBuilding,
  hitAt,
  underMultiplexer,
  defaultCopy,
} from './pir-tui.mjs';
import { FrameView, SGR, SELECTED_BG, HOVER_ASKING, HOVER_LIFT, clipSpans, paintLine } from './pir-view.mjs';
import { createScreenModel } from './conversation-rig.mjs';
import { BASIC_HOVER_ASKING, BASIC_HOVER_LIFT, MOCHA_HOVER_ASKING, MOCHA_HOVER_LIFT, MOCHA_SGR } from './palette.mjs';
import { visibleWidth } from '@earendil-works/pi-tui';
import { buildDashboard, initialUi } from '../core/dashboard.mjs';
import { buildDisplay } from '../core/display.mjs';
import { SGR as RENDER_SGR, formatLines } from './render.mjs';
import { writeRecord, recordPath } from './index-store.mjs';
import { writeSnapshot } from './snapshot-store.mjs';
import { createDashboardPublisher } from './dashboard-publish.mjs';

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
  assert.match(text, /↑↓ move · ↵ open · Ctrl\+R resume · Ctrl\+S stop · Ctrl\+X remove · esc quit/, 'the key-hint footer');
});

test('the empty dashboard shows the get-started line, not a blank list (§2.3)', () => {
  const frame = buildListFrame(buildDashboard([]), initialUi());
  const text = frameText(frame);
  assert.match(text, /No runs yet — start one with `pir start \{slug\}`/, 'the get-started line stands in for the empty list');
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
  assert.match(crashedText, /`pir start beta` resumes it/, 'and names how to resume');

  // Finished and stopped are dim, each with their own resume/hand-off note.
  const finished = buildWatchFrame(
    { slug: 'gamma', state: 'finished', repo: 'repoC', snap, record: { pid: 9, branch: 'pir/gamma' } },
    { now: NOW },
  );
  assert.match(frameText(finished), /finished · this frame is stale.*git switch main && git merge\s+pir\/gamma/s, 'a finished run shows the hand-off');
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
  assert.match(green, /finished · this frame is stale\. Hand-off: git switch main && git merge pir\/gamma/);
  // A dev run's snapshot carries its base (base-branch T07): the stale line and the footer both switch to dev.
  const dev = frameFor({ branch: 'pir/gamma', base: 'dev', ceiling: 2, complete: true, readyToMerge: true, tasks });
  assert.match(dev, /finished · this frame is stale\. Hand-off: git switch dev && git merge pir\/gamma/);
  assert.doesNotMatch(dev, /\bmain\b/);
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
  assert.equal(decodeKey(Buffer.from('\r')), 'enter', 'Enter (CR): opens, or starts on the go question');
  assert.equal(decodeKey(Buffer.from('\n')), 'enter', 'Enter (LF)');
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

// T20: pi-tui's alternate screen scrolls its own viewport on PgUp/PgDn, Home/End, Ctrl+↑/↓ and opens a
// search on Ctrl+Shift+F, consuming those keys before pir's listener. pir's frame is always the terminal's
// height, so that viewport never scrolls: in the conversation view PgUp/PgDn did nothing at all.
test('every key reaches pir: pi-tui\'s viewport scrolling and search keys are not swallowed', () => {
  const tty = fakeStream({ isTTY: true, columns: 40, rows: 5 });
  const term = fakeTerminal(tty);
  const s = createScreen({ stream: tty, colour: false, terminal: term });
  const got = [];
  s.listen((d) => got.push(d), () => {});
  const keys = ['\x1b[5~', '\x1b[6~', '\x1b[H', '\x1b[F', '\x1b[1;5A', '\x1b[1;5B', '\x1b[1;6A', '\x1b[102;6u', 'x'];
  for (const k of keys) term.press(k);
  s.close();
  assert.deepEqual(got, keys);
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

test('a conflict sent to its live worker draws no paste block in the watch frame (live-workers T08)', () => {
  const runState = { branch: 'pir/alpha', ceiling: 2, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in a.txt', conflictSent: true }] };
  const snap = { version: 1, proc: {}, finalState: null, runState };
  const frame = buildWatchFrame({ slug: 'alpha', state: 'running', repo: 'repoA', snap, record: { pid: 1, branch: 'pir/alpha' } }, { now: NOW, columns: 120 });
  const text = frameText(frame);
  assert.ok(!text.includes('git merge'), 'no paste block is drawn for the person');
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
    // Wide enough for the whole repo name: at 80 columns REPO is cut to make room for TYPE (T11).
    stdout: { columns: 120 },
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
  // The proof the reused watch frame colours exactly as the coordinator paints it: render.mjs's five
  // row/footer codes are pir-view's.
  const renderMap = Object.fromEntries(['active', 'asking', 'done', 'idle', 'red'].map((k) => [k, RENDER_SGR[k]]));
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

test('FrameView paints the selected row as a full-width grey band with dim text brightened; colour off keeps the ▎ mark', () => {
  const row = [{ text: '▎ ', style: 'selected' }, { text: 'alpha ', style: 'dim' }, { text: '● running', style: 'running' }];
  const [line] = new FrameView(() => [row]).render(20);
  assert.equal(visibleWidth(line), 20, 'the band runs the full width');
  assert.ok(!line.includes('▎'), 'with colour the mark is blanked: the band is the selection');
  assert.ok(!line.includes(SGR.dim), 'dim text is brightened on the band');
  assert.ok(line.includes(`${SELECTED_BG}${SGR.running}● running`), 'a state colour is kept, on the band');
  assert.ok(line.split(RESET_RE).every((part) => part === '' || part.startsWith(SELECTED_BG)), 'every painted piece re-opens the band after a reset');
  const [plain] = new FrameView(() => [row], { colour: false }).render(20);
  assert.equal(plain, '▎ alpha ● running', 'colour off draws the mark as text, so colour is not the only signal');
  const [other] = new FrameView(() => [[{ text: '  beta', style: 'dim' }]]).render(20);
  assert.ok(!other.includes(SELECTED_BG), 'an unselected row has no band');
});
const RESET_RE = /\x1b\[0m/;

// Hover (mouse-navigation §2.2, T03). The test command sets NO_COLOR, so SGR is the basic table; the
// 24-bit case is reached by passing the Mocha table to paintLine explicitly.
const MOCHA_PAL = { sgr: MOCHA_SGR, lift: MOCHA_HOVER_LIFT, asking: MOCHA_HOVER_ASKING };

test('paintLine: a hovered plain line gains bold, with its text and clipping unchanged', () => {
  const row = [{ text: 'alpha ', style: null }, { text: '● running', style: 'running' }, { text: ' tail', style: 'head' }];
  const hovered = paintLine(row, 12, true, { hovered: true });
  assert.equal(hovered, `\x1b[1malpha \x1b[0m\x1b[1m${SGR.running}● runn\x1b[0m`);
  assert.equal(hovered.replace(/\x1b\[[0-9;]*m/g, ''), paintLine(row, 12, false), 'same text, same clip');
  assert.equal(visibleWidth(hovered), visibleWidth(paintLine(row, 12)), 'same width as unhovered');
  assert.equal(paintLine(row, 12, true, { hovered: false }), paintLine(row, 12), 'hovered false paints as before');
});

test('paintLine: a hovered dim span is lifted — Mocha subtext1 bold on 24-bit, plain bold without dim on basic', () => {
  for (const style of ['dim', 'ended', 'idle', 'hint', 'bar-idle']) {
    const row = [{ text: 'x', style }];
    assert.equal(paintLine(row, 10, true, { hovered: true }), `${BASIC_HOVER_LIFT}x\x1b[0m`, `basic ${style}`);
    assert.ok(!paintLine(row, 10, true, { hovered: true }).includes('\x1b[2m'), `basic ${style} loses the faint attribute`);
    assert.equal(paintLine(row, 10, true, { hovered: true, palette: MOCHA_PAL }), '\x1b[1;38;2;186;194;222mx\x1b[0m', `24-bit ${style}`);
  }
  assert.equal(HOVER_LIFT, BASIC_HOVER_LIFT, 'the module paints with the basic lift under NO_COLOR');
  // A non-dim span keeps its colour, bold, on the 24-bit table too.
  assert.equal(paintLine([{ text: 'ok', style: 'running' }], 10, true, { hovered: true, palette: MOCHA_PAL }), `\x1b[1m${MOCHA_SGR.running}ok\x1b[0m`);
});

// T08 drill: a row asking the person is amber bold throughout, so bold alone showed no hover on it; the user
// chose a brighter amber. `your-go` is the same amber and brightens the same way.
test('paintLine: a hovered asking span turns the brighter amber, on both tables; other spans as before', () => {
  assert.equal(HOVER_ASKING, BASIC_HOVER_ASKING, 'the module paints with the basic amber under NO_COLOR');
  const row = [{ text: '  ● T02  ', style: 'asking' }, { text: '0:05', style: 'dim' }, { text: ' ok', style: 'running' }];
  assert.equal(paintLine(row, 20, true, { hovered: true }), `${BASIC_HOVER_ASKING}  ● T02  \x1b[0m${BASIC_HOVER_LIFT}0:05\x1b[0m\x1b[1m${SGR.running} ok\x1b[0m`);
  assert.equal(paintLine(row, 20, true, { hovered: true, palette: MOCHA_PAL }), `${MOCHA_HOVER_ASKING}  ● T02  \x1b[0m${MOCHA_HOVER_LIFT}0:05\x1b[0m\x1b[1m${MOCHA_SGR.running} ok\x1b[0m`);
  assert.notEqual(paintLine(row, 20, true, { hovered: true }), paintLine(row, 20, true), 'hover shows on an asking row');
  assert.equal(paintLine([{ text: 'go', style: 'your-go' }], 10, true, { hovered: true }), `${BASIC_HOVER_ASKING}go\x1b[0m`);
  assert.equal(paintLine(row, 20, false, { hovered: true }), paintLine(row, 20, false), 'colour off: no hover');
});

test('paintLine: hovered and selected is exactly the selected band, byte for byte', () => {
  const row = [{ text: '▎ ', style: 'selected' }, { text: 'alpha ', style: 'dim' }, { text: '● running', style: 'running' }];
  assert.equal(paintLine(row, 20, true, { hovered: true }), paintLine(row, 20, true));
  assert.equal(paintLine(row, 20, false, { hovered: true }), paintLine(row, 20, false));
});

test('paintLine: with colour off a hovered line equals the unhovered one', () => {
  const row = [{ text: 'alpha ', style: 'dim' }, { text: 'b', style: 'head' }];
  assert.equal(paintLine(row, 20, false, { hovered: true }), paintLine(row, 20, false));
  assert.equal(paintLine(row, 20, false, { hovered: true }), 'alpha b');
});

test('FrameView paints only the hovered line, and only when that line has a hit; a null hover paints as before', () => {
  const hit = (spans, h) => Object.assign(spans, { hit: h });
  const frame = [
    [{ text: 'title', style: 'head' }],
    hit([{ text: 'run one', style: 'dim' }], { kind: 'run', index: 0 }),
    hit([{ text: 'run two', style: null }], { kind: 'run', index: 1 }),
    [{ text: 'a note', style: 'dim' }],
  ];
  let hoverY = null;
  const view = new FrameView(() => frame, { getHoverY: () => hoverY });
  const before = new FrameView(() => frame).render(40);
  assert.deepEqual(view.render(40), before, 'null hover paints as a view without hover');
  hoverY = 2;
  const lit = view.render(40);
  assert.equal(lit[2], '\x1b[1mrun two\x1b[0m', 'the hovered row is bold');
  assert.deepEqual([lit[0], lit[1], lit[3]], [before[0], before[1], before[3]], 'every other line is unchanged');
  hoverY = 3;
  assert.deepEqual(view.render(40), before, 'a line with no hit does not light up');
  hoverY = 0;
  assert.deepEqual(view.render(40), before, 'nor does the title');
  hoverY = 9;
  assert.deepEqual(view.render(40), before, 'a hover past the frame paints nothing');
  hoverY = 1;
  assert.deepEqual(new FrameView(() => frame, { colour: false, getHoverY: () => 1 }).render(40), new FrameView(() => frame, { colour: false }).render(40), 'colour off: no hover');
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
  assert.equal(decodeKey('\x1b[13u'), 'enter', 'Kitty Enter');
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

// These two paint a run's view (openWatch), not the list: the list is a mounted component now (dashboard-plan-box
// T05) and never goes through screen.paint, which is the call they make throw.
test('through pi-tui: a throw inside painting stops the terminal and leaves the alternate screen before rethrowing (§2.14)', async () => {
  const tty = fakeStream({ isTTY: true });
  const term = fakeTerminal(tty);
  const boom = { toString: () => { throw new Error('paint blew up'); } };
  await assert.rejects(
    openWatch('gone', {
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
  const done = openWatch('gone', {
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

// --- planning runs in the list (pir-plan-command T11, DESIGN §2.10, §2.14) ---------------------------

const planRow = ({ slug, state = 'running', step = 'plan', outcome = null, go = null, label = null, repo = 'shop', live = 1 }) => ({
  key: `${repo}__${slug}`,
  slug,
  state,
  repo,
  progress: { done: 0, total: 0 },
  workers: live,
  record: { kind: 'plan', label, go, repo, slug },
  snap: { runState: { kind: 'plan', label, slug: null, step, outcome, steps: [] } },
});
const PLAN_VIEWS = [
  planRow({ slug: 'csv-export', state: 'finished', step: 'done', outcome: 'reviewed', live: 0 }),
  planRow({ slug: 'plan-3f2a', label: 'Add dark mode to the bl…', repo: 'blog' }),
  { key: 'shop__invoice-import', slug: 'invoice-import', state: 'running', repo: 'shop', progress: { done: 6, total: 10 }, workers: 3 },
  planRow({ slug: 'search-rework', state: 'crashed', step: 'review', live: 0 }),
  // An index record written before planning runs existed: no kind at all.
  { key: 'plan-implement-review__old-build', slug: 'old-build', state: 'finished', repo: 'plan-implement-review', progress: { done: 4, total: 4 }, workers: 0, record: { repo: 'plan-implement-review', slug: 'old-build' } },
];

// The visible column each span of a row starts at.
const spanStarts = (line) => {
  let at = 0;
  return line.map((sp) => {
    const start = at;
    at += visibleWidth(sp.text);
    return start;
  });
};

test('the list frame: TYPE column, the label in quotes, plan states and steps, and old records as work', () => {
  const frame = buildListFrame(buildDashboard(PLAN_VIEWS), initialUi());
  const text = frameText(frame);
  assert.match(text, /SLUG +TYPE +STATE +REPO +PROGRESS +WK/, 'TYPE sits between SLUG and STATE');
  assert.match(text, /csv-export +plan +● your go +shop +plan ✓ review ✓ +·/);
  assert.match(text, /"Add dark mode to the bl…" +plan +● planning +blog +plan … +1/);
  assert.match(text, /invoice-import +work +● running +shop +▰+▱+ 6\/10 +3/);
  assert.match(text, /search-rework +plan +✕ crashed +shop +plan ✓ review …/);
  assert.match(text, /old-build +work +◌ finished +plan-imple\S*… +▰+ 4\/4/, 'a record without kind reads work');
  assert.match(text, /5 runs · 2 running · 1 finished · 1 crashed · 1 waiting for you/, 'your go counts as waiting, not finished');

  assert.equal(findSpan(frame, 'plan  ').style, 'type-plan', 'TYPE plan is magenta');
  assert.equal(findSpan(frame, 'work  ').style, 'type-work', 'TYPE work is blue');
  assert.equal(findSpan(frame, '● your go').style, 'your-go', 'your go is amber bold');
  assert.equal(findSpan(frame, '● planning').style, 'running', 'planning is green, as running');
  assert.equal(findSpan(frame, '"Add dark mode').style, 'dim', 'the label is dimmed');
  assert.equal(findSpan(frame, '1 waiting for you').style, 'your-go');
  assert.equal(SGR['type-plan'], '\x1b[35m');
  assert.equal(SGR['type-work'], '\x1b[34m');
  assert.equal(SGR['your-go'], '\x1b[1;33m');
});

test('the list frame: a build with a worker asking reads `asking you` amber bold and counts as waiting', () => {
  const tasks = [{ id: 'T01', slug: 'one', deps: [], done: false, phase: 'asking' }];
  const asking = { key: 'shop__checkout', slug: 'checkout', state: 'running', repo: 'shop', progress: { done: 1, total: 4 }, workers: 2, snap: { runState: { branch: 'pir/checkout', ceiling: 2, tasks } } };
  const frame = buildListFrame(buildDashboard([asking, ...PLAN_VIEWS]), initialUi());
  const text = frameText(frame);
  assert.match(text, /checkout +work +● asking you +shop +▰+▱+ 1\/4 +2/, 'the whole state fits its column');
  assert.equal(findSpan(frame, '● asking you').style, 'your-go', 'the colour of asking');
  assert.equal(findSpan(frame, '▰').style, 'bar-run', 'the progress bar stays a running run\'s');
  assert.match(text, /6 runs · 2 running · 1 finished · 1 crashed · 2 waiting for you/);
});

test('the list frame: TYPE, STATE and PROGRESS follow one rule, so a record saying work beside a plan snapshot is all work (T11 review)', () => {
  // Reproduced by rendering this row: before the fix TYPE and PROGRESS read the snapshot (plan, `plan …`)
  // while STATE read the record (● running), three cells telling two stories.
  const view = { key: 'shop__odd', slug: 'odd', state: 'running', repo: 'shop', progress: { done: 0, total: 0 }, workers: 0, record: { kind: 'work' }, snap: { runState: { kind: 'plan', step: 'plan', outcome: null, steps: [] } } };
  const text = frameText(buildListFrame(buildDashboard([view]), initialUi()));
  assert.match(text, /odd +work +● running +shop +/);
  assert.doesNotMatch(text, /plan …/);
});

test('the list frame at 80 columns: every row aligned under the header and none wider than 80, a long label included', () => {
  const frame = buildListFrame(buildDashboard(PLAN_VIEWS), initialUi(), { columns: 80 });
  const header = frame.find((l) => l.length === 1 && l[0].text.startsWith('  SLUG'))[0].text;
  const rows = frame.filter((l) => l.length === 7);
  assert.equal(rows.length, PLAN_VIEWS.length);
  const heads = ['TYPE', 'STATE', 'REPO', 'PROGRESS', 'WK'].map((h) => header.indexOf(h));
  for (const row of rows) {
    assert.deepEqual(spanStarts(row).slice(2), heads, `aligned: ${row.map((s) => s.text).join('')}`);
    assert.ok(visibleWidth(row.map((s) => s.text).join('')) <= 80);
  }
  assert.ok(visibleWidth(header) <= 80);
  for (const line of frame) assert.ok(visibleWidth(line.map((s) => s.text).join('')) <= 80, line.map((s) => s.text).join(''));
  // A 24-character label (runrecord's LABEL_MAX) shows whole, with a space before TYPE.
  assert.ok(rows.some((r) => r[1].text === '"Add dark mode to the bl…" '));
  // At 120 columns the repo is not cut.
  assert.match(frameText(buildListFrame(buildDashboard(PLAN_VIEWS), initialUi(), { columns: 120 })), /plan-implement-review +▰/);
});

test('the armed resume line names the row as it shows: the label for an unnamed plan', () => {
  const dash = buildDashboard(PLAN_VIEWS);
  const armed = { ...initialUi(), sel: 1, armed: { action: 'resume', slug: 'plan-3f2a', key: 'blog__plan-3f2a' } };
  const line = findSpan(buildListFrame(dash, armed), 'Ctrl+R again');
  assert.equal(line.text, '⚠ Ctrl+R again to resume "Add dark mode to the bl…"');
  assert.equal(line.style, 'armed');
  const named = findSpan(buildListFrame(dash, { ...armed, armed: { action: 'resume', slug: 'search-rework', key: 'shop__search-rework' } }), 'Ctrl+R again');
  assert.equal(named.text, '⚠ Ctrl+R again to resume search-rework');
});

test('decodeKey: Ctrl+R, raw and Kitty, is ctrlR', () => {
  assert.equal(decodeKey(Buffer.from([0x12])), 'ctrlR');
  assert.equal(decodeKey('\x1b[114;5u'), 'ctrlR');
});

test('Ctrl+R Ctrl+R on a resumable row calls resumeRun with its record; a refusal shows under the list', async () => {
  let onData = null;
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const frames = [];
  const resumed = [];
  let answer = { resumed: true, pid: 7 };
  const done = openDashboard({
    stdin,
    stdout: { columns: 80 },
    refreshMs: 60_000,
    makeScreen: () => ({ paint: (f) => frames.push(f), close: () => {} }),
    load: () => buildDashboard(PLAN_VIEWS),
    resume: async (record) => {
      resumed.push(record.slug);
      return answer;
    },
  });
  const last = () => frameText(frames.at(-1));
  // Row 0 is `your go`: Ctrl+R is not offered there.
  await onData('\x12');
  assert.doesNotMatch(last(), /Ctrl\+R again/);
  for (let i = 0; i < 3; i++) await onData('\x1b[B');
  await onData('\x12');
  assert.match(last(), /⚠ Ctrl\+R again to resume search-rework/);
  await onData('\x12');
  assert.deepEqual(resumed, ['search-rework']);
  assert.doesNotMatch(last(), /Ctrl\+R again|Could not resume/);

  answer = { resumed: false, reason: 'already-running' };
  await onData('\x12');
  await onData('\x12');
  assert.match(last(), /Could not resume search-rework: already-running/);
  await onData('\x1b[A');
  assert.doesNotMatch(last(), /Could not resume/, 'the note clears on the next key');
  await onData('\x1b');
  await done;
});

test('loadDashboard on a planning run: WK is its live sessions, and the plan snapshot never reaches buildDisplay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-index-'));
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-control-'));
  const record = {
    version: 1, kind: 'plan', label: 'Add dark mode', go: null, slug: 'plan-3f2a', repo: 'blog', repoPath: '/x/blog', controlDir,
    pid: 4242, startTime: 'Sat Sep 26 10:00:00 2026', startedAt: null, branch: 'pir/plan-3f2a', finalState: null, updatedAt: null,
  };
  writeRecord(record, { dir });
  const step = (id, live) => ({ id, phase: 'planning', since: null, stoppedAt: null, asking: null, worker: live === null ? null : { id: 's', live, logPath: null }, workers: [] });
  writeSnapshot(controlDir, {
    proc: { pid: 4242, startTime: record.startTime, slug: 'plan-3f2a', repo: 'blog', branch: 'pir/plan-3f2a' },
    finalState: null,
    runState: { kind: 'plan', label: 'Add dark mode', slug: null, step: 'plan', outcome: null, steps: [step('plan', true), step('review', null), step('build', null)] },
  });
  const dash = loadDashboard({ dir, now: NOW, kill: () => {}, exec: () => ({ ok: true, stdout: `${record.startTime}\n` }) });
  const [row] = dash.rows;
  assert.equal(row.state, 'running');
  assert.equal(row.display, 'planning');
  assert.equal(row.workers, 1);
  assert.equal(row.record.kind, 'plan');
  assert.match(frameText(buildListFrame(dash, initialUi())), /"Add dark mode" +plan +● planning +blog +plan … +1/);
});

test('a resume pressed while a stop is still reaping waits for the stop to finish (T11)', async () => {
  let onData = null;
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const events = [];
  let finishStop;
  let rows = [planRow({ slug: 'plan-1', label: 'A plan', state: 'running' })];
  const done = openDashboard({
    stdin,
    stdout: { columns: 80 },
    refreshMs: 60_000,
    makeScreen: () => ({ paint: () => {}, close: () => {} }),
    load: () => buildDashboard(rows),
    stop: async () => {
      events.push('stop start');
      // The program has recorded `stopped`, so the row reads stopped while the reap goes on.
      rows = [planRow({ slug: 'plan-1', label: 'A plan', state: 'stopped' })];
      await new Promise((r) => (finishStop = r));
      events.push('stop end');
    },
    resume: async () => {
      events.push('resume');
      return { resumed: true, pid: 1 };
    },
  });
  await onData('\x13');
  const stopping = onData('\x13');
  await new Promise((r) => setImmediate(r));
  await onData('\x12');
  const resuming = onData('\x12');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ['stop start'], 'the resume has not run while the stop is in flight');
  finishStop();
  await stopping;
  await resuming;
  assert.deepEqual(events, ['stop start', 'stop end', 'resume']);
  await onData('\x1b');
  await done;
});

// --- a planning run's live view and its go (pir-plan-command T12, DESIGN §2.8, §2.11) -----------------

const stepsRun = ({ state = 'finished', outcome = 'reviewed', step = 'done', go = null, steps } = {}) => ({
  key: 'shop__csv-export',
  slug: 'csv-export',
  state,
  repo: 'shop',
  progress: { done: 0, total: 0 },
  workers: 0,
  record: { kind: 'plan', label: null, go, repo: 'shop', slug: 'csv-export', repoPath: '/x/shop', branch: 'pir/csv-export', pid: 42, startTime: 't0' },
  snap: {
    runState: {
      kind: 'plan', label: null, slug: 'csv-export', step, outcome,
      steps: steps ?? [
        { id: 'plan', phase: 'done', since: 0, stoppedAt: null, asking: null, worker: { id: 'p1', live: false, logPath: '/c/plan-1.ndjson' } },
        { id: 'review', phase: 'done', since: 0, stoppedAt: null, asking: null, worker: { id: 'r1', live: false, logPath: '/c/review-1.ndjson' } },
        { id: 'build', phase: 'pending', since: null, stoppedAt: null, asking: null, worker: null },
      ],
    },
  },
});
const PROGRESS_3 = '## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| T01 | a | — | ⬜ | |\n| T02 | b | T01 | ⬜ | |\n| T03 | c | T01 | ⬜ | |\n';

test('the steps frame: a row per step painted as task rows, the asking footer, and the steps key hint', () => {
  const run = stepsRun({
    state: 'running', outcome: null, step: 'plan',
    steps: [
      { id: 'plan', phase: 'asking', since: NOW - 60_000, stoppedAt: NOW - 20_000, asking: 'questions', worker: { id: 'p1', live: true } },
      { id: 'review', phase: 'pending', worker: null },
      { id: 'build', phase: 'pending', worker: null },
    ],
  });
  const frame = buildWatchFrame(run, { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 0 } });
  const text = frameText(frame);
  assert.match(text, /^csv-export · planning · pir\/csv-export/);
  assert.match(text, /▎ ● plan +planner +asking you · a question +0:40/);
  assert.match(text, /  ○ review +reviewer +starts when the plan is written/);
  assert.match(text, /  ○ build +— +asks your go after review/);
  assert.match(text, /● plan — asking you; open it \(→\) to answer/);
  assert.match(text, /↑↓ pick a step · → open it · ← back · Ctrl\+S Ctrl\+S stop this run · esc quit/);
  assert.ok([...text.split('\n').at(-1)].length <= 80, 'the hint fits 80 columns');
  assert.equal(findSpan(frame, 'asking you · a question').style, 'asking');
  assert.equal(findSpan(frame, 'starts when').style, 'idle');
});

test('the go question: the slug, the width line, the keys, and a hint that esc keeps it', () => {
  const frame = buildWatchFrame(stepsRun(), { now: NOW, ui: { ...initialUi(), view: 'watch' }, progress: PROGRESS_3 });
  const text = frameText(frame);
  assert.match(text, /csv-export · reviewed · pir\/csv-export/);
  assert.match(text, /● build +— +waiting for your go/);
  assert.match(text, /csv-export is reviewed\. Start the parallel build now\?/);
  assert.match(text, /3 tasks, longest chain 2, up to 2 can run at once\./);
  assert.match(text, /It builds on pir\/csv-export\./);
  assert.match(text, /↵ Start the build +n Not now/);
  assert.match(text, /↵ start · n not now · ← back to the list · esc quit \(the question keeps\)/);
  assert.equal(findSpan(frame, 'Start the parallel build').style, 'your-go');
});

test('declined: the stale note says how to build it later, and there is no question', () => {
  const text = frameText(buildWatchFrame(stepsRun({ go: 'declined' }), { now: NOW }));
  assert.match(text, /csv-export · finished/);
  assert.match(text, /Build it with: pir start csv-export/);
  assert.doesNotMatch(text, /Start the parallel build/);
  assert.match(text, /○ build +— +not started/);
});

test('crashed mid-review: stale note naming Ctrl+R, and the log tail', () => {
  const run = stepsRun({ state: 'crashed', outcome: null, step: 'review', steps: [
    { id: 'plan', phase: 'done', worker: { id: 'p1', live: false } },
    { id: 'review', phase: 'reviewing', since: 0, worker: { id: 'r1', live: true } },
    { id: 'build', phase: 'pending', worker: null },
  ] });
  const text = frameText(buildWatchFrame(run, { now: NOW, logTail: ['boom'], columns: 120 }));
  assert.match(text, /✗ review +reviewer +crashed/);
  assert.match(text, /the planning program died; this frame is stale\. Ctrl\+R Ctrl\+R on the list resumes it/);
  assert.match(text, /boom/);
});

// Drive runTui on the go question with a fake load that answers from a mutable list.
function goHarness({ startAnswer = { started: true, pid: 9 } } = {}) {
  let onData = null;
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const frames = [];
  const calls = { start: [], decline: [], progress: 0 };
  let views = [stepsRun()];
  const done = openDashboard({
    stdin,
    stdout: { columns: 100 },
    refreshMs: 60_000,
    makeScreen: () => ({ paint: (f) => frames.push(f), close: () => {} }),
    load: () => buildDashboard(views),
    readProgress: () => {
      calls.progress += 1;
      return PROGRESS_3;
    },
    start: async (slug, opts) => {
      calls.start.push({ slug, cwd: opts.cwd });
      if (startAnswer.started) views = [{ key: 'shop__csv-export', slug: 'csv-export', state: 'running', repo: 'shop', progress: { done: 0, total: 1 }, workers: 0, record: { repo: 'shop', slug: 'csv-export', pid: 9, startTime: 't1', controlDir: '/c' }, snap: null }];
      return startAnswer;
    },
    decline: (record) => {
      calls.decline.push(record.slug);
      views = [stepsRun({ go: 'declined' })];
    },
  });
  return { send: (k) => onData(k), last: () => frameText(frames.at(-1)), calls, done };
}

test('↵ on the go question calls startRun in the repo and the view becomes the build of the same row', async () => {
  const h = goHarness();
  await h.send('\r'); // open the row
  assert.match(h.last(), /Start the parallel build now\?/);
  assert.match(h.last(), /3 tasks, longest chain 2/);
  await h.send('\x1b[B'); // moving the step selection does not answer it
  assert.deepEqual(h.calls.start, []);
  await h.send('\r');
  assert.deepEqual(h.calls.start, [{ slug: 'csv-export', cwd: '/x/shop' }]);
  assert.match(h.last(), /waiting for the first snapshot/, "the build's live view, on the same key");
  assert.match(h.last(), /pick a task/);
  assert.equal(h.calls.progress, 1, 'the plan is read once for its width line, not on every paint');
  await h.send('\x1b');
  await h.done;
});

test('n on the go question records the decline; the question is gone and the note says pir start', async () => {
  const h = goHarness();
  await h.send('\r');
  await h.send('n');
  assert.deepEqual(h.calls.decline, ['csv-export']);
  assert.deepEqual(h.calls.start, []);
  assert.doesNotMatch(h.last(), /Start the parallel build/);
  assert.match(h.last(), /Build it with: pir start csv-export/);
  await h.send('\x1b');
  await h.done;
});

test('a refused start shows its reason under the question and keeps it', async () => {
  const h = goHarness({ startAnswer: { started: false, reason: 'no-test-block', detail: 'no test lines' } });
  await h.send('\r');
  await h.send('\r');
  assert.match(h.last(), /Could not start csv-export: no-test-block — no test lines/);
  assert.match(h.last(), /Start the parallel build now\?/);
  await h.send('\x1b'); // esc quits; nothing was declined
  await h.done;
  assert.deepEqual(h.calls.decline, []);
});

test('decodeKey: n is the not-now key', () => {
  assert.equal(decodeKey('n'), 'n');
});

// --- where `pir plan` lands, and following into the reviewer (pir-plan-command T13, DESIGN §2.12) ---------

const planStep = (id, worker = null) => ({ id, phase: worker ? 'planning' : 'pending', worker });
const landingRun = (steps) => stepsRun({ state: 'running', outcome: null, step: 'plan', steps });
const landingUi = { ...initialUi(), view: 'watch', openSlug: 'csv-export', openStep: 'plan' };

test('landStep: waits while the planner has no session, then opens its conversation with the plan row selected', () => {
  const waiting = [landingRun([planStep('plan'), planStep('review'), planStep('build')])];
  assert.equal(landStep(landingUi, waiting), landingUi, 'no session yet: unchanged');
  const ready = [landingRun([planStep('plan', { id: 'p1', live: true, logPath: '/c/plan-1.ndjson' }), planStep('review'), planStep('build')])];
  const ui = landStep(landingUi, ready);
  assert.equal(ui.view, 'worker');
  assert.deepEqual(ui.openWorker, { taskId: 'plan', workerId: 'p1', logPath: '/c/plan-1.ndjson', live: true });
  assert.equal(ui.taskSel, 0);
  assert.equal(ui.openStep, null);
  const plain = { ...initialUi(), view: 'watch', openSlug: 'csv-export' };
  assert.equal(landStep(plain, ready), plain, 'a view not waiting on a step is left alone');
});

test("followStep: the planner's conversation open and a new review session → the reviewer's, headed by the line", () => {
  const ui = { ...initialUi(), view: 'worker', openSlug: 'csv-export', taskSel: 0, openWorker: { taskId: 'plan', workerId: 'p1', logPath: '/c/plan-1.ndjson', live: true } };
  const before = [landingRun([planStep('plan', { id: 'p1', live: true }), planStep('review'), planStep('build')])];
  assert.equal(followStep(ui, before, null), null, 'no reviewer yet');
  const after = [landingRun([planStep('plan', { id: 'p1', live: false }), planStep('review', { id: 'r1', live: true, logPath: '/c/review-1.ndjson' }), planStep('build')])];
  const next = followStep(ui, after, null);
  assert.equal(next.view, 'worker');
  assert.deepEqual(next.openWorker, { taskId: 'review', workerId: 'r1', logPath: '/c/review-1.ndjson', live: true, headLine: FOLLOW_LINE });
  assert.equal(next.taskSel, 1);
  assert.equal(FOLLOW_LINE, 'the planner finished; the reviewer has started');
  assert.equal(followStep(ui, after, 'r1'), null, 'a reviewer already there when the planner was opened does not move it');
});

test('followStep: the steps view, the list, and the reviewer\'s own conversation are never moved', () => {
  const after = [landingRun([planStep('plan', { id: 'p1' }), planStep('review', { id: 'r1', live: true }), planStep('build')])];
  assert.equal(followStep({ ...initialUi(), view: 'watch', openSlug: 'csv-export' }, after, null), null);
  assert.equal(followStep({ ...initialUi(), view: 'list' }, after, null), null);
  assert.equal(followStep({ ...initialUi(), view: 'worker', openSlug: 'csv-export', openWorker: { taskId: 'review', workerId: 'r1' } }, after, null), null);
});

test('buildLandingFrame: the run by its label and branch, and the starting line', () => {
  const run = landingRun([planStep('plan'), planStep('review'), planStep('build')]);
  run.record = { ...run.record, label: 'Export orders', slug: 'plan-3f9a', branch: 'pir/plan-3f9a' };
  const text = frameText(buildLandingFrame(run));
  assert.match(text, /^"Export orders" · planning · pir\/plan-3f9a/);
  assert.match(text, /starting the planner…/);
  assert.match(text, /← the run's steps · esc quit/);
});

test('openPlanner: starting the planner…, then ← on it is the steps view', async () => {
  let onData = null;
  const stdin = { on: (_e, fn) => (onData = fn), off: () => {} };
  const frames = [];
  const run = landingRun([planStep('plan'), planStep('review'), planStep('build')]);
  const done = openPlanner('csv-export', {
    stdin,
    stdout: { columns: 80 },
    refreshMs: 60_000,
    makeScreen: () => ({ paint: (f) => frames.push(frameText(f)), close: () => {} }),
    load: () => buildDashboard([run]),
  });
  assert.match(frames.at(-1), /starting the planner…/);
  await onData('\x1b[B'); // other keys do nothing while waiting
  assert.match(frames.at(-1), /starting the planner…/);
  await onData('\x1b[D');
  assert.match(frames.at(-1), /pick a step/);
  await onData('\x1b');
  await done;
});

// T13 review: the follow's "was the reviewer already there" id was read only when the conversation was built,
// after followStep had already run for that repaint, so opening a finished run's planner bounced straight to its
// old reviewer.
test("runTui: opening a finished run's planner from its steps view stays in the planner's conversation", async () => {
  const t = driveTui(() => [stepsRun({ step: 'done', outcome: 'not-reviewed' })]);
  await t.key('\r'); // open the row: the steps view
  assert.match(t.barRow(), /plan/);
  await t.key('\x1b[C'); // → the planner's conversation
  assert.match(t.text(), /^plan +worker p1/m, "the planner's conversation");
  assert.doesNotMatch(t.text(), /the planner finished; the reviewer has started/);
  await t.key('\x1b[D');
  await t.key('\x1b');
  await t.done;
});

test('bare pir with PIR_DASHBOARD_STATE: the file follows list → run → worker → back, and is gone on quit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-dash-'));
  const path = join(dir, 'state.json');
  const seen = [];
  const read = () => JSON.parse(readFileSync(path, 'utf8'));
  const t = driveTui(() => [tasksRun(T12_TASKS)], {
    env: { PIR_DASHBOARD_STATE: path },
    makePublisher: (opts) => {
      const p = createDashboardPublisher({ ...opts, mainWorktree: () => null });
      return { ...p, update: (ui, rows) => (p.update(ui, rows), seen.push(read().view)) };
    },
  });
  assert.deepEqual([read().view, read().pid], ['list', process.pid]);
  await t.key('\r');
  assert.deepEqual(read().run, { key: 'repo__plan', kind: 'work', slug: 'plan', repo: 'repo', repoPath: null, branch: null, cwd: null });
  await t.key('\x1b[B'); // a task-cursor move rewrites nothing
  await t.key('\x1b[C'); // T02's worker
  assert.deepEqual(read().worker, { id: 'w2', task: 'T02', role: null, cwd: null });
  await t.key('\x1b[D');
  assert.equal(read().view, 'run');
  await t.key('\x1b[D');
  assert.equal(read().view, 'list');
  await t.key('\x1b');
  await t.done;
  assert.ok(!existsSync(path), 'a clean quit removes the file');
});

test('pir start and pir plan never publish, whatever PIR_DASHBOARD_STATE says', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-dash-'));
  const path = join(dir, 'state.json');
  let onData = null;
  const done = openPlanner('repo__plan', {
    stdin: { on: (_e, fn) => (onData = fn), off: () => {} },
    stdout: {},
    refreshMs: 60_000,
    env: { PIR_DASHBOARD_STATE: path },
    makeScreen: () => ({ paint: () => {}, close: () => {} }),
    load: () => buildDashboard([tasksRun(T12_TASKS)]),
  });
  await onData('\x1b');
  await done;
  assert.ok(!existsSync(path));
});

// --- dashboard-plan-box T04: the list block windowed above the new-plan box (§2.7) -----------------

import { rowWindow, listFooter, EMPTY_LIST_BOX } from './pir-tui.mjs';

const manyViews = (n) => Array.from({ length: n }, (_, i) => ({ slug: `run-${String(i).padStart(2, '0')}`, state: 'finished', repo: 'r', progress: { done: 1, total: 1 }, workers: 0 }));

test('rowWindow keeps the selection visible and counts the rows cut on each side', () => {
  assert.deepEqual(rowWindow(4, 2, 5), { start: 0, end: 4, up: 0, down: 0 }, 'everything fits: no window');
  assert.deepEqual(rowWindow(30, 0, 5), { start: 0, end: 4, up: 0, down: 26 });
  assert.deepEqual(rowWindow(30, 15, 5), { start: 14, end: 17, up: 14, down: 13 });
  assert.deepEqual(rowWindow(30, 29, 5), { start: 26, end: 30, up: 26, down: 0 });
  assert.deepEqual(rowWindow(30, 15, 1), { start: 15, end: 16, up: 0, down: 0 }, 'one slot: the selected row, no marker');
  assert.deepEqual(rowWindow(30, 0, 2), { start: 0, end: 1, up: 0, down: 29 }, 'a marker shows beside one row when both fit');
  assert.deepEqual(rowWindow(30, 15, 2), { start: 15, end: 17, up: 0, down: 0 }, 'two markers do not fit beside a row: two rows, no marker');
});

test('buildListFrame with rows is the list block alone, cut to the budget: spacers first, then the title', () => {
  const dash = buildDashboard(VIEWS);
  const full = buildListFrame(dash, initialUi(), { rows: 20 });
  assert.equal(full.length, 10, 'title, spacer, header, 4 rows, spacer, counts, spacer');
  assert.doesNotMatch(frameText(full), /esc quit/, 'no footer: the list view draws it under the box');
  assert.match(frameText(full[0] ? [full[0]] : []), /runs on this machine/);

  const minus2 = buildListFrame(dash, initialUi(), { rows: 8 });
  assert.equal(minus2.length, 8);
  assert.match(frameText([minus2[0]]), /runs on this machine/, 'the title stays while a spacer can go');
  assert.equal(minus2.filter((l) => l.length === 0).length, 1, 'two spacers dropped, the one under the title kept');

  const noTitle = buildListFrame(dash, initialUi(), { rows: 6 });
  assert.equal(noTitle.length, 6);
  assert.match(frameText([noTitle[0]]), /SLUG/, 'spacers and title gone; the header leads');
  assert.match(frameText([noTitle.at(-1)]), /4 runs/, 'the counts line stays');
});

test('buildListFrame with rows windows 30 runs, with ↑/↓ n more, the selected row always visible', () => {
  const dash = buildDashboard(manyViews(30));
  for (const [sel, up, down] of [[0, 0, 26], [15, 14, 13], [29, 26, 0]]) {
    const f = buildListFrame(dash, { ...initialUi(), sel }, { rows: 7 });
    const text = frameText(f);
    assert.equal(f.length, 7, `sel ${sel}: exactly the budget`);
    assert.match(text, new RegExp(`▎ run-${String(sel).padStart(2, '0')}`), `sel ${sel}: the selected row shows`);
    if (up) assert.match(text, new RegExp(`↑ ${up} more`));
    else assert.doesNotMatch(text, /↑ \d+ more/);
    if (down) assert.match(text, new RegExp(`↓ ${down} more`));
    else assert.doesNotMatch(text, /↓ \d+ more/);
  }
  const one = buildListFrame(dash, { ...initialUi(), sel: 12 }, { rows: 3 });
  assert.equal(one.length, 3, 'header, one row, counts');
  assert.match(frameText(one), /▎ run-12/);
  assert.doesNotMatch(frameText(one), /more/, 'no marker with room for one row only');
});

test('the empty list above the box points at the box; without rows it still points at pir start', () => {
  const dash = buildDashboard([]);
  assert.match(frameText(buildListFrame(dash, initialUi(), { rows: 20 })), new RegExp(EMPTY_LIST_BOX.trim()));
  assert.equal(EMPTY_LIST_BOX.trim(), 'No runs yet — type after @ below to plan or build');
  assert.match(frameText(buildListFrame(dash, initialUi())), /start one with `pir start \{slug\}`/);
});

test('listFooter is the footer buildListFrame ends with, armed line included', () => {
  const ui = { ...initialUi(), armed: { action: 'stop', slug: 'alpha' } };
  const dash = buildDashboard(VIEWS);
  assert.deepEqual(listFooter(ui, dash.rows), buildListFrame(dash, ui).at(-1));
  assert.deepEqual(listFooter(initialUi()), buildListFrame(dash, initialUi()).at(-1));
});

// --- the new-plan box starts a planning run (dashboard-plan-box T05, DESIGN §2.3, §2.5) -----------------

const BOX_REPOS = [
  { name: 'repo', path: '/scratch/src/repo', mtimeMs: 2 },
  { name: 'dup', path: '/scratch/src/dup', mtimeMs: 1 },
  { name: 'dup', path: '/scratch/other/dup', mtimeMs: 1 },
];
const BOX_ENV = { HOME: '/scratch', PIR_HOME: '/scratch/.pir', PIR_REPOS: '/scratch/src:/scratch/other' };

// runTui on the pi-tui screen (the list view mounted) with a fake startPlan and scan. `rows()` is re-read on
// every refresh and keypress; `plan` is what the fake startPlan does with (brief, opts).
function driveBox({ rows = () => [], plan = () => ({ started: true, runId: 'plan-ab12', record: { repo: 'repo' } }) } = {}) {
  const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
  const term = fakeTerminal(tty);
  const calls = [];
  const done = openDashboard({
    stdin: {},
    stdout: tty,
    env: BOX_ENV,
    refreshMs: 60_000,
    now: () => NOW,
    makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
    load: () => buildDashboard(rows()),
    scan: () => BOX_REPOS,
    startPlan: (brief, opts) => {
      calls.push({ brief, opts });
      return plan(brief, opts);
    },
  });
  const settle = () => new Promise((r) => setTimeout(r, 60)); // the @ pop-up is debounced, then async
  const type = async (s) => {
    for (const ch of s) term.press(ch);
    await settle();
  };
  const key = async (k) => {
    term.press(k);
    await settle();
  };
  const screen = () => drawnRows(tty.text()).join('\n');
  // The box's own line: the one under the head line's top border.
  const boxLine = () => {
    const r = drawnRows(tty.text());
    const head = r.findIndex((l) => l.startsWith('new  '));
    return head < 0 ? null : r[head + 2];
  };
  return { done, calls, type, key, screen, boxLine, term };
}

test('box: Enter on `@repo/plan a brief` calls startPlan once, in the repo, with the brief, and lands on the planner', async () => {
  const t = driveBox();
  await t.type('repo/plan a brief');
  assert.match(t.boxLine(), /^@repo\/plan a brief/);
  assert.match(t.screen(), /new {2}plan in repo/);
  await t.key('\r');
  assert.equal(t.calls.length, 1, 'started once');
  assert.equal(t.calls[0].brief, 'a brief');
  assert.equal(t.calls[0].opts.cwd, '/scratch/src/repo');
  assert.equal(t.calls[0].opts.env, BOX_ENV);
  assert.match(t.screen(), /starting the planner…/, "openPlanner's landing");
  await t.key('\x1b');
  await t.done;
});

test('box: every §2.5 refusal starts nothing, keeps the text and shows the note', async () => {
  const cases = [
    { keys: ['\x7f', 'hello there'], text: /^hello there/, note: 'start with @repo/plan or @repo/start' },
    { keys: ['nope/plan x'], text: /^@nope\/plan x/, note: 'no repo @nope in ~/src, ~/other — pick one from the list' },
    { keys: ['dup/plan x'], text: /^@dup\/plan x/, note: '@dup is in more than one folder: ~/src/dup, ~/other/dup' }, // home as ~, as the pop-up (T06)
    { keys: ['repo x'], text: /^@repo x/, note: 'pick a command: @repo/plan or @repo/start' },
    { keys: ['repo/plan '], text: /^@repo\/plan/, note: 'say what to plan after @repo/plan' },
  ];
  for (const c of cases) {
    const t = driveBox();
    for (const k of c.keys) await t.type(k);
    await t.key('\r');
    assert.equal(t.calls.length, 0, `${c.note}: nothing started`);
    assert.ok(t.screen().includes(c.note), `${c.note}: the note shows`);
    assert.match(t.boxLine(), c.text, `${c.note}: the text is kept`);
    await t.key('\x1b'); // reset
    assert.match(t.boxLine(), /^@\s*$/);
    assert.ok(!t.screen().includes(c.note), 'Esc clears the note');
    await t.key('\x1b'); // quit
    await t.done;
  }
});

test('box: startPlan refusing (no-base-setting, in plain words) or throwing both give the start-failed note, the text kept', async () => {
  for (const plan of [() => ({ started: false, reason: 'no-base-setting', message: 'pir: no base branch is set for repo. …' }), () => { throw new Error('spawn failed'); }]) {
    const t = driveBox({ plan });
    await t.type('repo/plan a brief');
    await t.key('\r');
    assert.equal(t.calls.length, 1);
    const reason = plan.toString().includes('no-base-setting') ? 'no base branch is set' : 'spawn failed';
    assert.ok(t.screen().includes(`Could not start planning in repo: ${reason}`), t.screen());
    assert.match(t.boxLine(), /^@repo\/plan a brief/);
    assert.doesNotMatch(t.screen(), /starting the planner/);
    await t.key('\x1b');
    await t.key('\x1b');
    await t.done;
  }
});

test('box: a refusal naming its base and remote shows them in the note (base-branch §2.9 short form)', async () => {
  const t = driveBox({ plan: () => ({ started: false, reason: 'diverged', base: 'dev', remote: 'origin' }) });
  await t.type('repo/plan a brief');
  await t.key('\r');
  assert.ok(t.screen().includes('Could not start planning in repo: dev split from origin/dev'), t.screen());
  await t.key('\x1b');
  await t.key('\x1b');
  await t.done;
});

test('box: on a bare box ↓ and → reach the list (open a run); ← back shows the box at @', async () => {
  const rows = [
    { key: 'r__alpha', slug: 'alpha', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'alpha' } },
    { key: 'r__beta', slug: 'beta', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'beta' } },
  ];
  const t = driveBox({ rows: () => rows });
  await t.key('\x1b[B');
  assert.match(drawnRowsSel(t), /beta/);
  await t.key('\x1b[C');
  assert.equal(t.boxLine(), null, 'the run view has no box');
  assert.match(t.screen(), /^beta/m);
  await t.key('\x1b[D');
  assert.match(t.boxLine(), /^@\s*$/, 'back on the list, the box reads @');
  assert.match(drawnRowsSel(t), /beta/, 'the selection kept');
  await t.key('\x1b');
  await t.done;
});

test('box: after a start and back out to the list, the box reads @ again', async () => {
  const t = driveBox();
  await t.type('repo/plan a brief');
  await t.key('\r');
  assert.match(t.screen(), /starting the planner…/);
  await t.key('\x1b[D'); // gives up the wait: the steps view
  await t.key('\x1b[D'); // the list
  assert.match(t.boxLine(), /^@\s*$/);
  assert.doesNotMatch(t.screen(), /a brief/);
  await t.key('\x1b');
  await t.done;
});

function drawnRowsSel(t) {
  return t.screen().split('\n').find((l) => l.startsWith('▎')) ?? '';
}

test('box: Ctrl+X twice removes the selected run, on a bare box and with text typed; the text survives (§2.3)', async () => {
  for (const typed of [null, 'repo half a brief']) {
    const rows = [{ key: 'r__alpha', slug: 'alpha', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'alpha' } }];
    const removed = [];
    const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
    const term = fakeTerminal(tty);
    const done = openDashboard({
      stdin: {}, stdout: tty, env: BOX_ENV, refreshMs: 60_000, now: () => NOW,
      makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
      load: () => buildDashboard(rows), scan: () => BOX_REPOS,
      remove: (record) => removed.push(record.slug),
      startPlan: () => assert.fail('nothing starts'),
    });
    const settle = () => new Promise((r) => setTimeout(r, 60));
    if (typed) { for (const ch of typed) term.press(ch); await settle(); }
    term.press('\x18'); await settle();
    assert.deepEqual(removed, [], 'the first press only arms');
    term.press('\x18'); await settle();
    assert.deepEqual(removed, ['alpha'], `removed (${typed ?? 'bare'})`);
    const r = drawnRows(tty.text());
    const head = r.findIndex((l) => l.startsWith('new  '));
    assert.match(r[head + 2], typed ? /^@repo half a brief/ : /^@\s*$/, 'the box text is untouched');
    term.press('\x1b'); await settle();
    if (typed) { term.press('\x1b'); await settle(); }
    await done;
  }
});

// T06 drill: a key the box took never reached the reducer, so it did not disarm a half-pressed chord, and
// Ctrl+X, a typed brief, then ONE Ctrl+X removed the run. Typing now disarms, and the next press only re-arms,
// with its ⚠ line over the typed box (user, 2026-09-27).
test('box: a typed key disarms a half-pressed chord; the next press only arms, and says so over the text', async () => {
  const rows = [{ key: 'r__alpha', slug: 'alpha', repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug: 'alpha' } }];
  const removed = [];
  const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
  const term = fakeTerminal(tty);
  const done = openDashboard({
    stdin: {}, stdout: tty, env: BOX_ENV, refreshMs: 60_000, now: () => NOW,
    makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
    load: () => buildDashboard(rows), scan: () => BOX_REPOS,
    remove: (record) => removed.push(record.slug),
    startPlan: () => assert.fail('nothing starts'),
  });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const footer = () => drawnRows(tty.text()).filter((l) => l !== '').at(-1);
  term.press('\x18'); await settle();
  assert.match(footer(), /^⚠ Ctrl\+X again to remove alpha/, 'armed on the bare box');
  for (const ch of 'repo a brief') term.press(ch);
  await settle();
  assert.equal(footer(), '↵ start planning · shift+↵ new line · esc clear', 'typing disarmed it');
  term.press('\x18'); await settle();
  assert.deepEqual(removed, [], 'one press after typing only arms');
  assert.match(footer(), /^⚠ Ctrl\+X again to remove alpha/, 'and the ⚠ line shows over the typed box');
  term.press('\x18'); await settle();
  assert.deepEqual(removed, ['alpha']);
  term.press('\x1b'); await settle();
  term.press('\x1b'); await settle();
  await done;
});

// --- `/start` starts, or opens, a build (box-commands T04, DESIGN §2.2, §2.4) ----------------------------

const BUILD_REPOS = [
  { name: 'repo', path: '/scratch/src/repo', mtimeMs: 2 },
  { name: 'other', path: '/scratch/other/other', mtimeMs: 1 },
];
const PLANS = { '/scratch/src/repo': [{ slug: 'foo', done: 0, total: 3 }], '/scratch/other/other': [{ slug: 'foo', done: 1, total: 2 }] };
const buildRow = (repo, slug, { state = 'running', kind } = {}) => ({
  key: `${repo}__${slug}`, slug, repo, state, progress: { done: 0, total: 3 }, workers: 0,
  record: { repo, slug, ...(kind ? { kind } : {}) },
});

// runTui with a fake startRun and plan scan beside the fake startPlan. `build` is what the fake start returns.
function driveStart({ rows = () => [], build = (slug, opts) => ({ started: true, record: { repo: opts.cwd.split('/').at(-1), slug } }) } = {}) {
  const tty = fakeStream({ isTTY: true, columns: 100, rows: 30 });
  const term = fakeTerminal(tty);
  const starts = [];
  const plans = [];
  const scanned = [];
  const done = openDashboard({
    stdin: {}, stdout: tty, env: BOX_ENV, refreshMs: 60_000, now: () => NOW,
    makeScreen: (opts) => createScreen({ ...opts, colour: false, terminal: term }),
    load: () => buildDashboard(rows()),
    scan: () => BUILD_REPOS,
    scanBuildable: (path) => (scanned.push(path), PLANS[path] ?? []),
    start: (slug, opts) => {
      starts.push({ slug, opts });
      return build(slug, opts);
    },
    startPlan: (brief, opts) => {
      plans.push({ brief, opts });
      return { started: true, runId: 'plan-ab12', record: { repo: 'repo' } };
    },
  });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const type = async (s) => { for (const ch of s) term.press(ch); await settle(); };
  const key = async (k) => { term.press(k); await settle(); };
  const screen = () => drawnRows(tty.text()).join('\n');
  const boxLine = () => {
    const r = drawnRows(tty.text());
    const head = r.findIndex((l) => l.startsWith('new  '));
    return head < 0 ? null : r[head + 2];
  };
  const quit = async () => { await key('\x1b'); await done; };
  return { done, starts, plans, scanned, type, key, screen, boxLine, quit };
}

test('box: Enter on `@repo/start foo` calls startRun once in the repo with the slug, never startPlan, and opens its live view', async () => {
  const t = driveStart({ rows: () => [buildRow('repo', 'foo')] });
  await t.type('repo/start foo');
  await t.key('\r'); // the slug pop-up is open on `foo`: this Enter picks
  assert.equal(t.starts.length, 0, 'a pick never submits');
  await t.key('\r');
  assert.equal(t.starts.length, 1, 'started once');
  assert.equal(t.starts[0].slug, 'foo');
  assert.equal(t.starts[0].opts.cwd, '/scratch/src/repo');
  assert.equal(t.starts[0].opts.env, BOX_ENV);
  assert.equal(t.plans.length, 0, 'startPlan not called');
  assert.equal(t.boxLine(), null, 'the live view has no box');
  assert.match(t.screen(), /^foo {2}● running {2}· repo/m, "the build's live view");
  await t.key('\x1b[D');
  assert.match(t.boxLine(), /^@\s*$/, 'back on the list, the box reads @');
  await t.quit();
});

test('box: alreadyRunning opens the live view as started does', async () => {
  const t = driveStart({ rows: () => [buildRow('repo', 'foo')], build: () => ({ started: false, reason: 'already-running', alreadyRunning: true }) });
  await t.type('repo/start foo');
  await t.key('\r');
  await t.key('\r');
  assert.equal(t.starts.length, 1);
  assert.match(t.screen(), /^foo {2}● running {2}· repo/m);
  await t.quit();
});

test('box: each startRun refusal and a throw give the §2.4 note, the text kept', async () => {
  const cases = [
    [() => ({ started: false, reason: 'not-reviewed' }), 'Could not start foo in repo: it is not reviewed'],
    [() => ({ started: false, reason: 'no-plan' }), 'Could not start foo in repo: there is no such plan'],
    [() => ({ started: false, reason: 'no-test-block' }), 'Could not start foo in repo: no setup/test block'],
    [() => ({ started: false, reason: 'weird' }), 'Could not start foo in repo: weird'],
    [() => { throw new Error('spawn failed'); }, 'Could not start foo in repo: spawn failed'],
  ];
  for (const [build, note] of cases) {
    const t = driveStart({ build });
    await t.type('repo/start foo');
    await t.key('\r');
    await t.key('\r');
    assert.equal(t.starts.length, 1);
    assert.ok(t.screen().includes(note), `${note}\n${t.screen()}`);
    assert.match(t.boxLine(), /^@repo\/start foo/, 'the text is kept');
    await t.key('\x1b');
    await t.quit();
  }
});

test('box: `@repo/plan a brief` still calls startPlan only; `@repo a brief` and an unknown slug call neither', async () => {
  const p = driveStart();
  await p.type('repo/plan a brief');
  await p.key('\r');
  assert.equal(p.plans.length, 1);
  assert.equal(p.plans[0].brief, 'a brief');
  assert.equal(p.plans[0].opts.cwd, '/scratch/src/repo');
  assert.equal(p.starts.length, 0);
  assert.deepEqual(p.scanned, [], 'a brief never pays for the plan scan');
  assert.match(p.screen(), /starting the planner…/);
  await p.quit();

  for (const [typed, note] of [['repo a brief', 'pick a command: @repo/plan or @repo/start'], ['repo/start nope', 'nope is not a reviewed, unfinished plan in repo']]) {
    const t = driveStart();
    await t.type(typed);
    await t.key('\r');
    assert.equal(t.plans.length + t.starts.length, 0, `${typed}: nothing started`);
    assert.ok(t.screen().includes(note), `${typed}: ${t.screen()}`);
    assert.ok(t.boxLine().startsWith('@' + typed), 'the text is kept');
    await t.key('\x1b');
    await t.quit();
  }
});

test('box: two repos with the same slug: the landing opens the one in the chosen repo', async () => {
  const t = driveStart({ rows: () => [buildRow('repo', 'foo'), buildRow('other', 'foo')] });
  await t.type('other/start foo');
  await t.key('\r');
  await t.key('\r');
  assert.equal(t.starts[0].opts.cwd, '/scratch/other/other');
  assert.match(t.screen(), /^foo {2}● running {2}· other/m);
  assert.doesNotMatch(t.screen(), /· repo/);
  await t.quit();
});

test('box: the slug pop-up says · building for the build running in that repo only', async () => {
  const t = driveStart({ rows: () => [buildRow('repo', 'foo')] });
  await t.type('repo/start ');
  assert.match(t.screen(), /→ foo +0\/3 done · building/);
  await t.key('\x1b');
  await t.key('\x1b');
  await t.type('other/start ');
  assert.match(t.screen(), /foo +1\/2 done/);
  assert.doesNotMatch(t.screen(), /building/);
  await t.key('\x1b'); // closes the pop-up
  await t.key('\x1b'); // resets the box
  await t.quit();
});

test('isBuilding: a running build of that slug in that repo; not another repo, not a planning run, not a stopped build', () => {
  const repo = { name: 'repo', path: '/scratch/src/repo' };
  assert.equal(isBuilding([buildRow('repo', 'foo')], repo, 'foo'), true);
  assert.equal(isBuilding([buildRow('other', 'foo')], repo, 'foo'), false, 'same slug, another repo');
  assert.equal(isBuilding([buildRow('repo', 'foo', { kind: 'plan' })], repo, 'foo'), false, 'a planning run');
  assert.equal(isBuilding([buildRow('repo', 'foo', { state: 'stopped' })], repo, 'foo'), false, 'not running');
  assert.equal(isBuilding([buildRow('repo', 'bar')], repo, 'foo'), false, 'another slug');
  assert.equal(isBuilding([], repo, 'foo'), false);
});

// --- row hits (mouse-navigation T02, DESIGN §3.3) ---------------------------------------------------

// Every line's hit, as [lineIndex, hit] pairs, so a test states exactly which lines are rows.
const hitsOf = (frame) => frame.flatMap((l, y) => (l.hit ? [[y, l.hit]] : []));
const lineWith = (frame, substr) => frame.findIndex((l) => l.map((s) => s.text).join('').includes(substr));

test('list, no box: each run row carries its index; title, header, counts and footer carry none', () => {
  const frame = buildListFrame(buildDashboard(VIEWS), initialUi());
  const dash = buildDashboard(VIEWS);
  const hits = hitsOf(frame);
  assert.equal(hits.length, VIEWS.length);
  for (const [y, hit] of hits) {
    assert.equal(hit.kind, 'run');
    assert.ok(frameText([frame[y]]).includes(dash.rows[hit.index].slug), `line ${y} paints row ${hit.index}`);
  }
  for (const s of ['runs on this machine', 'SLUG', '4 runs', 'esc quit']) assert.equal(frame[lineWith(frame, s)].hit, undefined, s);
  assert.equal(hitAt(frame, lineWith(frame, 'SLUG')), null);
  assert.deepEqual(hitAt(frame, hits[0][0]), { kind: 'run', index: 0 });
  // The hit is not enumerable, so a whole-frame deepEqual against plain arrays still holds.
  assert.deepEqual(Object.keys(frame[hits[0][0]]), frame[hits[0][0]].map((_, i) => String(i)));
});

test('list windowed by a budget: visible rows carry their true indices, markers and spacers none', () => {
  const dash = buildDashboard(manyViews(20));
  const frame = buildListFrame(dash, { ...initialUi(), sel: 10 }, { rows: 8 });
  const hits = hitsOf(frame);
  assert.ok(hits.length > 0);
  for (const [y, hit] of hits) {
    assert.equal(hit.kind, 'run');
    assert.match(frameText([frame[y]]), new RegExp(`run-${String(hit.index).padStart(2, '0')}`), `line ${y} carries its true index`);
  }
  const indices = hits.map(([, h]) => h.index);
  assert.ok(indices.includes(10), 'the selected row is hit-tagged');
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b).map((_, i) => indices[0] + i), 'consecutive rows');
  for (const m of ['↑', '↓']) {
    const y = lineWith(frame, `${m} `);
    assert.ok(y >= 0, `the ${m} marker shows`);
    assert.equal(hitAt(frame, y), null);
  }
  assert.equal(hitAt(frame, lineWith(frame, '20 runs')), null);
});

test('an empty list has no hit, in either form', () => {
  assert.deepEqual(hitsOf(buildListFrame(buildDashboard([]), initialUi())), []);
  assert.deepEqual(hitsOf(buildListFrame(buildDashboard([]), initialUi(), { rows: 8 })), []);
});

test('a list with a ready-to-merge row (wider columns) still tags every run row', () => {
  const views = [
    { slug: 'done-run', state: 'running', repo: 'r', progress: { done: 2, total: 2 }, workers: 0, snap: { runState: { tasks: [], handoff: { state: 'ready' } } } },
    ...VIEWS,
  ];
  const dash = buildDashboard(views);
  assert.ok(dash.rows.some((v) => v.display === 'ready-to-merge'), 'the fixture reads ready-to-merge');
  const hits = hitsOf(buildListFrame(dash, initialUi()));
  assert.deepEqual(hits.map(([, h]) => h.index), dash.rows.map((_, i) => i));
});

test('live view: task i carries { task, i }; summary, stale note and log tail carry none; the bar keeps its hit', () => {
  const run = tasksRun(T12_TASKS, { state: 'crashed', record: { repo: 'repo', slug: 'plan', controlDir: '/c' } });
  const frame = buildWatchFrame(run, { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 1 }, logTail: ['boom'] });
  const hits = hitsOf(frame);
  assert.deepEqual(hits.map(([, h]) => h), T12_TASKS.map((_, i) => ({ kind: 'task', index: i })));
  T12_TASKS.forEach((t, i) => assert.match(frameText([frame[hits[i][0]]]), new RegExp(t.id)));
  const [selY] = hits[1];
  assert.equal(frame[selY][0].text, '▎ ', 'the selected row keeps its bar');
  assert.equal(frame[selY][0].style, 'selected');
  assert.equal(hitAt(frame, 2), null, 'the summary line');
  for (const s of ['this frame is stale', 'last lines of run.log', 'boom', 'full log']) assert.equal(hitAt(frame, lineWith(frame, s)), null, s);
});

test('live view with the coordinator agent and a helper: the separator has no hit, the agent and helper rows do', () => {
  const runState = {
    branch: 'pir/plan',
    ceiling: 2,
    tasks: T12_TASKS,
    coordinator: { id: 's', live: true, logPath: null, state: 'up', holding: 0 },
    helpers: [{ id: 'tests-fix', slug: 'fix-red-tests', helper: true, deps: [], done: false, phase: 'building', since: NOW - 3000, worker: { id: 'w-fix', live: true } }],
  };
  const run = tasksRun(T12_TASKS, { snap: { runState } });
  const frame = buildWatchFrame(run, { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 0 } });
  // Entries: T01 T02 T03, separator (3), agent (4), tests-fix (5). Block line i+1 is entry i, block starts at 2.
  const hits = hitsOf(frame);
  assert.deepEqual(hits.map(([, h]) => h.index), [0, 1, 2, 4, 5]);
  assert.equal(hitAt(frame, 2 + 1 + 3), null, 'the separator line');
  assert.match(frameText([frame[2 + 1 + 4]]), /coordinator agent/);
  assert.deepEqual(hitAt(frame, 2 + 1 + 4), { kind: 'task', index: 4 });
  assert.match(frameText([frame[2 + 1 + 5]]), /tests-fix/);
  assert.deepEqual(hitAt(frame, 2 + 1 + 5), { kind: 'task', index: 5 });
});

test('planning steps view: step i carries { step, i }; the go question and its keys carry none', () => {
  const running = stepsRun({
    state: 'running', outcome: null, step: 'plan',
    steps: [
      { id: 'plan', phase: 'asking', since: NOW - 60_000, stoppedAt: NOW - 20_000, asking: 'questions', worker: { id: 'p1', live: true } },
      { id: 'review', phase: 'pending', worker: null },
      { id: 'build', phase: 'pending', worker: null },
    ],
  });
  for (const [frame, what] of [
    [buildWatchFrame(running, { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 0 } }), 'without the go'],
    [buildWatchFrame(stepsRun(), { now: NOW, ui: { ...initialUi(), view: 'watch', taskSel: 2 }, progress: PROGRESS_3 }), 'with the go'],
  ]) {
    const hits = hitsOf(frame);
    assert.deepEqual(hits.map(([, h]) => h), [0, 1, 2].map((index) => ({ kind: 'step', index })), what);
    ['plan', 'review', 'build'].forEach((id, i) => assert.match(frameText([frame[hits[i][0]]]), new RegExp(id), what));
  }
  const go = buildWatchFrame(stepsRun(), { now: NOW, ui: { ...initialUi(), view: 'watch' }, progress: PROGRESS_3 });
  for (const s of ['Start the parallel build now?', '↵ Start the build', '↵ start · n not now']) assert.equal(hitAt(go, lineWith(go, s)), null, s);
});

test('hitAt: null for a negative y, a y past the end, a non-integer y, and a line without a hit', () => {
  const frame = buildListFrame(buildDashboard(VIEWS), initialUi());
  assert.equal(hitAt(frame, -1), null);
  assert.equal(hitAt(frame, frame.length), null);
  assert.equal(hitAt(frame, 1.5), null);
  assert.equal(hitAt(frame, 0), null);
  assert.equal(hitAt(null, 0), null);
});

// --- the mouse (mouse-navigation T04, DESIGN §2.2, §2.5, §2.7, §3.2) ----------------------------------

// A process stand-in for the exit restore: an emitter whose exit() is recorded instead of ending the tests.
function fakeProcess() {
  const p = new EventEmitter();
  p.exits = [];
  p.exit = (code) => p.exits.push(code);
  return p;
}

// A TTY screen over the fake terminal with every outside effect injected: no clipboard, no real env, no
// real process listeners. `copies` collects what the screen asked to copy.
function mouseScreen({ env = {}, columns = 40, rows = 6, platform = 'darwin' } = {}) {
  const tty = fakeStream({ isTTY: true, columns, rows });
  const term = fakeTerminal(tty);
  const proc = fakeProcess();
  const copies = [];
  const screen = createScreen({
    stream: tty,
    colour: false,
    terminal: term,
    env,
    onExit: proc,
    platform,
    copy: async (text) => {
      copies.push(text);
      return true;
    },
  });
  return { tty, term, proc, copies, screen };
}

const MOUSE_OFF = '\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l';
const sgr = (code, col, row, end = 'M') => `\x1b[<${code};${col};${row}${end}`; // 1-based, as a terminal sends
const flush = () => new Promise((r) => setImmediate(r));
// The layout root pi-tui dispatches mouse events to (createScreen's `guarded`), read off pi-tui's own field.
const rootOf = (screen) => screen.host.layoutRoot;

test('mouse: the screen starts with mouse reporting on, all-motion included', (t) => {
  if (underMultiplexer(process.env)) return t.skip('pi-tui reads the real env; this shell is under a multiplexer');
  const { tty, screen } = mouseScreen();
  screen.paint([[{ text: 'row', style: null }]]);
  const out = tty.text();
  for (const m of [1000, 1002, 1003, 1004, 1006]) assert.ok(out.includes(`\x1b[?${m}h`), `?${m}h is written`);
  screen.close();
});

test('mouse: under a multiplexer, ?1003h is written again after pi-tui\'s button-motion enable', () => {
  for (const env of [{ TMUX: '/tmp/tmux-1/default,1,0' }, { STY: '1.tty' }, { ZELLIJ: '0' }, { TERM: 'tmux-256color' }, { TERM: 'screen' }]) {
    const { tty, screen } = mouseScreen({ env });
    screen.paint([[{ text: 'row', style: null }]]);
    const out = tty.text();
    const buttonMotion = out.indexOf('\x1b[?1002h');
    assert.ok(buttonMotion >= 0, `${JSON.stringify(env)}: pi-tui enabled button motion`);
    assert.ok(out.indexOf('\x1b[?1003h', buttonMotion) > buttonMotion, `${JSON.stringify(env)}: ?1003h follows it`);
    screen.close();
  }
  assert.equal(underMultiplexer({ TERM: 'xterm-256color' }), false);
  assert.equal(underMultiplexer({}), false);
});

test('mouse: a drag across two lines then release copies that text through the injected copy', async () => {
  const { term, copies, screen } = mouseScreen();
  screen.listen(() => {}, (e) => assert.fail(e));
  screen.paint([[{ text: 'alpha line', style: null }], [{ text: 'beta line', style: null }]]);
  term.press(sgr(0, 1, 1)); // press on "a" of alpha
  term.press(sgr(32, 3, 2)); // drag to row 2, column 3
  term.press(sgr(0, 4, 2, 'm')); // release on "a" of beta
  await flush();
  assert.deepEqual(copies, ['alpha line\nbeta'], 'the selected text reached copy');
  screen.close();
});

test('mouse: off macOS the copy function is not used (pi-tui keeps its OSC 52)', async () => {
  const { tty, term, copies, screen } = mouseScreen({ platform: 'linux' });
  screen.listen(() => {}, (e) => assert.fail(e));
  screen.paint([[{ text: 'alpha line', style: null }]]);
  term.press(sgr(0, 1, 1));
  term.press(sgr(32, 5, 1));
  term.press(sgr(0, 5, 1, 'm'));
  await flush();
  assert.deepEqual(copies, []);
  assert.ok(tty.text().includes('\x1b]52;c;'), 'OSC 52 carries the selection instead');
  screen.close();
});

test('mouse: a press and release in place with no handler copies nothing and throws nothing', async () => {
  const { term, copies, screen } = mouseScreen();
  const errors = [];
  screen.listen(() => {}, (e) => errors.push(e));
  screen.paint([[{ text: 'alpha line', style: null }]]);
  term.press(sgr(0, 2, 1));
  term.press(sgr(0, 2, 1, 'm'));
  await flush();
  assert.deepEqual(copies, []);
  assert.deepEqual(errors, []);
  screen.close();
});

test('mouse: the root forwards to the mounted component when one is mounted, to onMouse otherwise, and returns their result', () => {
  const { term, screen } = mouseScreen();
  const seen = [];
  screen.listen(() => {}, () => {}, (ev) => (seen.push(['frame', ev.type, ev.x, ev.y]), { handled: true, render: false }));
  screen.paint([[{ text: 'row', style: null }]]);
  term.press(sgr(35, 3, 2)); // a hover move at column 3, row 2
  assert.deepEqual(seen, [['frame', 'move', 2, 1]], 'a painted frame\'s move reaches onMouse, zero-based');

  const component = { render: () => ['mounted'], invalidate() {}, handleMouse: (ev) => (seen.push(['mounted', ev.type]), { handled: true, render: false }) };
  screen.mount(component);
  screen.renderNow();
  term.press(sgr(65, 1, 1)); // wheel down
  assert.deepEqual(seen.at(-1), ['mounted', 'wheel'], 'a mounted component takes the event, onMouse does not');
  assert.equal(seen.filter(([w]) => w === 'frame').length, 1);
});

test('mouse: the root\'s handleMouse returns the handler\'s own result, and points a focus request at the mounted component', () => {
  const { screen } = mouseScreen();
  screen.listen(() => {}, () => {}, () => 'from-onMouse');
  screen.paint([[{ text: 'row', style: null }]]);
  const ev = { type: 'click', button: 'left', x: 1, y: 0, screenX: 1, screenY: 0, width: 40, height: 6 };
  const guarded = rootOf(screen);
  assert.equal(guarded.handleMouse(ev), 'from-onMouse', 'with nothing mounted, onMouse\'s result comes back');

  const plain = { handled: true };
  const comp = { render: () => ['x'], invalidate() {}, handleMouse: () => plain };
  screen.mount(comp);
  assert.equal(guarded.handleMouse(ev), plain, 'a mounted handler\'s result comes back as is');

  comp.handleMouse = () => ({ handled: true, focus: true });
  const r = guarded.handleMouse(ev);
  assert.equal(r.focusTarget, comp, 'a focus request is pointed at the mounted component, not the root');
  assert.equal(r.target.component, guarded);
  assert.deepEqual([r.target.originX, r.target.originY, r.target.width, r.target.height], [0, 0, 40, 6]);

  comp.handleMouse = () => undefined;
  assert.equal(guarded.handleMouse(ev), undefined, 'a declining handler stays undefined, leaving pi-tui its selection');
  delete comp.handleMouse;
  assert.equal(guarded.handleMouse(ev), undefined, 'a component with no handler declines');
  screen.close();
});

test('mouse: a handler that returns undefined for press keeps selection working, and the click still reaches it', async () => {
  const { term, copies, screen } = mouseScreen();
  const types = [];
  screen.listen(() => {}, () => {}, (ev) => {
    types.push(ev.type);
    return ev.type === 'click' ? { handled: true } : undefined;
  });
  screen.paint([[{ text: 'alpha line', style: null }], [{ text: 'beta line', style: null }]]);
  term.press(sgr(0, 1, 1));
  term.press(sgr(32, 5, 1));
  term.press(sgr(0, 5, 1, 'm'));
  await flush();
  assert.deepEqual(copies, ['alpha'], 'the drag still copied (the release cell is included)');
  assert.ok(!types.includes('click'), 'a drag is not a click');
  term.press(sgr(0, 2, 2));
  term.press(sgr(0, 2, 2, 'm'));
  await flush();
  assert.equal(types.filter((x) => x === 'click').length, 1, 'a press and release in place is a click');
  assert.deepEqual(copies, ['alpha'], 'and copies nothing');
  screen.close();
});

// T08 drill: a double click on a row whose first click left the screen unchanged (a task with no worker)
// became pi-tui's word selection, flashed `Copied!` and replaced the clipboard. A click the handler marks
// `rowClick` resets pi-tui's double-click count, so the second is a click too (§2.1); an unmarked handled
// click keeps pi-tui's word selection, which is what the control half shows.
test('mouse: a double click on a row is two clicks and copies nothing; unmarked, the second is a word copy', async () => {
  for (const [rowClick, clicks, copied] of [[true, 2, []], [false, 1, ['alpha']]]) {
    const { term, copies, screen } = mouseScreen();
    let n = 0;
    screen.listen(() => {}, () => {}, (ev) => {
      if (ev.type !== 'click') return undefined;
      n++;
      return rowClick ? { handled: true, rowClick: true } : { handled: true };
    });
    screen.paint([[{ text: 'alpha line', style: null }]]);
    for (let i = 0; i < 2; i++) {
      term.press(sgr(0, 2, 1));
      term.press(sgr(0, 2, 1, 'm'));
      await flush();
    }
    assert.equal(n, clicks, `rowClick ${rowClick}: clicks delivered`);
    assert.deepEqual(copies, copied, `rowClick ${rowClick}: what was copied`);
    screen.close();
  }
});

test('mouse: process exit writes the mouse-off restore once; after close() nothing is written', () => {
  const { tty, proc, screen } = mouseScreen();
  proc.emit('exit', 0);
  assert.equal(tty.text(), '', 'a screen never started restores nothing');
  screen.paint([[{ text: 'row', style: null }]]);
  const before = tty.text().length;
  proc.emit('exit', 0);
  proc.emit('exit', 0);
  const written = tty.text().slice(before);
  assert.equal(written, `${MOUSE_OFF}\x1b[?2004l\x1b[?7h\x1b[?1049l\x1b[?25h`, 'mouse off, bracketed paste off, autowrap on, alternate screen left, cursor shown');
  assert.deepEqual(proc.exits, [], 'an exit listener does not call exit itself');

  const other = mouseScreen();
  other.screen.paint([[{ text: 'row', style: null }]]);
  other.screen.close();
  const after = other.tty.text().length;
  other.proc.emit('exit', 0);
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) other.proc.emit(sig, sig);
  assert.equal(other.tty.text().length, after, 'nothing is written after close');
  assert.deepEqual(other.proc.exits, []);
  for (const ev of ['exit', 'SIGTERM', 'SIGHUP', 'SIGINT']) assert.equal(other.proc.listenerCount(ev), 0, `the ${ev} handler is removed on close`);
});

test('mouse: SIGTERM, SIGHUP and SIGINT restore the terminal and exit 128 + the signal number', () => {
  for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]]) {
    const { tty, proc, screen } = mouseScreen();
    screen.paint([[{ text: 'row', style: null }]]);
    const before = tty.text().length;
    proc.emit(sig, sig);
    assert.ok(tty.text().slice(before).startsWith(MOUSE_OFF), `${sig}: the mouse is turned off`);
    assert.deepEqual(proc.exits, [code], `${sig}: exits ${code}`);
  }
});

// T04 review: pbcopy reads its stdin by the locale, so a shell with no UTF-8 locale garbled non-ASCII text.
test('defaultCopy: runs pbcopy with the text on stdin and a UTF-8 locale forced, and reports a failure as its message', async () => {
  const calls = [];
  const fakeRun = (fail) => (cmd, args, opts, cb) => {
    const stdin = new EventEmitter();
    stdin.end = (text) => {
      calls.push({ cmd, args, env: opts.env, text });
      setImmediate(() => cb(fail ? new Error('spawn pbcopy ENOENT') : null));
    };
    return { stdin };
  };
  const ok = await defaultCopy('é ⠋ ✅', { run: fakeRun(false), env: { LANG: 'C', LC_ALL: 'C', HOME: '/h' } });
  assert.equal(ok, true);
  assert.deepEqual(calls[0], { cmd: 'pbcopy', args: [], env: { LANG: 'C', LC_ALL: 'en_US.UTF-8', HOME: '/h' }, text: 'é ⠋ ✅' });
  assert.equal(await defaultCopy('x', { run: fakeRun(true), env: {} }), 'Copy failed: spawn pbcopy ENOENT');
});

// --- clicks, hover and the wheel on the lists (mouse-navigation T05, DESIGN §2.1–§2.4, §2.6, §3.2, §3.5) ---

// runTui on the pi-tui screen over the fake terminal, with every outside effect injected. `rows()` is re-read
// on every refresh, key and mouse event. The mouse is sent as the SGR bytes a terminal sends, one sequence per
// input call as pi-tui's own stdin splitter would hand them over.
function driveMouse({ rows, columns = 100, height = 30, colour = false, extra = {} } = {}) {
  const tty = fakeStream({ isTTY: true, columns, rows: height });
  const term = fakeTerminal(tty);
  const proc = fakeProcess();
  const opened = [];
  const done = openDashboard({
    stdin: {},
    stdout: tty,
    env: BOX_ENV,
    refreshMs: 60_000,
    now: () => NOW,
    makeScreen: (opts) => createScreen({ ...opts, colour, terminal: term, env: {}, onExit: proc, copy: async () => true }),
    load: () => buildDashboard(rows()),
    scan: () => BOX_REPOS,
    startPlan: () => ({ started: true, runId: 'plan-ab12', record: { repo: 'repo' } }),
    follow: (p, { onEntries }) => {
      opened.push(p);
      onEntries([JSON.stringify({ t: 1, dir: 'out', from: 'pir', kind: 'message', text: `Log ${p}.` })]);
      return { stop() {} };
    },
    drop: () => ({ ok: true }),
    ...extra,
  });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const screen = () => drawnRows(tty.text());
  const text = () => screen().join('\n');
  const rowY = (re) => {
    const y = screen().findIndex((l) => re.test(l));
    assert.ok(y >= 0, `${re} is on screen:\n${text()}`);
    return y;
  };
  const send = async (...seqs) => {
    for (const s of seqs) term.press(s);
    await settle();
  };
  // 1-based column and row, as the terminal counts them; y is the 0-based screen row.
  const click = (y, x = 6) => send(sgr(0, x, y + 1), sgr(0, x, y + 1, 'm'));
  const clickOn = (re, x) => click(rowY(re), x);
  const move = (y, x = 6) => send(sgr(35, x, y + 1));
  const wheel = (y, dir) => send(sgr(dir === 'up' ? 64 : 65, 6, y + 1));
  const sel = () => screen().find((l) => l.startsWith('▎')) ?? '';
  // Out of a conversation (← steps out; Esc is the conversation's), then Esc until pir has quit.
  const quit = async () => {
    for (let i = 0; i < 4 && term.onInput; i++) await send('\x1b[D', '\x1b');
    assert.equal(term.onInput, null, `pir quit:\n${text()}`);
    await done;
  };
  // Which screen rows have bold cells, read by the pty rig's screen model from everything written.
  const boldRows = () => {
    const m = createScreenModel({ rows: height, cols: columns });
    m.write(tty.text());
    return m.rows().map((l, y) => [...l].some((_, x) => m.boldAt(y, x)) ? y : -1).filter((y) => y >= 0);
  };
  return { tty, term, done, send, click, clickOn, move, wheel, screen, text, rowY, sel, quit, opened, boldRows, settle };
}

const runRow = (slug, over = {}) => ({ key: `r__${slug}`, slug, repo: 'r', state: 'finished', progress: { done: 1, total: 1 }, workers: 0, record: { repo: 'r', slug }, ...over });
const THREE_RUNS = [runRow('alpha'), runRow('beta'), runRow('gamma')];

test('mouse: a click on run row i opens run i; ← comes back to the list with row i selected', async () => {
  const t = driveMouse({ rows: () => [...THREE_RUNS, tasksRun(T12_TASKS, { key: 'r__plan', repo: 'r' })] });
  await t.clickOn(/^ {2}beta /);
  assert.match(t.text(), /^beta/m, "beta's live view");
  assert.doesNotMatch(t.text(), /^new  /m, 'the list is gone');
  await t.send('\x1b[D');
  assert.match(t.sel(), /^▎ beta /, 'back on the list, beta selected');
  await t.clickOn(/^ {2}plan /);
  assert.match(t.sel(), /T01/, 'the build opens on its first task, as Enter does');
  await t.quit();
});

test('mouse: a click on the title, the header, a `↑ n more` marker, the counts line or the hint line changes nothing', async () => {
  const many = Array.from({ length: 9 }, (_, i) => runRow(`run-${i}`));
  const t = driveMouse({ rows: () => many, height: 14 });
  for (let i = 0; i < 6; i++) await t.send('\x1b[B');
  const before = t.screen();
  assert.ok(before.some((l) => /↑ \d+ more/.test(l)), `a marker shows:\n${before.join('\n')}`);
  for (const re of [/^pir {2}runs/, /^ {2}SLUG/, /↑ \d+ more/, /↓ \d+ more/, /^9 runs · /, /^↑↓/]) {
    if (!t.screen().some((l) => re.test(l))) continue; // the title may be cut at this height
    await t.clickOn(re);
    assert.deepEqual(t.screen(), before, `${re}: nothing changed`);
  }
  await t.quit();
});

test('mouse: a click on a task with a worker opens its conversation; without one, the no-worker note', async () => {
  const t = driveMouse({ rows: () => [tasksRun(T12_TASKS)] });
  await t.send('\r');
  await t.clickOn(/T03 /);
  assert.match(t.sel(), /T03/, 'the click selected T03');
  assert.match(t.text(), /T03 has no worker yet — it starts when T02 is merged\./);
  await t.clickOn(/T02 /);
  assert.match(t.text(), /pir ▸ Log \/c\/w2\.jsonl\./, "T02's conversation");
  await t.send('\x1b[D');
  assert.match(t.sel(), /T02/, '← lands on the clicked task');
  await t.quit();
});

const AGENT_STATE = (over = {}) => ({
  branch: 'pir/plan',
  ceiling: 2,
  tasks: T12_TASKS,
  coordinator: { id: 'agent-1', live: true, logPath: '/c/agent.jsonl', state: 'up', holding: 0 },
  ...over,
});

test("mouse: a click on the coordinator agent's row opens its conversation as `c` does; the separator neither clicks nor hovers", async () => {
  const rows = () => [tasksRun(T12_TASKS, { snap: { runState: AGENT_STATE() } })];
  const lit = driveMouse({ rows, colour: true });
  await lit.send('\r');
  const agentY = lit.rowY(/◆ coordinator agent/);
  await lit.move(agentY);
  assert.ok(lit.boldRows().includes(agentY), "the agent's row hovers");
  await lit.move(lit.rowY(/^ {2}─{10,}/));
  assert.ok(!lit.boldRows().includes(lit.rowY(/^ {2}─{10,}/)), 'the separator never hovers');
  await lit.quit();

  const t = driveMouse({ rows });
  await t.send('\r');
  const before = t.screen();
  await t.click(t.rowY(/^ {2}─{10,}/));
  assert.deepEqual(t.screen(), before, 'a click on the separator does nothing');
  await t.clickOn(/◆ coordinator agent/);
  assert.match(t.text(), /pir ▸ Log \/c\/agent\.jsonl\./, "the agent's conversation");
  await t.send('\x1b[D');
  assert.match(t.sel(), /coordinator agent/, '← comes back with the agent row selected');
  await t.quit();
});

test('mouse: the wheel over the live view steps over the separator exactly as ↑/↓ do', async () => {
  const t = driveMouse({ rows: () => [tasksRun(T12_TASKS, { snap: { runState: AGENT_STATE() } })] });
  await t.send('\r');
  await t.send('\x1b[B', '\x1b[B');
  assert.match(t.sel(), /T03/);
  await t.wheel(0, 'down');
  assert.match(t.sel(), /coordinator agent/, 'one notch down from T03 lands on the agent, past the separator');
  await t.wheel(20, 'up');
  assert.match(t.sel(), /T03/, 'one notch up, wherever the pointer is, comes back over it');
  await t.quit();
});

test('mouse: a click on a step row under the go question opens the step and does not start the build', async () => {
  const started = [];
  const t = driveMouse({
    rows: () => [stepsRun()],
    extra: { readProgress: () => PROGRESS_3, start: async (slug) => (started.push(slug), { started: true }) },
  });
  await t.send('\r');
  assert.match(t.text(), /Start the parallel build now\?/);
  await t.clickOn(/^[▎ ] . review /);
  assert.deepEqual(started, [], 'no build started');
  assert.match(t.text(), /pir ▸ Log \/c\/review-1\.ndjson\./, "the review step's conversation");
  await t.quit();
});

test('mouse: a click cancels an armed Ctrl+S; a pointer move does not', async () => {
  const stopped = [];
  const running = THREE_RUNS.map((r) => ({ ...r, state: 'running' }));
  const t = driveMouse({ rows: () => running, extra: { stop: async (record) => stopped.push(record.slug) } });
  await t.send('\x13');
  assert.match(t.text(), /Ctrl\+S again to stop alpha/);
  await t.move(t.rowY(/^ {2}beta /));
  assert.match(t.text(), /Ctrl\+S again to stop alpha/, 'a move keeps it armed');
  await t.clickOn(/^ {2}gamma /);
  await t.send('\x1b[D');
  assert.doesNotMatch(t.text(), /⚠/, 'the click disarmed it');
  await t.send('\x13');
  assert.deepEqual(stopped, [], 'the next Ctrl+S only arms again');
  assert.match(t.text(), /Ctrl\+S again to stop gamma/);
  await t.quit();
});

test('mouse: hover lights the row under the pointer only; a move within that row does not repaint', async () => {
  const t = driveMouse({ rows: () => THREE_RUNS, colour: true });
  const alphaY = t.rowY(/^ {2}alpha /); // the selected row: with colour its ▎ is blanked into the band
  const betaY = t.rowY(/^ {2}beta /);
  const gammaY = t.rowY(/^ {2}gamma /);
  assert.deepEqual(t.boldRows().filter((y) => y >= betaY && y <= gammaY), [], 'nothing hovered yet');
  await t.move(betaY);
  assert.ok(t.boldRows().includes(betaY), 'beta hovered');
  const written = t.tty.text().length;
  await t.move(betaY, 20);
  assert.equal(t.tty.text().length, written, 'a move along the same row paints nothing');
  await t.move(gammaY);
  const bold = t.boldRows();
  assert.ok(bold.includes(gammaY) && !bold.includes(betaY), `gamma hovered, beta not (${bold})`);
  await t.move(alphaY);
  assert.ok(!t.boldRows().includes(gammaY), 'the selected row shows as its band; gamma is no longer lit');
  await t.quit();
});

test('mouse: the wheel moves the list and the live view one row a notch, and does nothing on the landing screen', async () => {
  const t = driveMouse({ rows: () => [...THREE_RUNS, tasksRun(T12_TASKS, { key: 'r__plan', repo: 'r' })] });
  await t.wheel(3, 'down');
  await t.wheel(3, 'down');
  assert.match(t.sel(), /^▎ gamma /, 'list: two notches, two rows');
  await t.wheel(3, 'down');
  await t.send('\r');
  await t.wheel(3, 'down');
  await t.wheel(3, 'down');
  assert.match(t.sel(), /T03/, 'live view: taskSel +2');
  await t.quit();

  const l = driveMouse({ rows: () => [] });
  await l.send(...'repo/plan a brief');
  await l.send('\r');
  const landing = l.screen();
  assert.ok(landing.some((x) => /starting the planner…/.test(x)));
  await l.wheel(2, 'down');
  await l.click(2);
  assert.deepEqual(l.screen(), landing, 'the landing screen takes no mouse');
  await l.quit();
});

test('mouse: a click in the box moves its caret; a click on a pop-up entry picks it', async () => {
  const t = driveMouse({ rows: () => THREE_RUNS });
  await t.send(...'repo abc');
  const head = t.rowY(/^new  /);
  await t.click(head + 2, 2); // column 2: just after the @
  await t.send('Z');
  assert.match(t.screen()[head + 2], /^@Zrepo abc/, 'typed where the click put the caret');

  const p = driveMouse({ rows: () => THREE_RUNS });
  await p.send('p');
  await p.settle();
  const entry = p.rowY(/@dup +~\/src\/dup/);
  await p.click(entry, 8);
  const h = p.rowY(/^new  /);
  assert.match(p.screen()[h + 2], /^@dup\//, 'the clicked entry replaced @p');
  await t.quit();
  await p.quit();
});

test('mouse: with a brief typed, a click opens a run, and ← comes back to the brief still in the box', async () => {
  const t = driveMouse({ rows: () => THREE_RUNS });
  await t.send(...'repo half a brief');
  await t.clickOn(/^ {2}beta /);
  assert.match(t.text(), /^beta/m);
  await t.send('\x1b[D');
  const head = t.rowY(/^new  /);
  assert.match(t.screen()[head + 2], /^@repo half a brief/);
  assert.match(t.sel(), /^▎ beta /);
  await t.quit();
});

test('mouse: a double click on a run opens it, then opens the live-view row now under the pointer (§2.1)', async () => {
  const t = driveMouse({ rows: () => [runRow('alpha'), tasksRun(T12_TASKS, { key: 'r__plan', repo: 'r' })] });
  const y = t.rowY(/^ {2}plan /);
  await t.send(sgr(0, 6, y + 1), sgr(0, 6, y + 1, 'm'), sgr(0, 6, y + 1), sgr(0, 6, y + 1, 'm'));
  // The first click opened the run; the second landed on the live view's line at that row, T02, and opened it.
  assert.match(t.text(), /pir ▸ Log \/c\/w2\.jsonl\./, "T02's conversation, opened by the second click");
  await t.send('\x1b[D');
  assert.match(t.sel(), /T02/);
  await t.quit();
});

test('mouse: a right or middle click on a row does nothing, and a drag starting on a row does not open it', async () => {
  const t = driveMouse({ rows: () => THREE_RUNS });
  const y = t.rowY(/^ {2}beta /);
  const before = t.screen();
  await t.send(sgr(2, 6, y + 1), sgr(2, 6, y + 1, 'm'));
  await t.send(sgr(1, 6, y + 1), sgr(1, 6, y + 1, 'm'));
  await t.send(sgr(0, 6, y + 1), sgr(32, 12, y + 1), sgr(0, 12, y + 1, 'm'));
  assert.match(t.text(), /^new  /m, 'still the list');
  assert.match(t.sel(), /^▎ alpha /, 'the selection did not move');
  assert.deepEqual(t.screen().slice(1, y + 1), before.slice(1, y + 1), 'the rows are as they were');
  assert.match(t.screen()[0], /Copied!/, 'the drag was a text selection, and copied');
  await t.quit();
});

test('mouse: a click opens the run painted on that row even if a fresh read has reordered or dropped the rows', async () => {
  let rows = THREE_RUNS;
  const t = driveMouse({ rows: () => rows });
  const betaY = t.rowY(/^ {2}beta /);
  const gammaY = t.rowY(/^ {2}gamma /);
  // The next read (the click's) sees a different list: beta has moved up and gamma is gone. Nothing repaints
  // before the click, so the screen still shows the old order.
  rows = [THREE_RUNS[1], THREE_RUNS[0]];
  await t.click(gammaY);
  assert.match(t.text(), /^new  /m, 'a click on a run that is gone opens nothing');
  await t.click(betaY);
  assert.match(t.text(), /^beta/m, 'beta opened, not whatever now sits at its old index');
  await t.quit();
});

// The finisher (finisher DESIGN §2.11, T07): the list row reads `● ready for your go` amber bold, whole,
// counted as waiting; the live view's hint offers `c finisher`.
test('the list frame: a run whose finisher waits for the go reads `● ready for your go` amber bold and counts as waiting (T07)', () => {
  const finisher = { id: 'f', logPath: '/c/f.ndjson', state: 'awaiting-go', phase: 'awaiting-go', asking: true };
  const ready = { key: 'shop__checkout', slug: 'checkout', state: 'running', repo: 'shop', progress: { done: 4, total: 4 }, workers: 0, snap: { runState: { branch: 'pir/checkout', ceiling: 2, tasks: [], handoff: { state: 'ready' }, finisher } } };
  for (const columns of [80, 120]) {
    const frame = buildListFrame(buildDashboard([ready, ...VIEWS]), initialUi(), { columns });
    const text = frameText(frame);
    assert.match(text, /checkout +work +● ready for your go +shop +▰+ 4\/4 +·/, 'the whole state fits its column');
    assert.equal(findSpan(frame, '● ready for your go').style, 'your-go', 'amber bold');
    assert.match(text, /1 waiting for you/);
    for (const l of text.split('\n')) assert.ok([...l].length <= columns, `wider than ${columns}: ${l}`);
  }
});

test('the live view with the finisher: its row in the agent\'s place, the footer naming c, the hint `c finisher` (T07)', () => {
  const finisher = { id: 'f', logPath: '/c/f.ndjson', state: 'awaiting-go', phase: 'awaiting-go', asking: true };
  const run = tasksRun([T12_TASKS[0]], { snap: { runState: { branch: 'pir/plan', ceiling: 2, complete: true, readyToMerge: true, handoff: { state: 'ready' }, coordinator: null, finisher, tasks: [T12_TASKS[0]] } } });
  const text = frameText(buildWatchFrame(run, { now: NOW, ui: { ...initialUi(), view: 'watch', openSlug: 'plan', taskSel: 0 } }));
  assert.match(text, /◆ finisher +waiting for your go/);
  assert.match(text, /◆ finisher ready · c to review and say go/);
  assert.match(text, /c finisher/);
  assert.doesNotMatch(text, /c coordinator|git merge/);
});

test('a run the finisher ended: the stale note offers no merge (T07)', () => {
  const tasks = [{ id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 100, question: null }];
  const runState = { branch: 'pir/gamma', ceiling: 2, complete: true, readyToMerge: true, handoff: { state: 'ready' }, coordinator: null, finisher: { id: 'f', state: 'done', phase: 'done', asking: false }, tasks };
  const text = frameText(buildWatchFrame(
    { slug: 'gamma', state: 'finished', repo: 'repoC', snap: { version: 1, proc: {}, finalState: 'finished', runState }, record: { pid: 9, branch: 'pir/gamma' } },
    { now: NOW, columns: 200 },
  ));
  assert.ok(!/git merge/.test(text), text);
  assert.match(text, /finished · this frame is stale\. The finisher is done\./);
  assert.match(text, /◆ finisher +done/);
});
