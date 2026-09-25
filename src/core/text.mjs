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
