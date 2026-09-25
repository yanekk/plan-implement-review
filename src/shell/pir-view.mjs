// FrameView — the pi-tui component that paints the dashboard's styled frames (DESIGN §2.11; T11).
//
// The frame builders in pir-tui.mjs emit STYLED LINES as data (a line is an array of `{ text, style }`
// spans), exactly as render.mjs's styledLines does. This component is the one place those spans become
// terminal strings: each span is clipped to the width and wrapped in its colour. pi-tui owns everything
// else — the alternate screen, the cursor, the differential repaint and cutting the frame at the
// terminal's rows — so no cursor-control escape is written by pir any more.

import { sliceByColumn, visibleWidth } from '@earendil-works/pi-tui';

// The style→colour (SGR) map. It carries TWO vocabularies. The first block is render.mjs's own row/footer
// keys with render.mjs's exact codes, so the watch frame — whose lines come from render.mjs's styledLines
// — colours byte-for-byte the way the coordinator paints it (§2.4). The second block is the list's §2.11
// semantic colours: running green, crashed red, finished/stopped dim; the progress bar blue for a running
// run, red for a crashed one, dim otherwise; the selected row's blue left edge; the running/crashed counts
// green/red; the faint key-hint footer; the amber-bold armed confirmation line.
export const SGR = {
  // render.mjs's live-view keys — kept identical so the reused watch frame matches the coordinator.
  done: '\x1b[32m', // green
  active: '\x1b[36m', // cyan
  asking: '\x1b[1;33m', // bold amber
  idle: '\x1b[2m', // dim
  red: '\x1b[31m', // failure / interrupted
  conflict: '\x1b[1;38;5;208m', // bold orange, a merge conflict
  // the list's §2.11 keys.
  head: '\x1b[1m', // the `pir` title, bold
  running: '\x1b[32m', // a running run's state word, green
  crashed: '\x1b[31m', // a crashed run's state word, red
  ended: '\x1b[2m', // finished / stopped, dim
  'bar-run': '\x1b[34m', // progress bar of a running run, blue
  'bar-crash': '\x1b[31m', // progress bar of a crashed run, red
  'bar-idle': '\x1b[2m', // progress bar otherwise, dim
  selected: '\x1b[34m', // the selected row's left edge, blue
  'count-run': '\x1b[32m', // the running count, green
  'count-crash': '\x1b[31m', // the crashed count, red
  hint: '\x1b[2m', // the faint key-hint footer
  armed: '\x1b[1;33m', // the armed stop/remove confirmation, amber and bold
  dim: '\x1b[2m', // plain dim text (repo column, worker count, notes)
  // the conversation view's keys (core/conversation.mjs, live-workers §2.11), after the approved prototype:
  // pir orange, the person green, the worker bold, a step magenta (red when it failed), a pending prompt amber.
  pir: '\x1b[38;5;208m',
  person: '\x1b[32m',
  worker: '\x1b[1m',
  step: '\x1b[35m',
  'step-error': '\x1b[31m',
  prompt: '\x1b[1;33m',
  ok: '\x1b[32m',
  bad: '\x1b[31m',
};
export const RESET = '\x1b[0m';

// Clip a line's spans to at most `width` terminal columns across the whole line, so a multi-span row
// truncates as one line and never wraps. Counted in columns, not code points: a wide (CJK) character
// takes two, and one that would straddle the edge is dropped rather than half-drawn (`strict`).
export function clipSpans(spans, width) {
  const out = [];
  let used = 0;
  for (const sp of spans) {
    if (used >= width) break;
    const text = String(sp.text ?? '');
    const w = visibleWidth(text);
    if (used + w <= width) {
      out.push({ text, style: sp.style });
      used += w;
    } else {
      out.push({ text: sliceByColumn(text, 0, width - used, true), style: sp.style });
      break;
    }
  }
  return out;
}

// paintLine(spans, width, colour) → one terminal string: the spans clipped to `width` columns, each in its
// colour. FrameView paints every frame line this way; the conversation view (T13) paints its own lines with it.
export function paintLine(spans, width, colour = true) {
  return clipSpans(spans, Math.max(1, width | 0))
    .map(({ text, style }) => (colour && style && SGR[style] ? `${SGR[style]}${text}${RESET}` : text))
    .join('');
}

export class FrameView {
  // getLines() → the frame to paint now. colour off paints the bare text (NO_COLOR, or a caller that
  // decided the stream cannot take colour).
  constructor(getLines, { colour = true } = {}) {
    this.getLines = getLines;
    this.colour = colour;
  }

  render(width) {
    const cols = Math.max(1, width | 0);
    return (this.getLines() ?? []).map((spans) => paintLine(spans, cols, this.colour));
  }

  // Nothing is cached between renders: every render reads the current frame.
  invalidate() {}
}
