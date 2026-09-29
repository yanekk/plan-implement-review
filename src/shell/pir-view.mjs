// FrameView — the pi-tui component that paints the dashboard's styled frames (DESIGN §2.11; T11).
//
// The frame builders in pir-tui.mjs emit STYLED LINES as data (a line is an array of `{ text, style }`
// spans), exactly as render.mjs's styledLines does. This component is the one place those spans become
// terminal strings: each span is clipped to the width and wrapped in its colour. pi-tui owns everything
// else — the alternate screen, the cursor, the differential repaint and cutting the frame at the
// terminal's rows — so no cursor-control escape is written by pir any more.

import { sliceByColumn, visibleWidth } from '@earendil-works/pi-tui';

import { hoverAskingFor, hoverLiftFor, paletteFor } from './palette.mjs';

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

// The hovered row's lift for dim spans (mouse-navigation §2.2), from the same table as SGR.
export const HOVER_LIFT = hoverLiftFor(process.env);
// The hovered row's brighter amber for an asking span, which bold alone cannot lift (T08).
export const HOVER_ASKING = hoverAskingFor(process.env);
const BOLD = '\x1b[1m';

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

// paintLine(spans, width, colour, { hovered }) → one terminal string: the spans clipped to `width` columns,
// each in its colour. FrameView paints every frame line this way; the conversation view (T13) paints its
// own lines with it.
//
// A line whose first span is styled 'selected' is the selected row. With colour it paints as a dark grey
// band across the whole width, the `▎` mark blanked, and dim text brightened: dim on grey is barely
// legible (user 2026-09-26). With colour off the band cannot show, so the `▎` mark is drawn as text, which
// keeps colour from being the only sign of the selection (docs/detached-runs.md).
//
// `hovered` marks the row under the pointer (mouse-navigation §2.2): every span bold, a dim span lifted
// to HOVER_LIFT, an asking (amber bold) span brightened to HOVER_ASKING. The selected band wins over hover — two cues on one row read as noise — and with colour
// off there is no hover, since bold is painted only with colour. `palette` ({ sgr, lift }) defaults to
// this terminal's table; the tests pass the 24-bit one, which NO_COLOR keeps out of the module-level SGR.
export function paintLine(spans, width, colour = true, { hovered = false, palette: pal = { sgr: SGR, lift: HOVER_LIFT, asking: HOVER_ASKING } } = {}) {
  const cols = Math.max(1, width | 0);
  if (colour && spans[0]?.style === 'selected') return paintSelected(spans, cols);
  if (colour && hovered) return paintHovered(spans, cols, pal);
  return clipSpans(spans, cols)
    .map(({ text, style }) => (colour && style && SGR[style] ? `${SGR[style]}${text}${RESET}` : text))
    .join('');
}

// A span "paints dim" when its code is the table's dim code — 'dim', 'ended', 'idle', 'hint', 'bar-idle'
// on both tables — the same test paintSelected brightens by.
function paintHovered(spans, cols, { sgr, lift, asking }) {
  return clipSpans(spans, cols)
    .map(({ text, style }) => {
      const code = style ? sgr[style] : undefined;
      if (code && code === sgr.dim) return `${lift}${text}${RESET}`;
      if (asking && code && code === sgr.asking) return `${asking}${text}${RESET}`;
      return `${BOLD}${code ?? ''}${text}${RESET}`;
    })
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
  // decided the stream cannot take colour). getHoverY() → the screen row under the pointer, or null; a
  // frame line's index is its screen row (a painted frame is cut from the top, mouse-navigation §3.3).
  constructor(getLines, { colour = true, getHoverY = () => null } = {}) {
    this.getLines = getLines;
    this.colour = colour;
    this.getHoverY = getHoverY;
  }

  render(width) {
    const cols = Math.max(1, width | 0);
    const hoverY = this.getHoverY();
    // Only a line a click would open (one carrying a `hit`) lights up under the pointer (§2.2).
    return (this.getLines() ?? []).map((spans, y) =>
      paintLine(spans, cols, this.colour, { hovered: y === hoverY && Boolean(spans?.hit) }),
    );
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
