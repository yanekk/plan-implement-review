// The terminal renderer for the live display (DESIGN §2.3, §3.2). It is the shell half of the split:
// the pure model (src/core/display.mjs) turns run state into rows/summary/footer as data; this paints
// that data on a real terminal, `docker compose up`-style — the block redrawn in place on each pass,
// with a ticking spinner. It owns the glyph characters and the cursor control the model deliberately
// does not, because in-place painting can only be judged by a person watching a real terminal (T09).
//
// It degrades when stdout is not a TTY — piped, redirected, or captured by the test harness — to plain
// append-only lines with no cursor escapes, because cursor-control garbles a non-terminal and the
// harness reads the output as text (DESIGN §2.3). So `paint` only redraws in place when stream.isTTY;
// otherwise it appends the same lines plainly. This is why the model is pure and this is not: the
// vocabulary is tested in display.test.mjs; the paint mechanics (alt-screen, clip, no-accumulation) in
// render.test.mjs; only that the block reads right to a person needs eyes (T09).
//
// How the in-place paint stays honest (T15). The first cut moved the cursor up by the *logical* line
// count and cleared — but any line that WRAPS occupies more terminal rows than logical lines, and the
// summary line wraps on a normal-width terminal, so the clear landed mid-frame and every tick left a
// copy behind (FINDINGS 2026-09-20, by-eye). This renderer never reasons about wrap heights at all.
// It owns a bounded region: it enters the alternate screen buffer, and each frame it homes the cursor,
// clears the screen, and draws the frame CLIPPED to the terminal size — every line truncated to
// `columns`, the whole frame capped at `rows` — so nothing can wrap or scroll and the frame height is
// always exactly what was drawn. On teardown it leaves the alternate screen, which restores the normal
// screen the startup notes were printed to; the one-off hand-off line is printed there.

// The spinner frames, ticked one per paint (a real run paints once per pass / poll). A reduced-motion
// terminal is a person's setting the renderer cannot read here; the frames are plain Braille dots.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// The glyph per row kind. Active kinds spin; a parked worker is a filled dot (it wants the person); a
// merged task is a check; an idle task is a faint dot. The model carries the kind; these characters are
// the renderer's alone (DESIGN §2.3).
const GLYPH = {
  building: null, // the spinner frame — filled in at paint time
  reviewing: null,
  merging: null,
  asking: '●',
  done: '✔',
  waiting: '·',
  queued: '·',
};

// The cursor-control escapes this renderer uses. Kept named so the paint code reads as intent and the
// tests can match them exactly. `?1049h/l` switch to/from the alternate screen buffer (so the live
// display never scrolls the person's scrollback and vanishes cleanly on exit); `?25l/h` hide/show the
// cursor; `H` homes the cursor to the top-left; `2J` clears the whole screen.
const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';
const CLEAR = '\x1b[2J';

// Sensible sizes when a TTY does not report its dimensions (rare, but `stream.columns`/`rows` can be
// undefined on some terminals). Clipping still applies so the frame is bounded either way.
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// mm:ss for an elapsed/duration in ms; null renders blank. 0:04, 1:23, 12:05.
function fmtElapsed(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Truncate a line to at most `cols` terminal columns. Counted by code point (Array spread), not code
// unit, so a multi-byte glyph (the check, the spinner dot) counts as one — good enough for the display,
// which is single-width glyphs plus ASCII. This is the guarantee that no drawn line ever wraps: the
// whole point of T15, since a wrapped line is what threw the old cursor math off.
function clip(line, cols) {
  const chars = [...line];
  return chars.length <= cols ? line : chars.slice(0, cols).join('');
}

// The block of plain-text lines for a display, given the current spinner character. No escapes here —
// this is the same content whether it is painted in place (TTY) or appended (non-TTY); only the cursor
// control around it differs. Exported so a test can assert the content without the escapes.
export function formatLines(display, { spinnerChar = SPINNER[0] } = {}) {
  const { summary, rows, footer, branch } = display;
  const lines = [summaryLine(summary, footer, branch, spinnerChar)];
  for (const r of rows) lines.push(rowLine(r, spinnerChar));
  for (const f of footerLines(footer, summary)) lines.push(f);
  return lines;
}

function summaryLine(summary, footer, branch, spinnerChar) {
  if (footer?.kind === 'interrupted') {
    return `✗ ${branch || 'run'} interrupted`;
  }
  if (summary.finished) {
    return `✓ ${branch || 'run'} · ${summary.done}/${summary.total} done`;
  }
  const parts = [`${summary.done}/${summary.total} done`, `${summary.running} running`];
  if (summary.asking > 0) parts.push(`${summary.asking} asking you`);
  parts.push(`${summary.waiting} waiting`);
  const ceiling = summary.ceiling != null ? ` · ceiling ${summary.ceiling}${summary.ceilingFull ? ' (full)' : ''}` : '';
  return `${spinnerChar} ${branch || 'run'} · ${parts.join(' · ')}${ceiling}`;
}

function rowLine(r, spinnerChar) {
  const glyph = GLYPH[r.kind] === null || GLYPH[r.kind] === undefined ? spinnerChar : GLYPH[r.kind];
  // For an idle/queued row the glyph is a faint dot; keep the columns aligned enough to read.
  const g = r.kind === 'waiting' || r.kind === 'queued' ? '·' : glyph;
  const id = r.id.padEnd(4);
  const slug = (r.slug ?? '').padEnd(22);
  const label = r.label.padEnd(24);
  const el = fmtElapsed(r.elapsedMs);
  return `  ${g} ${id} ${slug} ${label} ${el}`.replace(/\s+$/, '');
}

// The footer, in the model's kinds. The parked-worker footer is a COMPACT single line (DESIGN §2.2,
// §2.3, T15): it names who is asking and how to reach them, and never the worker's full question — the
// person reads and answers that in the worker's own session (`claude agents`), so a multi-paragraph
// question in the live frame would only bloat the bounded region and is exactly what made the streaming
// worst while a worker was parked. The model still carries `question` for anything that wants it; the
// live display does not draw it.
function footerLines(footer, summary) {
  switch (footer?.kind) {
    case 'asking': {
      const who = [footer.task, footer.slug].filter(Boolean).join(' ');
      return ['', `● ${who} — asking you; attach in \`claude agents\` to answer`];
    }
    case 'handoff':
      return ['', `✔ all ${summary.total} task(s) green on ${footer.branch} · tests pass. Yours to merge:`, `    git merge ${footer.branch}`];
    case 'red':
      return ['', `✗ ${summary.total} task(s) built on ${footer.branch}, but its tests fail — not ready to merge.`];
    case 'interrupted':
      return ['', '^C — closing workers… main is untouched. Re-run to resume from committed work.'];
    default:
      return [''];
  }
}

// createRenderer({ stream }) → { paint(display), line(text), close() } (DESIGN §2.3, T15).
//   paint(display) — on a TTY, enter the alternate screen on the first paint (hiding the cursor), then
//                    each frame home + clear + draw the frame clipped to the terminal size, so the block
//                    updates in place with a constant, bounded height and never wraps or scrolls; on a
//                    non-TTY, append the same lines plainly with no cursor escapes.
//   line(text)     — print a one-off line (a restart note, the final hand-off, a teardown message). On a
//                    TTY it leaves the alternate screen first, so the note lands on the normal screen
//                    rather than fighting the live frame; a following paint re-enters a fresh frame.
//   close()        — teardown: leave the alternate screen and show the cursor, once. The caller MUST
//                    call it on every exit path (coordinate.mjs), so the terminal is never left in the
//                    alternate screen with the cursor hidden — including on Ctrl-C.
export function createRenderer({ stream = process.stdout } = {}) {
  const isTTY = !!stream.isTTY;
  let spinIdx = 0;
  let inAlt = false; // currently showing the alternate-screen live frame
  let closed = false; // teardown done — no more in-place painting

  function write(s) {
    stream.write(s);
  }

  // Leave the alternate screen and restore the cursor, if we are in it. Used by both line() (so a
  // one-off note prints on the normal screen) and close() (teardown). Idempotent.
  function leaveAlt() {
    if (isTTY && inAlt) {
      write(SHOW_CURSOR + LEAVE_ALT);
      inAlt = false;
    }
  }

  return {
    paint(display) {
      const spinnerChar = SPINNER[spinIdx % SPINNER.length];
      spinIdx += 1;
      const lines = formatLines(display, { spinnerChar });

      if (!isTTY) {
        // Not a terminal: append plain lines, never a cursor escape (they garble a pipe and the harness
        // reads this as text, DESIGN §2.3). No in-place redraw, so nothing to remember or clip.
        write(lines.join('\n') + '\n');
        return;
      }

      if (closed) return; // teardown has run; the live frame is over

      // Enter the alternate screen once, hiding the cursor. Everything printed before this (the startup
      // notes) stays on the normal screen and is restored on close(), so the notes never fight the frame.
      if (!inAlt) {
        write(ENTER_ALT + HIDE_CURSOR);
        inAlt = true;
      }

      // Own the region: home, clear, then draw the frame clipped to the terminal so it cannot wrap or
      // scroll. Cap the height at `rows` and each line at `columns`; no trailing newline, so drawing the
      // bottom row never scrolls the alternate screen. Because the whole screen is cleared each frame, a
      // shorter frame leaves nothing behind — no cursor-math over wrapped lines (the T15 bug).
      const cols = Math.max(1, stream.columns || DEFAULT_COLS);
      const maxRows = Math.max(1, stream.rows || DEFAULT_ROWS);
      const drawn = lines.slice(0, maxRows).map((l) => clip(l, cols)).join('\n');
      write(HOME + CLEAR + drawn);
    },

    // A one-off line outside the live frame. On a TTY it leaves the alternate screen first so the note
    // lands on the normal screen (a following paint re-enters a fresh frame); on a non-TTY it is just a
    // line.
    line(text = '') {
      leaveAlt();
      write(`${text}\n`);
    },

    // Teardown: leave the alternate screen and show the cursor, once. Must be called on every exit path
    // so a crashed or Ctrl-C'd run never strands the terminal in the alternate screen with a hidden
    // cursor (T15 acceptance). Idempotent and safe on a non-TTY (a no-op).
    close() {
      leaveAlt();
      closed = true;
    },
  };
}
