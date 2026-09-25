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
  assert.match(out, /\x1b\[1;33m[^\x1b]*asking you; attach in/, 'the asking footer pointer is amber bold');
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
  assert.match(stripAnsi(out), /asking you; attach in/, 'the pointer content is unchanged, just uncoloured');
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
  assert.match(joined, /claude agents/, 'and how to reach them');
  assert.ok(!joined.includes('multi-paragraph question'), 'the full question is not drawn in the live frame');
  // The footer is the compact parked block; "claude agents" is unique to it, so it marks that block.
  const footerLines = lines.filter((l) => l.includes('claude agents'));
  assert.equal(footerLines.length, 1, 'a single compact asking footer line, not the old multi-line block');
});

test('a merge conflict row and footer paint orange and say `merge conflict`; the summary counts it apart (user 2026-09-24)', async () => {
  const { styledLines } = await import('./render.mjs');
  const d = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in FINDINGS.md', prompt: 'Merge conflict on T05 clash' }] },
    { now: NOW },
  );
  const lines = styledLines(d);
  assert.match(lines[0].text, /1 merge conflict\b/);
  assert.ok(!/asking you/.test(lines[0].text), 'the summary does not call a conflict asking you');
  const row = lines.find((l) => l.text.includes('T05'));
  assert.match(row.text, /● T05\s+clash\s+merge conflict/);
  assert.equal(row.style, 'conflict');
  const foot = lines[lines.length - 1];
  assert.match(foot.text, /T05 clash — merge conflict; paste the prompt shown in `pir`/);
  assert.doesNotMatch(foot.text, /claude agents/, 'no worker to attach to on the printed path (live-workers T08)');
  assert.equal(foot.style, 'conflict');
});

test('a conflict sent to its live worker paints a spinning `fixing conflict` row in the active style, with no footer (live-workers T08)', async () => {
  const { styledLines } = await import('./render.mjs');
  const d = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [{ id: 'T05', slug: 'clash', deps: [], done: false, phase: 'asking', since: NOW, doneMs: null, question: 'merge conflict in a.txt', prompt: 'sent', conflictSent: true }] },
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
