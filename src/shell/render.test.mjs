// The terminal renderer (DESIGN §2.3, §4). What the tests CAN prove: that a non-TTY stream gets plain
// lines and never a cursor escape (the harness and any pipe depend on this), and that a TTY stream gets
// the cursor-up/clear escapes and one redrawn block rather than an ever-growing append. What they cannot
// prove — that the painted block actually reads right to a person — is T09 (DESIGN §2.3, §5.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, formatLines } from './render.mjs';
import { buildDisplay } from '../core/display.mjs';

// A fake stream that records everything written and declares its TTY-ness, standing in for
// process.stdout without a real terminal.
function fakeStream(isTTY) {
  const chunks = [];
  return { isTTY, write: (s) => chunks.push(s), text: () => chunks.join('') };
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

// The escape a paint uses to move the cursor up over the previous block: CSI <n> A.
const CURSOR_UP = /\x1b\[\d+A/;
const ANY_ESCAPE = /\x1b\[/;

test('a non-TTY stream gets plain lines and no ANSI cursor-control escapes', () => {
  const stream = fakeStream(false);
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

test('a TTY stream emits cursor-up/clear escapes and redraws one block instead of appending', () => {
  const stream = fakeStream(true);
  const r = createRenderer({ stream });

  r.paint(sample());
  const afterFirst = stream.text();
  assert.ok(!CURSOR_UP.test(afterFirst), 'the first paint has no previous block to move up over');

  r.paint(sample());
  const afterSecond = stream.text().slice(afterFirst.length);
  assert.match(afterSecond, CURSOR_UP, 'the second paint moves the cursor up over the first block');
  assert.match(afterSecond, /\x1b\[0J/, 'and clears from there to the end of the screen before redrawing');
});

test('line() prints a one-off plain line and ends the in-place block so the next paint starts fresh', () => {
  const stream = fakeStream(true);
  const r = createRenderer({ stream });
  r.paint(sample());
  r.line('cleared stale control feeds from a prior run: reports/');
  const before = stream.text();
  assert.match(before, /cleared stale control feeds/);

  r.paint(sample());
  const afterPaint = stream.text().slice(before.length);
  assert.ok(!CURSOR_UP.test(afterPaint), 'after a line(), the next paint does not try to clear over it — it starts a fresh block');
});

test('formatLines renders the row content the renderer paints, with no escapes of its own', () => {
  const lines = formatLines(sample(), { spinnerChar: '⠋' });
  const joined = lines.join('\n');
  assert.ok(!ANY_ESCAPE.test(joined), 'the content block itself carries no escapes — those are added by paint on a TTY only');
  assert.match(joined, /✔ T01 {2}stop-promoting/, 'a merged task shows the check glyph, id and slug');
  assert.match(joined, /⠋ T02 {2}live-display/, 'a building task shows the spinner frame it was handed');
  assert.match(joined, /needs T02/, 'the waiting row names its unmet dependency');
});
