// FrameView — the pi-tui component that paints the dashboard's styled frames (DESIGN §2.11; T11).
//
// The frame builders in pir-tui.mjs emit STYLED LINES as data (a line is an array of `{ text, style }`
// spans), exactly as render.mjs's styledLines does. This component is the one place those spans become
// terminal strings: each span is clipped to the width and wrapped in its colour. pi-tui owns everything
// else — the alternate screen, the cursor, the differential repaint and cutting the frame at the
// terminal's rows — so no cursor-control escape is written by pir any more.

import { sliceByColumn, visibleWidth } from '@earendil-works/pi-tui';

import { paletteFor } from './palette.mjs';

// The style→colour (SGR) map, from palette.mjs: Catppuccin Mocha on a 24-bit terminal, the basic
// 16-colour codes otherwise. It carries TWO vocabularies. The first is render.mjs's own row/footer keys,
// from the same table render.mjs paints with, so the watch frame — whose lines come from render.mjs's
// styledLines — colours byte-for-byte the way the coordinator paints it (§2.4). The second is the list's
// §2.11 semantic colours and the conversation view's keys (the comments in palette.mjs name each one).
const palette = paletteFor(process.env);
export const SGR = palette.sgr;
export const RESET = '\x1b[0m';

// The selected row's band across the full width: a dark grey background (user 2026-09-26), Mocha's
// selection colour on a 24-bit terminal.
export const SELECTED_BG = palette.selectedBg;

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
//
// A line whose first span is styled 'selected' is the selected row. With colour it paints as a dark grey
// band across the whole width, the `▎` mark blanked, and dim text brightened: dim on grey is barely
// legible (user 2026-09-26). With colour off the band cannot show, so the `▎` mark is drawn as text, which
// keeps colour from being the only sign of the selection (docs/detached-runs.md).
export function paintLine(spans, width, colour = true) {
  const cols = Math.max(1, width | 0);
  if (colour && spans[0]?.style === 'selected') return paintSelected(spans, cols);
  return clipSpans(spans, cols)
    .map(({ text, style }) => (colour && style && SGR[style] ? `${SGR[style]}${text}${RESET}` : text))
    .join('');
}

function paintSelected(spans, cols) {
  const body = clipSpans([{ text: ' '.repeat(visibleWidth(spans[0].text)) }, ...spans.slice(1)], cols);
  const used = body.reduce((n, sp) => n + visibleWidth(sp.text), 0);
  // RESET clears the background too, so every span re-opens the band before its own colour.
  const painted = body.map(({ text, style }) => {
    const code = style && SGR[style] !== SGR.dim ? (SGR[style] ?? '') : '';
    return `${SELECTED_BG}${code}${text}${RESET}`;
  });
  if (used < cols) painted.push(`${SELECTED_BG}${' '.repeat(cols - used)}${RESET}`);
  return painted.join('');
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

// editorTheme(colour) → the pi-tui EditorTheme pir's typing boxes share (dashboard-plan-box DESIGN §6): a dim
// border, the pop-up's selected row amber like a prompt, its descriptions dim. The brief box and the runs
// list's new-plan box use it so the two boxes look the same.
export function editorTheme(colour) {
  const style = (s, text) => (colour && SGR[s] ? `${SGR[s]}${text}${RESET}` : text);
  return {
    borderColor: (s) => style('dim', s),
    selectList: {
      selectedPrefix: (s) => style('prompt', s),
      selectedText: (s) => style('prompt', s),
      description: (s) => style('dim', s),
      scrollInfo: (s) => style('dim', s),
      noMatch: (s) => style('dim', s),
    },
  };
}
