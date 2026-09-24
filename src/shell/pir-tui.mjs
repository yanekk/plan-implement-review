// The dashboard as a live terminal application (DESIGN §2.3, §2.4, §2.6, §2.7, §2.11; T12). This is the
// raw-mode painting and input loop that wires the already-pure pieces to a real terminal: the cross-repo
// list (buildDashboard/dashboardReducer, T04), the live view (buildDisplay + render.mjs's styledLines,
// reused unchanged so the watch frame is the coordinator's own display, §2.4), liveness/classification
// (T01/T05), the index and snapshot stores (T06/T07), and stop/remove (T09).
//
// The split mirrors render.mjs's own: everything a person could check is a pure builder here —
// buildListFrame, buildWatchFrame, decodeKey — tested exhaustively without a TTY; only the in-place
// painting and the feel of moving and opening need a person at a real terminal (§5.1, T12). So the frame
// builders emit STYLED LINES (arrays of `{ text, style }` spans) as data, exactly the way render.mjs's
// styledLines does, and createScreen is the one impure piece that turns them into escapes on a TTY.
//
// Why the list is new painting but the live view is not (§2.11): the list's semantic colours are this
// task's to build (running green, crashed red, finished/stopped dim, the progress bar blue/red/dim, the
// selected row's blue left edge, the amber-bold armed line). The live view MUST be the coordinator's
// renderer, not a second one that drifts — so its lines come straight from render.mjs's styledLines and
// are painted with render.mjs's exact style→colour mapping (the SGR block below carries render's keys
// unchanged alongside the list's), which keeps the watch frame byte-for-byte the coordinator's display.

import { join } from 'node:path';
import { readLogTail } from './commands.mjs';

import { buildDisplay } from '../core/display.mjs';
import { buildDashboard, dashboardReducer, initialUi } from '../core/dashboard.mjs';
import { styledLines } from './render.mjs';
import { classifyRun } from '../core/runstate.mjs';
import { resolveLiveness } from './identity.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { stopRun, removeRun } from './control-run.mjs';
import { createPlatform } from './platform.mjs';

// The spinner frames, one per refresh (a poll tick). The SAME Braille frames render.mjs uses, so a live
// run painted here spins identically to the same run painted by pir-coordinate (§2.4). render.mjs does
// not export them, so they are duplicated here rather than reaching across into its internals.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// The cursor-control escapes (a stable terminal protocol, not a choice): enter and leave the alternate
// screen so the dashboard never scrolls the person's scrollback and vanishes cleanly on exit; hide and
// show the cursor; home to the top-left; erase-to-end-of-line and erase-to-end-of-screen.
//
// The dashboard repaints several times a second (unlike the coordinator's once-per-pass), so it must NOT
// blank the whole screen each frame the way render.mjs does with `2J` — that blank-then-redraw is a
// visible flicker and reads as the selection "dropping" on every refresh (user 2026-09-22). Instead it
// homes, overwrites each line clearing that line's leftovers with EL, and clears anything below the last
// line with ED. The screen is only ever overwritten in place, never blanked, so a refresh no longer
// flashes.
const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';
const ERASE_EOL = '\x1b[K'; // erase from the cursor to the end of the line
const ERASE_EOS = '\x1b[J'; // erase from the cursor to the end of the screen
const RESET = '\x1b[0m';

// The style→colour (SGR) map. It carries TWO vocabularies. The first block is render.mjs's own row/footer
// keys with render.mjs's exact codes, so the watch frame — whose lines come from render.mjs's styledLines
// — colours byte-for-byte the way the coordinator paints it (§2.4). The second block is the list's §2.11
// semantic colours, this task's to build: running green, crashed red, finished/stopped dim; the progress
// bar blue for a running run, red for a crashed one, dim otherwise; the selected row's blue left edge; the
// running/crashed counts green/red; the faint key-hint footer; the amber-bold armed confirmation line.
const SGR = {
  // render.mjs's live-view keys — kept identical so the reused watch frame matches the coordinator.
  done: '\x1b[32m', // green
  active: '\x1b[36m', // cyan
  asking: '\x1b[1;33m', // bold amber
  idle: '\x1b[2m', // dim
  red: '\x1b[31m', // failure / interrupted
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
};

// Sensible sizes when a TTY does not report its dimensions (render.mjs's defaults).
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// The list's column widths. Not binding (§2.11: exact terminal spacing is the builder's, not the mock's);
// chosen to line up the five columns the dashboard scans — slug, state, repo, progress, workers.
const COL = { marker: 2, slug: 16, state: 12, repo: 20, progress: 16 };

// span(text, style) / lineOf(text, style) — the two shapes a frame is built from. A frame is an array of
// LINES; a line is an array of SPANS; a span is `{ text, style }` where style is a key into SGR (or null
// for plain). One line can carry several differently-coloured spans (a list row does); a single-colour
// line is just one span. This is the same data render.mjs's styledLines emits, one level richer (many
// spans per line) so a row can colour its state and its progress bar independently.
const span = (text, style = null) => ({ text, style });
const lineOf = (text, style = null) => [span(text, style)];

// Right-pad (or truncate) a string to exactly `n` visible characters, counted by code point so a glyph
// like the state's ● counts as one. Truncation keeps the columns from drifting when a slug or repo is long.
function pad(s, n) {
  const chars = [...String(s ?? '')];
  if (chars.length >= n) return chars.slice(0, n).join('');
  return chars.join('') + ' '.repeat(n - chars.length);
}

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

// readLogTail lives in commands.mjs (the setup runner needs it too); re-exported for this file's callers.
export { readLogTail };

// The state cell: the glyph+word and its §2.11 colour. running green (●), finished dim (◌), crashed red
// (✕), stopped dim (◼). An unrecognised state (an unreachable/stale index entry, §2.8) shows its raw
// value uncoloured rather than being forced into one of the four.
function stateCell(state) {
  switch (state) {
    case 'running':
      return { text: '● running', style: 'running' };
    case 'finished':
      return { text: '◌ finished', style: 'ended' };
    case 'crashed':
      return { text: '✕ crashed', style: 'crashed' };
    case 'stopped':
      return { text: '◼ stopped', style: 'ended' };
    default:
      return { text: String(state ?? 'unknown'), style: null };
  }
}

// The progress cell: a small bar plus the done/total fraction, coloured by state (§2.11: blue running,
// red crashed, dim otherwise). The bar is `▰` filled / `▱` empty over a fixed width, the same shape the
// prototype used; it is a scan aid, not data the person acts on, so its exact width is the builder's.
const BAR_WIDTH = 8;
function progressCell(state, { done = 0, total = 0 } = {}) {
  const filled = total > 0 ? Math.round((done / total) * BAR_WIDTH) : 0;
  const bar = '▰'.repeat(filled) + '▱'.repeat(BAR_WIDTH - filled);
  const style = state === 'crashed' ? 'bar-crash' : state === 'running' ? 'bar-run' : 'bar-idle';
  return { text: `${bar} ${done}/${total}`, style };
}

// The footer line: the armed confirmation when a chord is half-pressed (amber-bold, §2.7), else the faint
// key hint for the current view. The armed line names the run and what the second press does, matching
// `claude agents`' guard; any other key clears `armed` in the reducer, so this line is shown only while a
// confirm is genuinely pending.
function footerLine(context, ui) {
  if (ui.armed) {
    if (ui.armed.action === 'stop') {
      return lineOf(`⚠ Ctrl+S again to stop ${ui.armed.slug} now — this kills its in-flight workers`, 'armed');
    }
    return lineOf(`⚠ Ctrl+X again to remove ${ui.armed.slug}'s record`, 'armed');
  }
  if (context === 'watch') return lineOf('← back · Ctrl+S Ctrl+S stop this run · esc quit', 'hint');
  return lineOf('↑↓ move · ↵ open · Ctrl+S stop · Ctrl+X remove · esc quit', 'hint');
}

// buildListFrame(dashboard, ui) → frame (DESIGN §2.3, §2.11).
//
//   dashboard = { rows, counts } — buildDashboard's output (T04). rows are the resolved run views in the
//               order the caller sorted them; counts is the tallies line's source.
//   ui        = { sel, armed, … } — the reducer's navigation state; sel marks the highlighted row and
//               armed drives the confirmation footer.
//
// With no rows it paints the get-started line in place of an empty list (§2.3, user decision §7): a blank
// screen reads as broken on a first open. Otherwise: the title, a column header, one row per run, the
// counts line, and the footer. Each row's spans are coloured by §2.11; the selected row carries a blue
// left-edge marker (the terminal stand-in for the mock's blue border).
export function buildListFrame(dashboard, ui = initialUi()) {
  const { rows = [], counts = { running: 0, finished: 0, crashed: 0, stopped: 0, total: 0 } } = dashboard ?? {};
  const lines = [];

  lines.push([span('pir', 'head'), span('  runs on this machine', 'dim')]);
  lines.push([]); // a blank spacer line

  if (rows.length === 0) {
    lines.push(lineOf('  No runs yet — start one with `pir {slug}`', 'dim'));
  } else {
    lines.push(
      lineOf(
        '  ' + pad('SLUG', COL.slug) + pad('STATE', COL.state) + pad('REPO', COL.repo) + pad('PROGRESS', COL.progress) + 'WK',
        'dim',
      ),
    );
    rows.forEach((v, i) => {
      const selected = i === ui.sel;
      // A run is "live" only while running; a non-running run's slug is dimmed so the eye lands on the
      // active ones. The state colour lives on the state cell, separately, so both signals show at once.
      const live = v.state === 'running';
      const st = stateCell(v.state);
      const prog = progressCell(v.state, v.progress);
      lines.push([
        span(selected ? '▎ ' : '  ', selected ? 'selected' : null),
        span(pad(v.slug, COL.slug), live ? null : 'dim'),
        span(pad(st.text, COL.state), st.style),
        span(pad(v.repo, COL.repo), 'dim'),
        span(pad(prog.text, COL.progress), prog.style),
        span(v.workers > 0 ? String(v.workers) : '·', 'dim'),
      ]);
    });
  }

  lines.push([]);
  lines.push(countsLine(counts));
  lines.push([]);
  lines.push(footerLine('list', ui));
  return lines;
}

// The counts line (§2.3, §2.11): the total, then the running count green and the crashed count red, with
// finished (and stopped, when any) dim between them. The colours match the list rows so the tallies read
// as a summary of the same states.
function countsLine(counts) {
  const spans = [
    span(`${counts.total} run${counts.total === 1 ? '' : 's'} · `, 'dim'),
    span(`${counts.running} running`, 'count-run'),
    span(` · ${counts.finished} finished · `, 'dim'),
    span(`${counts.crashed} crashed`, 'count-crash'),
  ];
  if (counts.stopped > 0) spans.push(span(` · ${counts.stopped} stopped`, 'dim'));
  return spans;
}

// watchDisplayLines(snap, { now, spinnerChar }) → the live block's styled lines, straight from render.mjs.
//
// This is the whole point of §2.4: the front-end does not invent a display, it reads the run's snapshot
// (whose runState is exactly what buildDisplay consumes) and paints it with the ALREADY-BUILT model and
// renderer. So these lines are render.mjs's styledLines over buildDisplay's output, unchanged — their text
// is identical to render.mjs's formatLines(buildDisplay(runState, { now })), which is what makes the watch
// frame the coordinator's display and not a second rendering that could drift from it.
export function watchDisplayLines(snap, { now, spinnerChar = SPINNER[0] } = {}) {
  return styledLines(buildDisplay(snap.runState, { now }), { spinnerChar });
}

// buildWatchFrame(view, { now, spinnerChar, ui, columns, logTail }) → frame (DESIGN §2.4, §2.11).
//
//   view    = { slug, state, repo, snap, record } — one resolved run (the selected/open one). snap is its
//             last-read snapshot, or null if it has not written one yet.
//   columns = the terminal width, so the prose and path notes WRAP to fit rather than being clipped off
//             the right edge (user 2026-09-22). The live block itself is not wrapped — it is the
//             coordinator's frame and stays clipped like render.mjs.
//   logTail = the last few lines of the run's run.log (readLogTail), shown inline for a crashed run so the
//             person sees why it died without opening the file (user 2026-09-22); null for none.
//
// The frame is a thin header (slug, state, repo, and — while running — the pid and the awake note), the
// live block, and, for a run that is NOT running, a stale note saying the frame is old and how `pir {slug}`
// resumes it (§2.4: painting a stale snapshot plainly is more honest than a blank screen). A crashed run
// also shows the tail of its log and the full log path. A run with no snapshot yet shows a waiting line.
// The spinner ticks only while the run is running; a stale frame's glyph is a static dot.
export function buildWatchFrame(view, { now, spinnerChar = SPINNER[0], ui = initialUi(), columns = DEFAULT_COLS, logTail = null } = {}) {
  const { slug, state, repo, snap, record } = view ?? {};
  const lines = [];
  const cols = Math.max(20, columns | 0 || DEFAULT_COLS);

  // The run's log lives beside its snapshot in the control folder; a crashed run wrote its reason there
  // (a coordinator that refused to start writes ONLY run.log). Name the absolute path so a person can open
  // it — most terminals linkify a bare absolute path — rather than leaving them to hunt for it.
  const controlDir = record?.controlDir ?? view?.controlDir ?? null;
  const logPath = controlDir ? join(controlDir, 'run.log') : null;

  // Push a note WRAPPED to the terminal width, so a long path or sentence spills onto the next line
  // instead of being cut off. The text is wrapped to the width MINUS the indent and every segment is then
  // indented, so continuation lines line up under the first and a long unbreakable token (a path) never
  // produces an empty leading line by breaking on the indent's own spaces.
  const note = (text, style, indent = '  ') => {
    const width = Math.max(1, cols - [...indent].length);
    for (const seg of wrapLine(text, width)) lines.push(lineOf(indent + seg, style));
  };
  // The tail of run.log, each line wrapped, under a heading — the inline preview of why a run died.
  const pushLogTail = () => {
    if (!logTail || logTail.length === 0) return;
    lines.push([]);
    lines.push(lineOf('  last lines of run.log:', 'dim'));
    for (const raw of logTail) note(raw.replace(/\s+$/, ''), 'dim', '    ');
  };

  const st = stateCell(state);
  const alive = state === 'running';
  const tail = `  · ${repo ?? ''}${alive && record?.pid ? ` · pid ${record.pid} · holding Mac awake` : ''}`;
  lines.push([span(slug ?? '', 'head'), span('  ', null), span(st.text, st.style), span(tail, 'dim')]);
  lines.push([]);

  if (snap == null) {
    // No snapshot on disk, so there is NO frame to show — say that plainly rather than claim a stale frame
    // that does not exist. A running run has not painted its first pass yet; an ENDED run with no snapshot
    // never got that far, which in practice means it failed to start (the coordinator refused and wrote
    // only run.log). The log tail and path turn "crashed" into a reason a person can act on.
    if (alive) {
      note('waiting for the first snapshot…', 'dim');
    } else if (state === 'crashed') {
      note('no snapshot recorded — this run ended before it painted a frame. It likely failed to start.', 'crashed');
      pushLogTail();
      lines.push([]);
      note('full log:', 'dim');
      note(logPath ?? "run.log in the run's control folder", 'dim', '    ');
      note(`Esc quits pir; then \`pir ${slug}\` retries it.`, 'dim');
    } else if (state === 'finished') {
      note(`no snapshot recorded — finished. Hand-off: git merge ${record?.branch ?? `pir/${slug}`}`, 'ended');
    } else if (state === 'stopped') {
      note(`no snapshot recorded — stopped. \`pir ${slug}\` resumes from committed work.`, 'ended');
    } else {
      note('no snapshot recorded.', 'dim');
    }
  } else {
    // A stale (non-running) frame freezes its spinner to a dot so it cannot read as still ticking.
    const spin = alive ? spinnerChar : '·';
    for (const l of watchDisplayLines(snap, { now, spinnerChar: spin })) lines.push([span(l.text, l.style)]);
    // The stale marker for a run that has ended (§2.4) — shown ONLY when there is a real frozen frame
    // above it. Red for crashed (something went wrong), dim for a clean finished/stopped end.
    if (state !== 'running') {
      lines.push([]);
      if (state === 'crashed') {
        note('— process died mid-pass; this frame is stale.', 'crashed', '');
        pushLogTail();
        if (logPath) {
          lines.push([]);
          note('full log:', 'dim');
          note(logPath, 'dim', '    ');
        }
        note(`← back to the list; \`pir ${slug}\` resumes it.`, 'dim');
      } else if (state === 'finished') {
        note(`— finished · this frame is stale. Hand-off: git merge ${record?.branch ?? `pir/${slug}`}`, 'ended', '');
      } else if (state === 'stopped') {
        note(`— stopped · this frame is stale. \`pir ${slug}\` resumes from committed work.`, 'ended', '');
      }
    }
  }

  lines.push([]);
  lines.push(footerLine('watch', ui));
  return lines;
}

// decodeKey(data) → the intent for a keypress, or null for a key the dashboard does not bind.
//
//   ↑ / ↓ arrows → 'up' / 'down'      (move the selection)
//   ← arrow      → 'back'             (step back one level: a run's live view → the list; user 2026-09-22)
//   → arrow      → 'open'             (open the selected run into its live view, same as Enter; user 2026-09-22)
//   Enter        → 'open'             (open the selected run into its live view)
//   Esc          → 'quit'             (leave `pir` — from the list or a run's view)
//   Ctrl+S       → 'ctrlS'            (arm / confirm stop)
//   Ctrl+X       → 'ctrlX'            (arm / confirm remove)
//   Ctrl+C       → 'quit'             (leave `pir` at once)
//
// Back and quit are split across two keys at the user's direction (2026-09-22): ← walks back a level, Esc
// leaves outright — rather than the original Esc-steps-back-then-quits from the prototype (DESIGN §2.4,
// §2.11). 'back' and 'quit' are the loop's own intents, not reducer events; the loop translates a ← in the
// live view into the reducer's 'back' and ignores it in the list, where there is no level to step back to.
//
// It decodes a whole input chunk. In raw mode an arrow arrives as its full 3-byte escape sequence in one
// chunk, while a lone Esc arrives as the single byte 0x1b — which is how the same 0x1b prefix reads as
// 'quit' on its own but as part of an arrow in a sequence. A human-paced TUI never splits an arrow across
// chunks in practice; a stray fragment simply decodes to null and is ignored.
export function decodeKey(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
  if (b.length === 1) {
    switch (b[0]) {
      case 0x0d: // CR
      case 0x0a: // LF
        return 'open';
      case 0x1b: // lone Esc
        return 'quit';
      case 0x13: // Ctrl+S (DC3)
        return 'ctrlS';
      case 0x18: // Ctrl+X (CAN)
        return 'ctrlX';
      case 0x03: // Ctrl+C (ETX)
        return 'quit';
      default:
        return null;
    }
  }
  const s = b.toString('latin1');
  // The two arrow encodings terminals emit: CSI (`\x1b[A`) and the application-cursor SS3 (`\x1bOA`).
  if (s === '\x1b[A' || s === '\x1bOA') return 'up';
  if (s === '\x1b[B' || s === '\x1bOB') return 'down';
  if (s === '\x1b[D' || s === '\x1bOD') return 'back'; // ← steps back a level
  if (s === '\x1b[C' || s === '\x1bOC') return 'open'; // → opens the selected run, like Enter (user 2026-09-22)
  return null; // anything else is unbound
}

// --- The impure edge: painting a frame on a real terminal, and the input loop -----------------------

// createScreen({ stream, colour }) → { paint(frame), close() }. The one impure piece: it turns the styled
// frames the builders emit into escapes on a TTY, owning a bounded region exactly as render.mjs does —
// enter the alternate screen once (hiding the cursor), then each frame home + clear + draw clipped to the
// terminal size so nothing wraps or scrolls (the T15 discipline). On a non-TTY it appends plain text with
// no escapes, so a pipe or the test harness reads it as text. close() leaves the alternate screen and
// shows the cursor, once, and must run on every exit path (the loop's finally block).
export function createScreen({ stream = process.stdout, colour } = {}) {
  const isTTY = !!stream.isTTY;
  // Colour only on a TTY, and honour NO_COLOR (the de-facto standard), matching render.mjs so the two
  // agree on when the live view is coloured.
  const useColour = isTTY && (colour ?? !('NO_COLOR' in process.env));
  let inAlt = false;
  let closed = false;

  function colourize(text, style) {
    return useColour && style && SGR[style] ? `${SGR[style]}${text}${RESET}` : text;
  }

  // Clip a line's spans to at most `cols` visible columns, counted by code point across the whole line, so
  // a multi-span row truncates as one line and never wraps (the T15 no-wrap guarantee, extended to spans).
  function clipLine(lineSpans, cols) {
    const out = [];
    let used = 0;
    for (const sp of lineSpans) {
      if (used >= cols) break;
      const chars = [...sp.text];
      if (used + chars.length <= cols) {
        out.push(sp);
        used += chars.length;
      } else {
        out.push({ text: chars.slice(0, cols - used).join(''), style: sp.style });
        used = cols;
        break;
      }
    }
    return out;
  }

  function leaveAlt() {
    if (isTTY && inAlt) {
      stream.write(SHOW_CURSOR + LEAVE_ALT);
      inAlt = false;
    }
  }

  return {
    paint(frame) {
      if (!isTTY) {
        // Not a terminal: append plain lines, never an escape (they garble a pipe and the harness reads
        // this as text). No in-place redraw, so nothing to clip or remember.
        stream.write(frame.map((l) => l.map((s) => s.text).join('')).join('\n') + '\n');
        return;
      }
      if (closed) return;

      if (!inAlt) {
        stream.write(ENTER_ALT + HIDE_CURSOR);
        inAlt = true;
      }

      const cols = Math.max(1, stream.columns || DEFAULT_COLS);
      const maxRows = Math.max(1, stream.rows || DEFAULT_ROWS);
      // Home, then each line's clipped/coloured content followed by EL (clear its leftovers), then ED
      // after the last line (clear any rows a taller previous frame left below). No full-screen blank, so
      // no flicker. `\n` returns to column 0 in the alternate screen exactly as render.mjs relies on.
      const drawn = frame
        .slice(0, maxRows)
        .map((lineSpans) => clipLine(lineSpans, cols).map((s) => colourize(s.text, s.style)).join('') + ERASE_EOL)
        .join('\n');
      stream.write(HOME + drawn + ERASE_EOS);
    },

    close() {
      leaveAlt();
      closed = true;
    },
  };
}

// loadDashboard({ dir, now, kill, exec, fs }) → { rows, counts }. The read half of a refresh (DESIGN §3.4):
// enumerate every index entry (T06), resolve each run's liveness (T05) and classify it (T01), read its
// snapshot (T07) for the progress/worker detail, then project the lot through buildDashboard (T04). Each
// row carries its record and snapshot alongside the fields the list needs, so the loop can act (stop/remove)
// and paint the watch view from the same read. Rows are sorted by repo then slug for a stable list order,
// since listRecords returns them in no guaranteed order.
export function loadDashboard({ dir = indexDir(), now = Date.now(), kill, exec, fs } = {}) {
  const records = listRecords({ dir, fs });
  const views = records.map((record) => {
    const { alive, liveStartTime } = resolveLiveness(record.pid, { kill, exec });
    const state = classifyRun({
      recordedStartTime: record.startTime,
      finalState: record.finalState,
      alive,
      liveStartTime,
    });
    const snap = readSnapshot(record.controlDir, fs ? { fs } : {});
    const display = snap ? buildDisplay(snap.runState, { now }) : null;
    const progress = display
      ? { done: display.summary.done, total: display.summary.total }
      : { done: 0, total: 0 };
    // The live-worker count is the number of active workers this pass — exactly buildDisplay's `running`
    // tally (the active phases, DESIGN §2.4), so the list and the live view agree on it.
    const workers = display ? display.summary.running : 0;
    return { slug: record.slug, state, repo: record.repo, progress, workers, snap, record, controlDir: record.controlDir };
  });
  views.sort((a, b) => a.repo.localeCompare(b.repo) || a.slug.localeCompare(b.slug));
  return buildDashboard(views);
}

// The default platform for a stop's worker-reap (control-run.mjs escalates to platform.list()/close() only
// when a wedged coordinator will not exit). Built against the run's own repo so it lists that repo's
// sessions. No transport is needed — stop never reads the worker inbox — so none is passed.
function defaultPlatform(record) {
  return createPlatform({ root: record.repoPath });
}

// openDashboard(deps) / openWatch(slug, deps) — the two entry points pir.mjs (T11) dispatches to. The
// dashboard opens on the list; the watch form opens straight into a run's live view (`pir {slug}` drops
// into the run it just started/opened, §2.1), and ← from there steps back to the list like any other open
// run (Esc quits pir; user 2026-09-22). Both run the one loop below.
export function openDashboard(deps = {}) {
  return runTui({ ...deps, initial: initialUi() });
}

export function openWatch(slug, deps = {}) {
  return runTui({ ...deps, initial: { view: 'watch', sel: 0, openSlug: slug, armed: null } });
}

// runTui — the raw-mode input/paint loop (DESIGN §2.3, §2.4, §5.1). It sets raw mode, paints a first
// frame, then repaints on every keypress (through dashboardReducer, T04) and on a short refresh poll
// (§2.4: watch the snapshot by polling, the safe default). It ALWAYS restores raw mode and leaves the
// alternate screen on exit — a clean quit, a stop/remove error, or a paint throw — via the finally block,
// so the terminal is never left in raw mode or the alternate screen (the T15/close discipline, extended to
// the input side). Everything the tests must not really do is injected: stdin/stdout, the clock, the
// process boundary (kill/exec), the loader, and stop/remove.
async function runTui({
  stdin = process.stdin,
  stdout = process.stdout,
  now = Date.now,
  env = process.env,
  kill,
  exec,
  fs,
  refreshMs = 500,
  colour,
  makeScreen = createScreen,
  load = loadDashboard,
  stop = stopRun,
  remove = removeRun,
  makePlatform = defaultPlatform,
  initial = initialUi(),
} = {}) {
  const dir = indexDir({ env });
  const screen = makeScreen({ stream: stdout, colour });
  let ui = initial;
  let spin = 0;
  // The selection is pinned to a RUN (its slug), not to a row index, so a refresh never moves the
  // highlight even if the list changes underneath it (user 2026-09-22: "the selection keeps dropping
  // because of the refresh"). onData writes the slug the user moved to; repaint re-derives the index from
  // it each frame, and only falls back to clamping the old index if that run is no longer listed.
  let selectedSlug = null;

  const read = () => load({ dir, now: now(), kill, exec, fs });

  function repaint(dashboard) {
    const dash = dashboard ?? read();
    let sel = ui.sel;
    if (selectedSlug != null) {
      const idx = dash.rows.findIndex((r) => r.slug === selectedSlug);
      if (idx >= 0) sel = idx;
      else selectedSlug = null; // the pinned run is gone (removed) — fall back to the clamped index
    }
    sel = Math.max(0, Math.min(sel, Math.max(0, dash.rows.length - 1)));
    ui = { ...ui, sel };
    if (selectedSlug == null) selectedSlug = dash.rows[sel]?.slug ?? null; // seed / reseed the pin

    spin += 1;
    const spinnerChar = SPINNER[spin % SPINNER.length];
    if (ui.view === 'watch') {
      const view = dash.rows.find((r) => r.slug === ui.openSlug) ?? { slug: ui.openSlug, state: 'crashed', repo: '', snap: null };
      // A crashed run's log tail is shown inline; read it only for the open, crashed run (not every row).
      const logTail = view.state === 'crashed' ? readLogTail(view.record?.controlDir ? join(view.record.controlDir, 'run.log') : null, 5, fs ? { fs } : {}) : null;
      const columns = Math.max(20, stdout.columns || DEFAULT_COLS);
      screen.paint(buildWatchFrame(view, { now: now(), spinnerChar, ui, columns, logTail }));
    } else {
      screen.paint(buildListFrame(dash, ui));
    }
  }

  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
  if (typeof stdin.resume === 'function') stdin.resume();

  try {
    await new Promise((resolve, reject) => {
      let refresh = null;

      function cleanup() {
        if (refresh) clearInterval(refresh);
        if (typeof stdin.off === 'function') stdin.off('data', onData);
        else if (typeof stdin.removeListener === 'function') stdin.removeListener('data', onData);
      }
      function finish() {
        cleanup();
        resolve();
      }
      function fail(err) {
        cleanup();
        reject(err);
      }

      async function onData(data) {
        try {
          const key = decodeKey(data);
          if (key === 'quit') return finish(); // Esc or Ctrl+C: leave pir
          if (key == null) return;
          const dash = read();

          if (key === 'back') {
            // ← steps back a level: a run's live view → the list. In the list there is no level to step
            // back to (Esc quits), so ← is inert there.
            if (ui.view === 'watch') ui = dashboardReducer(ui, { type: 'back' }, dash.rows).ui;
            selectedSlug = dash.rows[ui.sel]?.slug ?? selectedSlug;
            return repaint(dash);
          }

          const { ui: nextUi, intent } = dashboardReducer(ui, { type: key }, dash.rows);
          ui = nextUi;
          // Pin the selection to whatever run the cursor is now on, so the next refresh keeps it there.
          selectedSlug = dash.rows[ui.sel]?.slug ?? selectedSlug;
          if (intent?.type === 'stop') {
            const view = dash.rows.find((r) => r.slug === intent.slug);
            if (view) await stop(view.record, { platform: makePlatform(view.record), kill });
          } else if (intent?.type === 'remove') {
            const view = dash.rows.find((r) => r.slug === intent.slug);
            if (view) remove(view.record, { dir, fs });
          }
          repaint();
        } catch (err) {
          fail(err);
        }
      }

      stdin.on('data', onData);
      refresh = setInterval(() => {
        try {
          repaint();
        } catch (err) {
          fail(err);
        }
      }, refreshMs);
      if (typeof refresh.unref === 'function') refresh.unref(); // never keep the process alive on the timer alone

      try {
        repaint();
      } catch (err) {
        fail(err);
      }
    });
  } finally {
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    if (typeof stdin.pause === 'function') stdin.pause();
    screen.close();
  }
}
