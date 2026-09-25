// Pure text helpers shared by the shell's frame builders and core's conversation model (DESIGN §2.11).
// Moved here from shell/pir-tui.mjs so worker text is wrapped by the same function as the watch view's
// notes, not a second wrapper (user 2026-09-25, re-review). Counts code points: wide characters are the
// painter's to clip (pi-tui, in the shell), since core may not import a package.

// Wrap one logical line to at most `width` visible columns, breaking at a space when there is one and
// hard-breaking a token longer than the width (a file path has no spaces, so it hard-breaks — which is
// how a long run.log path is made to fit rather than being clipped off the right edge, user 2026-09-22).
// Returns one-or-more strings, counted by code point. An empty string wraps to a single empty line.
export function wrapLine(text, width) {
  const w = Math.max(1, width | 0 || 1);
  const chars = [...String(text ?? '')];
  if (chars.length <= w) return [chars.join('')];
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + w, chars.length);
    if (end < chars.length) {
      // Prefer a break at the last space in the window; if there is none, hard-break at the width.
      let brk = -1;
      for (let i = end; i > start; i--) {
        if (chars[i - 1] === ' ') {
          brk = i;
          break;
        }
      }
      if (brk > start) end = brk;
    }
    out.push(chars.slice(start, end).join('').replace(/\s+$/, ''));
    start = end;
    while (start < chars.length && chars[start] === ' ') start += 1; // swallow the break's leading spaces
  }
  return out;
}

// Cut `text` to at most `width` code points, ending in `…` when anything was cut. Counting code points,
// never UTF-16 units, is what keeps a surrogate pair (an emoji) whole.
export function clipText(text, width) {
  const w = Math.max(0, width | 0);
  const chars = [...String(text ?? '')];
  if (chars.length <= w) return chars.join('');
  if (w === 0) return '';
  return chars.slice(0, w - 1).join('') + '…';
}

// Reduce text a worker or a tool produced to what a terminal would show as plain characters. Tool output
// carries colour codes, progress-bar carriage returns and tabs, and painted raw an escape would move the
// cursor, clear the screen or retitle the window, while every width count here would be off by the
// escape's length. Escape sequences (CSI, OSC, the two-byte forms) go; within each line only what follows
// the last carriage return stays, as a terminal would overwrite it; tabs expand to 8-column stops; any
// other C0/C1 control and DEL go. Newlines are kept for the caller to split on.
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g;
const ESC2 = /\x1b[ -/]*[0-~]/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g; // keeps \t (expanded below) and \n
export function plainText(text) {
  const s = String(text ?? '').replace(OSC, '').replace(CSI, '').replace(ESC2, '').replace(/\r\n/g, '\n');
  return s
    .split('\n')
    .map((line) => {
      const shown = line.slice(line.lastIndexOf('\r') + 1).replace(CONTROL, '');
      if (!shown.includes('\t')) return shown;
      let col = 0;
      let out = '';
      for (const ch of shown) {
        if (ch === '\t') {
          const pad = 8 - (col % 8);
          out += ' '.repeat(pad);
          col += pad;
        } else {
          out += ch;
          col += 1;
        }
      }
      return out;
    })
    .join('\n');
}
