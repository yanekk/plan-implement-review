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
