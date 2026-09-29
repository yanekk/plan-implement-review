// The terminal renderer (DESIGN §2.3, §4, T15). What the tests CAN prove: that a non-TTY stream gets
// plain lines and never a cursor escape (the harness and any pipe depend on this), and that a TTY stream
// owns a bounded region — enters the alternate screen once, homes+clears each frame, clips every line to
// the terminal size so nothing wraps or scrolls, does not accumulate across paints, and always leaves
// the alternate screen on teardown. What they cannot prove — that the painted block actually reads right
// to a person — is T09 (DESIGN §2.3, §5.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, formatLines } from './render.mjs';
import { buildDisplay } from '../core/display.mjs';

// A fake stream that records everything written and declares its TTY-ness and size, standing in for
// process.stdout without a real terminal. reset() drops the recorded chunks so a single paint can be
// isolated as a delta.
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
    reset: () => {
      chunks.length = 0;
    },
  };
}

const NOW = 1_000_000;
const sample = () =>
  buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 4,
      tasks: [
        { id: 'T01', slug: 'stop-promoting', deps: [], done: true, phase: null, since: null, doneMs: 6400, question: null },
        { id: 'T02', slug: 'live-display', deps: [], done: false, phase: 'building', since: NOW - 4000, doneMs: null, question: null },
        { id: 'T03', slug: 'waits', deps: ['T02'], done: false, phase: null, since: null, doneMs: null, question: null },
      ],
    },
    { now: NOW },
  );

// The escapes the renderer uses. `?1049h/l` enter/leave the alternate screen; `?25l/h` hide/show the
// cursor; `H` homes; `2J` clears the screen.
const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ANY_ESCAPE = /\x1b\[/;
// A colour (SGR) escape ends in `m`; the cursor-control escapes this renderer uses end in H/J/h/l, so
// this pattern isolates colour from cursor control (T16).
const SGR_ESCAPE = /\x1b\[[0-9;]*m/;
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const AMBER_BOLD = '\x1b[1;33m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';

// A display with one parked worker, for the asking-standout and question-absence checks.
const askingSample = () =>
  buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 2,
      tasks: [
        {
          id: 'T01',
          slug: 'stop-promoting',
          deps: [],
          done: false,
          phase: 'asking',
          since: NOW,
          doneMs: null,
          question: 'Should the warning fire at 80% or 90%? [a very long multi-paragraph question]',
        },
      ],
    },
    { now: NOW },
  );

// Strip every CSI escape, leaving only the drawn content — so a paint's content lines can be measured.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// Isolate one paint: clear the recorder, paint, return only what that paint wrote.
function paintDelta(r, stream, display) {
  stream.reset();
  r.paint(display);
  return stream.text();
}

test('a non-TTY stream gets plain lines and no ANSI cursor-control escapes', () => {
  const stream = fakeStream({ isTTY: false });
  const r = createRenderer({ stream });
  r.paint(sample());
  r.paint(sample()); // a second paint must still not reach for the cursor on a non-TTY

  const out = stream.text();
  assert.ok(!ANY_ESCAPE.test(out), `no escape sequence may reach a non-terminal, got: ${JSON.stringify(out)}`);
  assert.match(out, /stop-promoting/, 'the row content is still there, just plain');
  assert.match(out, /live-display/);
  assert.match(out, /pir\/demo/, 'the summary header names the run branch');
  // Two paints on a non-TTY append — the first block is not cleared, so T01 appears twice.
  assert.equal((out.match(/stop-promoting/g) || []).length, 2, 'non-TTY paints append rather than redraw in place');
});

test('the first paint enters the alternate screen and hides the cursor', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.paint(sample());
  const out = stream.text();
  assert.ok(out.includes(ENTER_ALT), 'the first paint enters the alternate screen buffer');
  assert.ok(out.includes(HIDE_CURSOR), 'and hides the cursor');
  // The alt-enter happens once, on the first paint only.
  const d2 = paintDelta(r, stream, sample());
  assert.ok(!d2.includes(ENTER_ALT), 'a later paint does not re-enter the alternate screen');
});

test('each paint homes the cursor and clears the screen before drawing', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.paint(sample());
  const d2 = paintDelta(r, stream, sample());
  assert.ok(d2.startsWith('\x1b[H\x1b[2J'), 'a paint homes then clears before any content is drawn');
});

test('a paint clips every line to columns and the whole frame to rows', () => {
  const stream = fakeStream({ columns: 30, rows: 3 });
  const r = createRenderer({ stream });
  r.paint(sample());
  const body = stripAnsi(paintDelta(r, stream, sample()));
  const lines = body.split('\n');
  for (const ln of lines) {
    assert.ok([...ln].length <= 30, `no drawn line exceeds columns: ${JSON.stringify(ln)} (${[...ln].length} cols)`);
  }
  assert.ok(lines.length <= 3, `the frame is capped at the row budget, got ${lines.length} lines`);
});

test('a second paint fully replaces the first — one frame between homes, no accumulation', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.paint(sample());
  const d2 = paintDelta(r, stream, sample());
  const d3 = paintDelta(r, stream, sample());

  assert.equal((d2.match(/\x1b\[H/g) || []).length, 1, 'exactly one home per paint');
  assert.equal((d2.match(/\x1b\[2J/g) || []).length, 1, 'exactly one clear per paint');

  const body2 = stripAnsi(d2);
  const body3 = stripAnsi(d3);
  assert.equal((body2.match(/pir\/demo/g) || []).length, 1, 'the frame is drawn once per paint, not appended to the last');
  assert.equal(body2.split('\n').length, body3.split('\n').length, 'the frame height is constant across paints');
});

test('teardown leaves the alternate screen and shows the cursor, and is idempotent', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.paint(sample());
  stream.reset();
  r.close();
  const out = stream.text();
  assert.ok(out.includes(SHOW_CURSOR), 'close() shows the cursor');
  assert.ok(out.includes(LEAVE_ALT), 'close() leaves the alternate screen');

  stream.reset();
  r.close();
  assert.equal(stream.text(), '', 'a second close() is a no-op');
});

test('regression: even when the summary line would wrap, the frame clips to the row budget at constant height', () => {
  // Columns narrow enough that the summary line (the one that streamed in the reported bug) would wrap
  // on a real terminal. The renderer must clip, not wrap, so the height stays constant across paints.
  const stream = fakeStream({ columns: 24, rows: 6 });
  const r = createRenderer({ stream });
  r.paint(sample());
  const body2 = stripAnsi(paintDelta(r, stream, sample()));
  const body3 = stripAnsi(paintDelta(r, stream, sample()));
  for (const ln of body2.split('\n')) {
    assert.ok([...ln].length <= 24, `clipped, never wrapped: ${JSON.stringify(ln)}`);
  }
  assert.ok(body2.split('\n').length <= 6, 'within the row budget');
  assert.equal(body2.split('\n').length, body3.split('\n').length, 'height is constant paint to paint (no streaming)');
});

test('line() leaves the alternate screen so a one-off note lands on the normal screen; a following paint re-enters', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.paint(sample());
  stream.reset();
  r.line('cleared stale control feeds from a prior run: reports/');
  const noteOut = stream.text();
  assert.ok(noteOut.includes(LEAVE_ALT), 'line() leaves the alternate screen first');
  assert.ok(noteOut.includes(SHOW_CURSOR), 'and restores the cursor');
  assert.match(noteOut, /cleared stale control feeds/, 'then prints the note');

  const d = paintDelta(r, stream, sample());
  assert.ok(d.includes(ENTER_ALT), 'the next paint re-enters a fresh alternate screen');
});

test('a note printed before the first paint stays on the normal screen (never enters the alt screen)', () => {
  // The restart-reconciliation summary is emitted before the first paint; it must not switch to the
  // alternate screen (coordinate.mjs prints it, then the live frame follows).
  const stream = fakeStream();
  const r = createRenderer({ stream });
  r.line('  ↻ resumed from committed work on 2 task branch(es)');
  const out = stream.text();
  assert.ok(!out.includes(ENTER_ALT), 'a note before any paint does not enter the alternate screen');
  assert.match(out, /resumed from committed work/);
});

test('formatLines renders the row content the renderer paints, with no escapes of its own', () => {
  const lines = formatLines(sample(), { spinnerChar: '⠋' });
  const joined = lines.join('\n');
  assert.ok(!ANY_ESCAPE.test(joined), 'the content block itself carries no escapes — those are added by paint on a TTY only');
  assert.match(joined, /✔ T01 {2}stop-promoting/, 'a merged task shows the check glyph, id and slug');
  assert.match(joined, /⠋ T02 {2}live-display/, 'a building task shows the spinner frame it was handed');
  assert.match(joined, /needs T02/, 'the waiting row names its unmet dependency');
});

test('a red footer prints the gate reason and log path as a second line, and none for an old snapshot (DESIGN §2.8)', () => {
  const base = { branch: 'pir/demo', ceiling: 2, complete: true, readyToMerge: false, tasks: [{ id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 100, question: null }] };
  const why = formatLines(buildDisplay({ ...base, testsReason: { reason: 'test `make test` exited 127', logPath: '/p/tests.log' } }, { now: 0 }));
  const at = why.findIndex((l) => l.includes('its tests fail — not ready to merge'));
  assert.ok(at >= 0, 'the red line is there');
  assert.equal(why[at + 1], '  test `make test` exited 127 · output: /p/tests.log', 'the second line says why and where');
  assert.ok(!why.some((l) => /git merge/.test(l)), 'a red footer never offers the merge');

  const logOnly = formatLines(buildDisplay({ ...base, testsReason: { reason: null, logPath: '/p/tests.log' } }, { now: 0 }));
  assert.ok(logOnly.includes('  output: /p/tests.log'), 'a log path alone still prints');

  const old = formatLines(buildDisplay(base, { now: 0 }));
  const oldAt = old.findIndex((l) => l.includes('not ready to merge'));
  assert.equal(old.length, oldAt + 1, 'an old snapshot with no reason gets no second line');
});

test('on a colour TTY each row is tinted by status: active cyan, done green, idle dim (T16)', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream, colour: true });
  const out = paintDelta(r, stream, sample());
  assert.match(out, /\x1b\[32m[^\x1b]*stop-promoting/, 'the merged row is green');
  assert.match(out, /\x1b\[36m[^\x1b]*live-display/, 'the building row is cyan');
  assert.match(out, /\x1b\[2m[^\x1b]*waits/, 'the idle/waiting row is dim');
  assert.ok(out.includes(GREEN) && out.includes(CYAN) && out.includes(DIM));
});

test('on a colour TTY the parked pointer and its row stand out in amber bold, question still absent (T16)', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream, colour: true });
  const out = paintDelta(r, stream, askingSample());
  // The asking row itself is amber-bold.
  assert.match(out, /\x1b\[1;33m[^\x1b]*stop-promoting/, 'the parked row is amber bold');
  // The footer pointer line is amber-bold too.
  assert.match(out, /\x1b\[1;33m[^\x1b]*asking you; open it \(→\) to answer/, 'the asking footer pointer is amber bold');
  assert.ok(!stripAnsi(out).includes('multi-paragraph question'), 'the full question is still not drawn in the frame');
});

test('the summary header is green when finished and red when interrupted, neutral while running (T16)', () => {
  const finished = buildDisplay(
    { branch: 'pir/demo', ceiling: 2, complete: true, readyToMerge: true, tasks: [{ id: 'T01', slug: 'a', deps: [], done: true, phase: null, since: null, doneMs: 100, question: null }] },
    { now: NOW },
  );
  const interrupted = buildDisplay(
    { branch: 'pir/demo', ceiling: 2, interrupted: true, tasks: [{ id: 'T01', slug: 'a', deps: [], done: false, phase: 'building', since: NOW, doneMs: null, question: null }] },
    { now: NOW },
  );
  const running = sample();

  const s = fakeStream();
  let r = createRenderer({ stream: s, colour: true });
  assert.match(paintDelta(r, s, finished), /\x1b\[32m✓ pir\/demo/, 'a finished header is green');

  const s2 = fakeStream();
  r = createRenderer({ stream: s2, colour: true });
  assert.match(paintDelta(r, s2, interrupted), /\x1b\[31m✗ pir\/demo interrupted/, 'an interrupted header is red');

  const s3 = fakeStream();
  r = createRenderer({ stream: s3, colour: true });
  const runOut = paintDelta(r, s3, running);
  // The running header (the spinner line) carries no colour of its own — status lives on the rows.
  assert.ok(!/\x1b\[[0-9;]*m[^\n]*running/.test(runOut), 'the running header is neutral');
});

test('colour is off when colour:false — cursor control still present, no SGR escape (T16)', () => {
  const stream = fakeStream();
  const r = createRenderer({ stream, colour: false });
  const out = paintDelta(r, stream, askingSample());
  assert.ok(out.includes('\x1b[H'), 'still homes the cursor (in-place paint is unaffected)');
  assert.ok(!SGR_ESCAPE.test(out), `no colour escape when colour is off, got: ${JSON.stringify(out)}`);
  // The frame is byte-identical to what T15 drew: plain clipped text between HOME+CLEAR.
  assert.match(stripAnsi(out), /asking you; open it \(→\) to answer/, 'the pointer content is unchanged, just uncoloured');
});

test('colour never reaches a non-TTY stream even when colour:true is passed (T16)', () => {
  const stream = fakeStream({ isTTY: false });
  const r = createRenderer({ stream, colour: true });
  r.paint(sample());
  const out = stream.text();
  assert.ok(!ANY_ESCAPE.test(out), 'a non-terminal gets no escape at all, colour or cursor');
});

test('clipping still holds with colour on: visible width within columns, height constant (T16 keeps T15)', () => {
  const stream = fakeStream({ columns: 24, rows: 6 });
  const r = createRenderer({ stream, colour: true });
  r.paint(askingSample());
  const body2 = stripAnsi(paintDelta(r, stream, askingSample()));
  const body3 = stripAnsi(paintDelta(r, stream, askingSample()));
  for (const ln of body2.split('\n')) {
    assert.ok([...ln].length <= 24, `visible text clipped despite colour: ${JSON.stringify(ln)}`);
  }
  assert.equal(body2.split('\n').length, body3.split('\n').length, 'height constant paint to paint');
});

test('the parked-worker footer is a compact single line and never the full question (T15, §2.2)', () => {
  const display = buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 2,
      tasks: [
        {
          id: 'T01',
          slug: 'stop-promoting',
          deps: [],
          done: false,
          phase: 'asking',
          since: NOW,
          doneMs: null,
          question: 'Should the warning fire at 80% or 90%? [a very long multi-paragraph question the person reads in the worker session]',
        },
      ],
    },
    { now: NOW },
  );
  const lines = formatLines(display, { spinnerChar: '⠋' });
  const joined = lines.join('\n');
  assert.match(joined, /asking you/, 'the compact row says who is asking');
  assert.match(joined, /open it \(→\) to answer/, 'and how to reach them: in `pir` (live-workers §2.4)');
  assert.doesNotMatch(joined, /claude agents|attach/i, 'no `claude agents` and no attaching any more');
  assert.ok(!joined.includes('multi-paragraph question'), 'the full question is not drawn in the live frame');
  // The footer is the compact parked block; "to answer" is unique to it, so it marks that block.
  const footerLines = lines.filter((l) => l.includes('to answer'));
  assert.equal(footerLines.length, 1, 'a single compact asking footer line, not the old multi-line block');
});

test('a conflict sent to its live worker paints a spinning `fixing conflict` row in the active style, with no footer (live-workers T08)', async () => {
  const { styledLines } = await import('./render.mjs');
  const d = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in a.txt', conflictSent: true }] },
    { now: NOW },
  );
  const lines = styledLines(d, { spinnerChar: '⠋' });
  assert.doesNotMatch(lines[0].text, /merge conflict|asking you/, 'the summary counts it as running only');
  assert.match(lines[0].text, /1 running/);
  const row = lines.find((l) => l.text.includes('T05'));
  assert.match(row.text, /⠋ T05\s+clash\s+fixing conflict/);
  assert.equal(row.style, 'active');
  assert.ok(!lines.some((l) => /paste|claude agents/.test(l.text)), 'no conflict footer');
});

test('a preparing row spins and is tinted active, like a building one (T07)', () => {
  const display = buildDisplay(
    { branch: 'pir/x', ceiling: 2, tasks: [{ id: 'T07', slug: 'worker-setup', deps: [], done: false, phase: 'preparing', since: null, doneMs: null, question: null }] },
    { now: 0 },
  );
  assert.match(formatLines(display, { spinnerChar: '⠋' }).join('\n'), /⠋ T07 {2}worker-setup/);
  const stream = fakeStream();
  const r = createRenderer({ stream, colour: true });
  assert.match(paintDelta(r, stream, display), /\x1b\[36m[^\x1b]*worker-setup/);
});

test('the end gate running paints a ticking header and a testing footer, not the finished header (user 2026-09-25)', () => {
  const NOW = 1_000_000;
  const tasks = [{ id: 'T01', slug: 'one', deps: [], done: true, phase: null, since: null, doneMs: 60_000, question: null }];
  const lines = formatLines(buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks, testing: { since: NOW - 72_000 } }, { now: NOW }), { spinnerChar: '⠧' });
  assert.equal(lines[0], '⠧ pir/demo · 1/1 done · running the tests');
  assert.equal(lines.at(-1), "⠧ all 1 task(s) merged · running the plan's setup and tests on pir/demo · 1:12");
  assert.ok(!lines.some((l) => l.startsWith('✓')), 'no finished header while the tests run');
});

// The coordinator agent (pir-coordinator T06): its held rows, and the end of a run with it.
test('formatLines: `asking coordinator` rows and the agent hand-off lines (ready, red, preparing)', () => {
  const t = (over) => ({ id: 'T01', slug: 'one', deps: [], done: false, phase: null, since: null, doneMs: null, question: null, ...over });
  const held = formatLines(buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks: [t({ phase: 'asking', holder: 'coordinator' })] }, { now: 0 }));
  assert.match(held[1], /● T01 {2}one +asking coordinator · a question/);
  assert.ok(!held.some((l) => /asking you/.test(l)), 'the person is not asked');

  const done = [t({ done: true })];
  const ready = formatLines(buildDisplay({ branch: 'pir/demo', ceiling: 2, complete: true, readyToMerge: true, tasks: done, handoff: { state: 'ready', reportPath: 'plans/demo/REPORT.md' } }, { now: 0 }));
  assert.deepEqual(ready.slice(-2), ['✔ ready to merge · git merge pir/demo', '  report: plans/demo/REPORT.md']);

  const red = formatLines(
    buildDisplay({ branch: 'pir/demo', ceiling: 2, complete: true, tasks: done, testsReason: { reason: 'test `npm test` exited 1', logPath: '/c/tests.log' }, handoff: { state: 'red', reportPath: 'plans/demo/REPORT.md' } }, { now: 0 }),
  );
  assert.deepEqual(red.slice(-3), ['✗ not ready · tests red on pir/demo — no merge offered', '  test `npm test` exited 1 · output: /c/tests.log', '  report: plans/demo/REPORT.md']);

  const prep = formatLines(buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks: done, handoff: { state: 'preparing', reportPath: null } }, { now: 0 }), { spinnerChar: '*' });
  // Short enough to fit 80 columns whole; the T07 drill found the longer wording cut to `writing the repor`.
  assert.equal(prep.at(-1), '* all 1 task(s) merged · preparing: syncing main, writing the report');
  assert.ok(prep.at(-1).length <= 78, 'fits an 80-column window with the view\'s margin');
});

// pir-coordinator T07 drill: `asking coordinator · allow a command?` is 37 columns, past the 24 the label
// column had, and pushed that row's clock one space after its label while the others stayed in line.
test('every row\'s clock lines up when one label is longer than the column', () => {
  const t = (id, over) => ({ id, slug: 'one', deps: [], done: false, phase: 'building', since: 0, doneMs: null, question: null, ...over });
  const lines = formatLines(
    buildDisplay({ branch: 'pir/demo', ceiling: 3, tasks: [t('T01', { phase: 'asking', holder: 'coordinator', asking: 'permission' }), t('T02'), t('T03', { phase: 'asking', holder: 'person', asking: 'questions' })] }, { now: 65000 }),
    { spinnerChar: '*' },
  );
  const rows = lines.slice(1, 4);
  assert.match(rows[0], /asking coordinator · allow a command\?/);
  const clockAt = rows.map((r) => r.lastIndexOf('1:05'));
  assert.ok(clockAt[0] > 0, rows.join('\n'));
  assert.deepEqual(clockAt, [clockAt[0], clockAt[0], clockAt[0]], `the clocks line up:\n${rows.join('\n')}`);
  // Short labels keep the column they always had.
  const plain = formatLines(buildDisplay({ branch: 'pir/demo', ceiling: 1, tasks: [t('T01')] }, { now: 65000 }), { spinnerChar: '*' });
  assert.equal(plain[1], `  * T01  ${'one'.padEnd(22)} ${'building'.padEnd(24)} 1:05`);
});

// An end-of-run helper's row (pir-coordinator T11): its id is wider than a task's, so the id column
// widens with it and every row's slug still starts in one column; the footer points at it; nothing is
// wider than 80 columns even with the longest label.
test('a helper row lines up with the task rows and its asking footer names it (T11)', () => {
  const d = buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 2,
      tasks: [{ id: 'T01', slug: 'stop-promoting', deps: [], done: true, doneMs: 6400 }],
      helpers: [{ id: 'tests-fix', slug: 'fix-red-tests', helper: true, deps: [], done: false, phase: 'building', asking: 'permission', holder: 'coordinator', since: NOW - 3000 }],
      handoff: { state: 'preparing' },
    },
    { now: NOW },
  );
  const lines = formatLines(d, { spinnerChar: '⠋' });
  const t01 = lines.find((l) => l.includes('T01'));
  const fix = lines.find((l) => l.includes('tests-fix'));
  assert.equal(t01.indexOf('stop-promoting'), fix.indexOf('fix-red-tests'), 'slugs in one column');
  assert.match(fix, /tests-fix fix-red-tests +asking coordinator · allow a command\? +0:03$/);
  for (const l of lines) assert.ok([...l].length <= 80, `wider than 80: ${l}`);

  const asking = formatLines(
    buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks: [{ id: 'T01', slug: 'x', deps: [], done: true }], helpers: [{ id: 'main-sync', slug: 'resolve-main-merge', helper: true, deps: [], done: false, phase: 'asking', holder: 'person' }] }, { now: NOW }),
  );
  assert.ok(asking.includes('● main-sync resolve-main-merge — asking you; open it (→) to answer'), asking.join('\n'));
});

// The coordinator agent's pinned row (pir-coordinator T12): a separator across the row width, then the
// agent's row with its state where the tasks' labels are; neither widens the task columns.
test('the separator and the agent row: order, width, alignment, no clock, style (T12)', () => {
  const runState = {
    branch: 'pir/demo',
    ceiling: 2,
    tasks: [
      { id: 'T01', slug: 'config-loader', deps: [], done: true, doneMs: 240000 },
      { id: 'T02', slug: 'api-routes', deps: [], done: false, phase: 'building', since: NOW - 120000 },
    ],
    coordinator: { id: 's', live: true, logPath: null, state: 'up', holding: 1 },
    helpers: [{ id: 'main-sync', slug: 'resolve-main-merge', helper: true, deps: [], done: false, phase: 'building', since: NOW - 3000 }],
  };
  const lines = formatLines(buildDisplay(runState, { now: NOW }), { spinnerChar: '⠋' });
  // summary, T01, T02, separator, agent, main-sync, blank footer
  assert.match(lines[3], /^ {2}─+$/);
  assert.equal(lines[4], `  ◆ ${'coordinator agent'.padEnd(9 + 1 + 22)} holding 1 question`);
  assert.match(lines[5], /^ {2}⠋ main-sync resolve-main-merge/);
  const t02 = lines[2];
  assert.equal(lines[4].indexOf('holding'), t02.indexOf('building'), 'the state lines up with the task labels');
  assert.equal([...lines[3]].length, [...lines[1]].length + 1, 'the separator spans a task row with a 4-column clock (+1 for a 5-column one)');
  for (const l of lines) assert.ok([...l].length <= 80, `wider than 80: ${l}`);

  // Given up: the idle style's wording, and its long label does not widen the task label column.
  const gone = formatLines(buildDisplay({ ...runState, helpers: undefined, coordinator: { ...runState.coordinator, state: 'given-up', live: false } }, { now: NOW }), { spinnerChar: '⠋' });
  assert.equal(gone[4], `  ◆ ${'coordinator agent'.padEnd(4 + 1 + 22)} given up · questions come to you`);
  assert.equal(gone[2], `  ⠋ T02  ${'api-routes'.padEnd(22)} ${'building'.padEnd(24)} 2:00`);

  // With no agent there is neither line.
  const none = formatLines(buildDisplay({ ...runState, coordinator: null }, { now: NOW }), { spinnerChar: '⠋' });
  assert.ok(!none.some((l) => l.includes('─') || l.includes('coordinator')), none.join('\n'));
});

test('the agent row and separator are painted in their styles on a colour TTY (T12)', () => {
  const out = [];
  const stream = { isTTY: true, columns: 80, rows: 24, write: (s) => out.push(s) };
  const r = createRenderer({ stream, colour: true });
  const base = { branch: 'b', ceiling: 1, tasks: [{ id: 'T01', slug: 'x', deps: [], done: true }] };
  r.paint(buildDisplay({ ...base, coordinator: { id: 's', live: true, state: 'up', holding: 0 } }, { now: NOW }));
  r.paint(buildDisplay({ ...base, coordinator: { id: 's', live: false, state: 'given-up' } }, { now: NOW }));
  r.close();
  const all = out.join('');
  assert.match(all, /\x1b\[36m {2}◆ coordinator agent +on duty\x1b\[0m/, 'up: the active colour, never amber');
  assert.match(all, /\x1b\[2m {2}◆ coordinator agent +given up · questions come to you\x1b\[0m/, 'given up: idle');
  assert.match(all, /\x1b\[2m {2}─+\x1b\[0m/, 'the separator: idle');
});

// The finisher's pinned row and footer (finisher DESIGN §2.11, T07): in the agent's place, amber while it
// waits for the go, and the footer pointing at `c` with no merge line.
test('the finisher row and footer: in the agent\'s place, amber while it waits for the go (T07)', () => {
  const runState = {
    branch: 'pir/demo',
    ceiling: 2,
    complete: true,
    readyToMerge: true,
    handoff: { state: 'ready', reportPath: 'plans/demo/REPORT.md', mainSha: 'abc' },
    coordinator: null,
    finisher: { id: 'f', logPath: null, state: 'awaiting-go', phase: 'awaiting-go', asking: true },
    tasks: [{ id: 'T01', slug: 'config-loader', deps: [], done: true, doneMs: 240000 }],
  };
  const lines = formatLines(buildDisplay(runState, { now: 1 }), { spinnerChar: '⠋' });
  assert.match(lines[2], /^ {2}─+$/);
  assert.equal(lines[3], `  ◆ ${'finisher'.padEnd(4 + 1 + 22)} waiting for your go`);
  assert.equal(lines.at(-1), '◆ finisher ready · c to review and say go');
  assert.ok(!lines.some((l) => l.includes('git merge')), 'no merge line beside the finisher');

  const out = [];
  const r = createRenderer({ stream: { isTTY: true, columns: 80, rows: 24, write: (s) => out.push(s) }, colour: true });
  r.paint(buildDisplay(runState, { now: 1 }));
  r.paint(buildDisplay({ ...runState, finisher: { ...runState.finisher, state: 'finishing', asking: false } }, { now: 1 }));
  r.close();
  const all = out.join('');
  assert.match(all, /\x1b\[1;33m {2}◆ finisher +waiting for your go\x1b\[0m/, 'waiting for the go: amber bold');
  assert.match(all, /\x1b\[1;33m◆ finisher ready · c to review and say go\x1b\[0m/, 'its footer: amber bold');
  assert.match(all, /\x1b\[36m {2}◆ finisher +finishing\x1b\[0m/, 'finishing: the active colour');
});
