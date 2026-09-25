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
//
// Colour (T16). On a colour TTY the renderer tints each line by the model's `kind` — active work cyan,
// done green, a parked worker amber and bold (the standout), idle dim, failure/Ctrl-C red — layered on
// the glyphs so colour is never the only signal. Like the cursor control it is a paint-time layer applied
// after clipping: `formatLines` and the non-TTY path stay escape-free, and NO_COLOR (or a non-TTY) turns
// it off, keeping the harness/pipe output plain text.

// The spinner frames, ticked one per paint (a real run paints once per pass / poll). A reduced-motion
// terminal is a person's setting the renderer cannot read here; the frames are plain Braille dots.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// The glyph per row kind. Active kinds spin; a parked worker is a filled dot (it wants the person); a
// merged task is a check; an idle task is a faint dot. The model carries the kind; these characters are
// the renderer's alone (DESIGN §2.3).
const GLYPH = {
  preparing: null,
  building: null, // the spinner frame — filled in at paint time
  reviewing: null,
  merging: null,
  'fixing-conflict': null, // working, so it spins like the other active rows
  asking: '●',
  conflict: '●',
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

// The colour codes (SGR), applied at paint time on a TTY only — never inside the content `formatLines`
// produces (a test guards that block escape-free) and never on a non-TTY stream (the harness and any
// pipe read stdout as text, DESIGN §2.3). Colour is layered on top of the glyphs the model already
// carries, so it is never the only signal — a colour-blind reader or a NO_COLOR terminal loses nothing.
// The map is by the model's row/footer `kind`, resolved to one of these styles (T16, PM 2026-09-20):
//   active (preparing/building/reviewing/merging) cyan · done green · asking amber+bold (the standout) ·
//   idle dim · red/interrupted red · a merge conflict orange+bold (256-colour 208; user 2026-09-24), so
//   it reads apart from a question. RESET closes every coloured span.
const SGR = {
  done: '\x1b[32m', // green
  active: '\x1b[36m', // cyan
  asking: '\x1b[1;33m', // bold amber — the parked pointer and its row stand out
  idle: '\x1b[2m', // dim grey
  red: '\x1b[31m', // failure / interrupted
  conflict: '\x1b[1;38;5;208m', // bold orange — a merge conflict waiting for the paste-in prompt
};
const RESET = '\x1b[0m';

// Wrap already-clipped text in its colour when colour is on and the style resolves to a real code;
// otherwise return the text untouched, so the no-colour path is byte-identical to what T15 drew.
function colourize(text, style, on) {
  return on && style && SGR[style] ? `${SGR[style]}${text}${RESET}` : text;
}

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

// The style per row/footer `kind`, mapping the model's kinds onto the SGR colours (T16). Active phases
// share cyan; a parked worker is the amber-bold standout; done is green; an idle task is dim. A kind with
// no entry (or a null style) paints plain. This is the renderer's, like GLYPH — the model carries `kind`.
const ROW_STYLE = {
  preparing: 'active',
  building: 'active',
  reviewing: 'active',
  merging: 'active',
  'fixing-conflict': 'active', // the worker was sent the fix and is working (live-workers §2.10)
  asking: 'asking',
  conflict: 'conflict',
  done: 'done',
  waiting: 'idle',
  queued: 'idle',
};

// The single source of truth for the display's line ordering AND each line's colour style: the summary
// line, then one line per row, then the footer lines. Each entry is `{ text, style }` where `style` is a
// key into SGR or null for plain. `formatLines` is its text projection (escape-free) and `paint` uses the
// styles to colour on a TTY — deriving both from this one helper is what stops the styles ever drifting
// out of step with the lines they colour.
export function styledLines(display, { spinnerChar = SPINNER[0] } = {}) {
  const { summary, rows, footer, branch } = display;
  const out = [summaryLine(summary, footer, branch, spinnerChar)];
  for (const r of rows) out.push(rowLine(r, spinnerChar));
  for (const f of footerLines(footer, summary, spinnerChar)) out.push(f);
  return out;
}

// The block of plain-text lines for a display, given the current spinner character. No escapes here —
// this is the same content whether it is painted in place (TTY) or appended (non-TTY); the cursor control
// and the colour around it are added by paint, TTY-only. Exported so a test can assert the content
// without any escapes. It is the text projection of styledLines, so the ordering can never diverge.
export function formatLines(display, opts) {
  return styledLines(display, opts).map((l) => l.text);
}

function summaryLine(summary, footer, branch, spinnerChar) {
  // The header takes a colour only when the run has ended: green when finished, red when interrupted.
  // A run in progress keeps a neutral header — the status colour lives on the rows.
  if (footer?.kind === 'interrupted') {
    return { text: `✗ ${branch || 'run'} interrupted`, style: 'red' };
  }
  if (summary.finished) {
    return { text: `✓ ${branch || 'run'} · ${summary.done}/${summary.total} done`, style: 'done' };
  }
  // Every task merged but the end gate still running: the spinner keeps ticking so the run does not read
  // as finished or frozen while the suite takes its minutes (user 2026-09-25).
  if (footer?.kind === 'testing') {
    return { text: `${spinnerChar} ${branch || 'run'} · ${summary.done}/${summary.total} done · running the tests`, style: null };
  }
  const parts = [`${summary.done}/${summary.total} done`, `${summary.running} running`];
  if (summary.asking > 0) parts.push(`${summary.asking} asking you`);
  if (summary.conflicts > 0) parts.push(`${summary.conflicts} merge conflict${summary.conflicts === 1 ? '' : 's'}`);
  parts.push(`${summary.waiting} waiting`);
  const ceiling = summary.ceiling != null ? ` · ceiling ${summary.ceiling}${summary.ceilingFull ? ' (full)' : ''}` : '';
  return { text: `${spinnerChar} ${branch || 'run'} · ${parts.join(' · ')}${ceiling}`, style: null };
}

function rowLine(r, spinnerChar) {
  const glyph = GLYPH[r.kind] === null || GLYPH[r.kind] === undefined ? spinnerChar : GLYPH[r.kind];
  // For an idle/queued row the glyph is a faint dot; keep the columns aligned enough to read.
  const g = r.kind === 'waiting' || r.kind === 'queued' ? '·' : glyph;
  const id = r.id.padEnd(4);
  const slug = (r.slug ?? '').padEnd(22);
  const label = r.label.padEnd(24);
  const el = fmtElapsed(r.elapsedMs);
  const text = `  ${g} ${id} ${slug} ${label} ${el}`.replace(/\s+$/, '');
  return { text, style: ROW_STYLE[r.kind] ?? null };
}

// The footer, in the model's kinds. The parked-worker footer is a COMPACT single line (DESIGN §2.2,
// §2.3, T15): it names who is asking and how to reach them, and never the worker's full question — the
// person reads and answers that in the worker's own session (`claude agents`), so a multi-paragraph
// question in the live frame would only bloat the bounded region and is exactly what made the streaming
// worst while a worker was parked. The model still carries `question` for anything that wants it; the
// live display does not draw it.
function footerLines(footer, summary, spinnerChar = SPINNER[0]) {
  const blank = { text: '', style: null };
  switch (footer?.kind) {
    case 'asking': {
      const who = [footer.task, footer.slug].filter(Boolean).join(' ');
      // Amber-bold so the one thing needing the person cannot be missed (T16). The full question is still
      // not drawn here — the person reads and answers it in the worker's own session (§2.2, T15).
      return [blank, { text: `● ${who} — asking you; attach in \`claude agents\` to answer`, style: 'asking' }];
    }
    case 'conflict': {
      // The prompt itself is multi-line, so it is not drawn in this bounded block: `pir` shows it under the
      // live view, and the coordinator's own screen prints it once when the conflict happens (T14).
      const who = [footer.task, footer.slug].filter(Boolean).join(' ');
      return [blank, { text: `● ${who} — merge conflict; paste the prompt shown in \`pir\` into its worker`, style: 'conflict' }];
    }
    case 'handoff':
      return [
        blank,
        { text: `✔ all ${summary.total} task(s) green on ${footer.branch} · tests pass. Yours to merge:`, style: 'done' },
        { text: `    git merge ${footer.branch}`, style: 'done' },
      ];
    case 'red': {
      const lines = [blank, { text: `✗ ${summary.total} task(s) built on ${footer.branch}, but its tests fail — not ready to merge.`, style: 'red' }];
      // The second line is the gate's reason and log path (DESIGN §2.8), so the person watching knows what
      // failed and where to read it. An old snapshot carries neither, and gets no second line.
      const why = [footer.reason, footer.logPath && `output: ${footer.logPath}`].filter(Boolean).join(' · ');
      if (why) lines.push({ text: `  ${why}`, style: 'red' });
      return lines;
    }
    case 'testing': {
      const el = fmtElapsed(footer.elapsedMs);
      const text = `${spinnerChar} all ${summary.total} task(s) merged · running the plan's setup and tests on ${footer.branch}${el ? ` · ${el}` : ''}`;
      return [blank, { text, style: 'active' }];
    }
    case 'interrupted':
      return [blank, { text: '^C — closing workers… main is untouched. Re-run to resume from committed work.', style: 'red' }];
    default:
      return [blank];
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
export function createRenderer({ stream = process.stdout, colour } = {}) {
  const isTTY = !!stream.isTTY;
  // Colour only on a TTY, and honour NO_COLOR (any value disables it, the de-facto standard). Injectable
  // via `colour` for tests; a non-TTY stream is never coloured even if `colour: true` is passed, so the
  // harness/pipe invariant — zero escapes reach a non-terminal (DESIGN §2.3) — holds absolutely.
  const useColour = isTTY && (colour ?? !('NO_COLOR' in process.env));
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
      const styled = styledLines(display, { spinnerChar });

      if (!isTTY) {
        // Not a terminal: append plain lines, never a cursor or colour escape (they garble a pipe and the
        // harness reads this as text, DESIGN §2.3). No in-place redraw, so nothing to remember or clip.
        write(styled.map((l) => l.text).join('\n') + '\n');
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
      // Clip the visible text first (T15's no-wrap guarantee), then wrap the already-clipped text in its
      // colour. The SGR codes add bytes but no visible width, so the per-line clip and the row budget are
      // exactly as T15 left them; colour is off unless this is a colour TTY, so the frame is byte-identical
      // to before when it is not.
      const drawn = styled
        .slice(0, maxRows)
        .map(({ text, style }) => colourize(clip(text, cols), style, useColour))
        .join('\n');
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
