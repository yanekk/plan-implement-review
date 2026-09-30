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
// styledLines does, and createScreen is the one impure piece that hands them to pi-tui to paint (T11).
//
// Why the list is new painting but the live view is not (§2.11): the list's semantic colours are this
// task's to build (running green, crashed red, finished/stopped dim, the progress bar blue/red/dim, the
// selected row's grey band, the amber-bold armed line). The live view MUST be the coordinator's
// renderer, not a second one that drifts — so its lines come straight from render.mjs's styledLines and
// are painted with render.mjs's exact style→colour mapping (pir-view.mjs's SGR map carries render's keys
// unchanged alongside the list's), which keeps the watch frame byte-for-byte the coordinator's display.

import { basename, join, resolve as resolvePath } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { constants as osConstants, homedir } from 'node:os';
import { readLogTail } from './commands.mjs';

import { buildDisplay, rowEntries } from '../core/display.mjs';
import { wrapLine } from '../core/text.mjs';
import { buildDashboard, dashboardReducer, displayName, findOpen, goOpen, initialUi, isPlan, isSingle, openTasks, planProgress, repinOpen, runKey, moveRow } from '../core/dashboard.mjs';
import { buildPlanDisplay, buildSingleDisplay } from '../core/plandisplay.mjs';
import { singleProgress } from '../core/singleflow.mjs';
import { baseContains } from './worktree.mjs';
import { styledLines } from './render.mjs';
import { classifyRun } from '../core/runstate.mjs';
import { resolveLiveness, createLivenessCache } from './identity.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { stopRun, removeRun } from './control-run.mjs';
import { resumeRun, startPlanRun, startRun, startSingleRun } from './launch.mjs';
import { updateRecord } from './index-store.mjs';
import { planHome } from './plan-home.mjs';
import { FrameView, paintLine } from './pir-view.mjs';
import { createConversationView } from './conversation-view.mjs';
import { createDashboardPublisher } from './dashboard-publish.mjs';
import { createListView } from './list-view.mjs';
import { repoRoots, rootsLabel, scanRepos } from './repo-scan.mjs';
import { NOTES, parseBoxText, startBuildFailedNote, startFailedNote, startSingleFailedNote } from '../core/planbox.mjs';
import { scanPlans } from './plan-scan.mjs';
import { ProcessTerminal, TuiAltScreen, TUI_KEYBINDINGS, getKeybindings, isKeyRelease, parseKey } from '@earendil-works/pi-tui';

// The spinner frames, one per refresh (a poll tick). The SAME Braille frames render.mjs uses, so a live
// run painted here spins identically to the same run painted by coordinate.mjs's own display (§2.4). render.mjs does
// not export them, so they are duplicated here rather than reaching across into its internals.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// The style→colour map and the span painter live in pir-view.mjs (FrameView, T11): pi-tui draws the
// terminal, so this file writes no cursor-control escape of its own (DESIGN §2.11), except the mouse
// modes createScreen asks for and the exit restore it writes when pi-tui's stop never runs (mouse-navigation).

// A sensible width when a TTY does not report its dimensions (render.mjs's default).
const DEFAULT_COLS = 80;

// The list's column widths. Not binding (§2.11: exact terminal spacing is the builder's, not the mock's);
// chosen to line up the six columns the dashboard scans — slug, type, state, repo, progress, workers — in
// 80 columns. SLUG holds a planning run's label in quotes (24 characters at most, runrecord.mjs's
// LABEL_MAX, plus the quotes and a space). REPO takes what the terminal has left, between REPO_MIN and
// REPO_MAX: at 80 columns it gave up six to the label and TYPE (pir-plan-command §2.10), and a wider
// terminal gives them back.
const COL = { marker: 2, slug: 27, type: 6, state: 14, progress: 16, wk: 3 };
const COL_BASE = COL;
// While a row reads `● ready to merge` (pir-coordinator §2.10) STATE widens to fit it whole and SLUG gives
// the three columns up; every other list keeps today's widths, so its rows cut labels where they always did.
const COL_READY = { ...COL, slug: 24, state: 17 };
// `● ready for your go` (finisher DESIGN §2.11) is three characters longer still; SLUG gives them up.
const COL_GO = { ...COL, slug: 21, state: 20 };
const REPO_MIN = 12;
const REPO_MAX = 24;
function repoWidth(columns) {
  const fixed = COL.marker + COL.slug + COL.type + COL.state + COL.progress + COL.wk;
  return Math.max(REPO_MIN, Math.min(REPO_MAX, (columns | 0 || DEFAULT_COLS) - fixed));
}

// The least SLUG keeps beside a single run's PROGRESS, enough for a short name or the start of a label.
const SLUG_MIN = 12;
// TYPE with a single run listed: `single` and the space before STATE.
const TYPE_SINGLE = 7;

// listColumns(rows, columns) → the list's column widths, `repo` included. A list with no single run has
// exactly the widths it always had. A single run (single-runs DESIGN §2.8) needs more: TYPE one wider for
// `single`, and PROGRESS as wide as the longest single cell on the screen (`build ✓ review · tests (red 1) …`
// is twice a build's bar). SLUG pays for both, down to SLUG_MIN and never below REPO's minimum; past that
// PROGRESS is cut, since its head (`build ✓ review`) is the part a scan reads. What a wider terminal has
// left goes to REPO, as before. WK is the last column, so only its two header characters are ever drawn
// (a row's count is shorter); counting it as two here is what lets a full-length label keep its closing
// quote at 80 columns beside the wider TYPE.
const WK_DRAWN = 2;
export function listColumns(rows, columns) {
  const base = rows.some((v) => v.display === 'ready-for-your-go') ? COL_GO : rows.some((v) => v.display === 'ready-to-merge') ? COL_READY : COL_BASE;
  const singles = rows.filter(isSingle);
  if (singles.length === 0) return { ...base, repo: repoWidth(columns) };
  const longest = Math.max(...singles.map((v) => [...singleProgress(v.snap?.runState)].length));
  const rest = (columns | 0 || DEFAULT_COLS) - base.marker - TYPE_SINGLE - base.state - WK_DRAWN;
  let progress = Math.max(base.progress, longest + 1);
  // SLUG's full width is the plain list's: what `ready to merge` takes from it on a build's list is
  // already counted in `rest` here.
  let slug = Math.min(COL_BASE.slug, rest - progress - REPO_MIN);
  if (slug < SLUG_MIN) {
    slug = SLUG_MIN;
    progress = Math.max(base.progress, Math.min(progress, rest - slug - REPO_MIN));
  }
  const repo = Math.max(REPO_MIN, Math.min(REPO_MAX, rest - slug - progress));
  return { ...base, type: TYPE_SINGLE, slug, progress, repo };
}

// span(text, style) / lineOf(text, style) — the two shapes a frame is built from. A frame is an array of
// LINES; a line is an array of SPANS; a span is `{ text, style }` where style is a key into pir-view.mjs's SGR (or null
// for plain). One line can carry several differently-coloured spans (a list row does); a single-colour
// line is just one span. This is the same data render.mjs's styledLines emits, one level richer (many
// spans per line) so a row can colour its state and its progress bar independently.
const span = (text, style = null) => ({ text, style });
const lineOf = (text, style = null) => [span(text, style)];

// Right-pad (or truncate) a string to exactly `n` visible characters, counted by code point so a glyph
// like the state's ● counts as one. Truncation keeps the columns from drifting when a slug or repo is long;
// a cut value ends in `…` and keeps one space before the next column, so it never runs into it.
function pad(s, n) {
  const chars = [...String(s ?? '')];
  if (chars.length >= n) return n >= 3 ? chars.slice(0, n - 2).join('') + '… ' : chars.slice(0, n).join('');
  return chars.join('') + ' '.repeat(n - chars.length);
}

// readLogTail lives in commands.mjs (the setup runner needs it too); re-exported for this file's callers.
export { readLogTail };

// The state cell: the glyph+word and its §2.11 colour. running green (●), finished dim (◌), crashed red
// (✕), stopped dim (◼). An unrecognised state (an unreachable/stale index entry, §2.8) shows its raw
// value uncoloured rather than being forced into one of the four.
//
// A planning run's row shows its display state (runDisplayState, pir-plan-command §2.10): planning and
// reviewing green as running, `your go` amber bold (the colour of asking), the rest as a build's. A running
// build with a worker waiting on the person reads `asking you` in the same amber bold.
//
// A single run (single-runs DESIGN §2.8): building and testing green as running, `merged` dim as finished,
// which is the tally it counts in.
function stateCell(state) {
  switch (state) {
    case 'building':
      return { text: '● building', style: 'running' };
    case 'testing':
      return { text: '● testing', style: 'running' };
    case 'merged':
      return { text: '◌ merged', style: 'ended' };
    case 'running':
      return { text: '● running', style: 'running' };
    case 'planning':
      return { text: '● planning', style: 'running' };
    case 'reviewing':
      return { text: '● reviewing', style: 'running' };
    case 'your-go':
      return { text: '● your go', style: 'your-go' };
    case 'asking-you':
      return { text: '● asking you', style: 'your-go' };
    case 'ready-to-merge':
      return { text: '● ready to merge', style: 'your-go' };
    // The finisher waits for the person's go (finisher DESIGN §2.11), in place of `ready to merge`.
    case 'ready-for-your-go':
      return { text: '● ready for your go', style: 'your-go' };
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
function footerLine(context, ui, rows = []) {
  if (ui.armed) {
    if (ui.armed.action === 'resume') {
      // Named as the row names it: a planning run before its rename has only its label.
      const row = rows.find((r) => runKey(r) === ui.armed.key);
      return lineOf(`⚠ Ctrl+R again to resume ${row ? displayName(row) : ui.armed.slug}`, 'armed');
    }
    if (ui.armed.action === 'stop') {
      return lineOf(`⚠ Ctrl+S again to stop ${ui.armed.slug} now — this kills its in-flight workers`, 'armed');
    }
    return lineOf(`⚠ Ctrl+X again to remove ${ui.armed.slug}'s record`, 'armed');
  }
  if (context === 'go') return lineOf('↵ start · n not now · ← back to the list · esc quit (the question keeps)', 'hint');
  if (context === 'steps') return lineOf('↑↓ pick a step · → open it · ← back · Ctrl+S Ctrl+S stop this run · esc quit', 'hint');
  // A planning run that is not running cannot be stopped (the chord is inert on it), so its hint does not
  // offer the stop; its note above says how it resumes, if it can (T14).
  if (context === 'steps-ended') return lineOf('↑↓ pick a step · → open it · ← back · esc quit', 'hint');
  if (context === 'watch') return lineOf('↑↓ pick a task · → open its worker · ← back · Ctrl+S Ctrl+S stop this run · esc quit', 'hint');
  // A run with a coordinator agent offers `c` (pir-coordinator §2.8); the stop keeps its chord, shorter.
  if (context === 'watch-agent') return lineOf('↑↓ task · → its worker · c coordinator · ← back · Ctrl+S Ctrl+S stop · esc quit', 'hint');
  // Once the finisher replaces the agent (finisher DESIGN §2.11), `c` opens the finisher.
  if (context === 'watch-finisher') return lineOf('↑↓ task · → its worker · c finisher · ← back · Ctrl+S Ctrl+S stop · esc quit', 'hint');
  return lineOf('↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit', 'hint');
}

// buildListFrame(dashboard, ui, { columns, rows }) → frame (DESIGN §2.3, §2.11).
//
//   dashboard = { rows, counts } — buildDashboard's output (T04). rows are the resolved run views in the
//               order the caller sorted them; counts is the tallies line's source.
//   ui        = { sel, armed, … } — the reducer's navigation state; sel marks the highlighted row and
//               armed drives the confirmation footer.
//
// With no rows it paints the get-started line in place of an empty list (§2.3, user decision §7): a blank
// screen reads as broken on a first open. Otherwise: the title, a column header, one row per run, the
// counts line, and the footer. Each row's spans are coloured by §2.11; the selected row leads with a
// 'selected' `▎` span, which paintLine (pir-view.mjs) turns into a full-width grey band when colour is on.
//
// `columns` is the terminal width; REPO widens with it (repoWidth), everything else is fixed.
//
// `rows` (dashboard-plan-box §2.7, T04) is the line budget of the list block when the list sits above the
// new-plan box (list-view.mjs). Given, the frame is the list block alone — no note and no footer, since
// the list view draws those under and around the box — windowed to the budget by windowListBlock. Absent,
// the frame is exactly today's: the non-TTY path has no box, so it keeps its footer and its get-started
// line, which there still points at `pir start`.
export function buildListFrame(dashboard, ui = initialUi(), { columns = DEFAULT_COLS, rows: budget } = {}) {
  const { rows = [], counts = { running: 0, finished: 0, crashed: 0, stopped: 0, waiting: 0, total: 0 } } = dashboard ?? {};
  const COL = listColumns(rows, columns);
  const repoCol = COL.repo;
  const title = [span('pir', 'head'), span('  runs on this machine', 'dim')];
  const header = lineOf(
    '  ' + pad('SLUG', COL.slug) + pad('TYPE', COL.type) + pad('STATE', COL.state) + pad('REPO', repoCol) + pad('PROGRESS', COL.progress) + 'WK',
    'dim',
  );
  const rowLine = (v, i) => withHit(rowSpans(v, i), 'run', i);
  const rowSpans = (v, i) => {
    const selected = i === ui.sel;
    // A run is "live" only while running; a non-running run's slug is dimmed so the eye lands on the
    // active ones. The state colour lives on the state cell, separately, so both signals show at once.
    const live = v.state === 'running';
    // A planning run (pir-plan-command §2.10): TYPE `plan` magenta, its label dimmed in quotes until it has
    // a slug, its display state, and its steps in PROGRESS. A record without `kind` is a build, `work`.
    // isPlan is the rule runDisplayState uses, so TYPE, STATE and PROGRESS never disagree on a row.
    // A single run (single-runs DESIGN §2.8) is painted the same way: TYPE `single`, its label until the
    // builder has named it, and its steps in PROGRESS (singleProgress).
    const plan = isPlan(v);
    const single = isSingle(v);
    const labelled = (plan || single) && !!v.record?.label;
    const st = stateCell(v.display ?? v.state);
    const steps = plan ? planProgress(v.snap?.runState) : single ? singleProgress(v.snap?.runState) : null;
    const prog = steps != null ? { text: steps, style: v.state === 'crashed' ? 'bar-crash' : null } : progressCell(v.state, v.progress);
    return [
      span(selected ? '▎ ' : '  ', selected ? 'selected' : null), // the selected-row mark (paintLine)
      span(pad(displayName(v), COL.slug), live && !labelled ? null : 'dim'),
      // `single` takes the step rows' cyan: a third colour beside magenta and blue, from a key both
      // colour tables already have.
      span(pad(plan ? 'plan' : single ? 'single' : 'work', COL.type), plan ? 'type-plan' : single ? 'active' : 'type-work'),
      span(pad(st.text, COL.state), st.style),
      span(pad(v.repo, repoCol), 'dim'),
      span(pad(prog.text, COL.progress), prog.style),
      span(v.workers > 0 ? String(v.workers) : '·', 'dim'),
    ];
  };

  if (budget != null) return windowListBlock({ title, header, rows, rowLine, sel: ui.sel, counts: countsLine(counts), budget });

  const lines = [];
  lines.push(title);
  lines.push([]); // a blank spacer line

  if (rows.length === 0) {
    lines.push(lineOf('  No runs yet — start one with `pir start {slug}`', 'dim'));
  } else {
    lines.push(header);
    rows.forEach((v, i) => lines.push(rowLine(v, i)));
  }

  lines.push([]);
  lines.push(countsLine(counts));
  lines.push([]);
  // Why a resume did not start (resumeRun's refusal), dim above the hint; one-shot like the watch note.
  if (ui.note) lines.push(lineOf(ui.note, 'dim'));
  lines.push(footerLine('list', ui, rows));
  return lines;
}

// withHit(line, kind, index) → the same span array, tagged with the row it paints (mouse-navigation §3.3),
// so a click or a hover on that screen line knows which run, task or step it lands on. The property is
// non-enumerable: whole-frame deepStrictEqual asserts compare own enumerable keys, and a frame's visible
// text and shape stay exactly what they were for every existing caller.
function withHit(line, kind, index) {
  Object.defineProperty(line, 'hit', { value: { kind, index }, enumerable: false, configurable: true, writable: true });
  return line;
}

// sameHit(a, b) → whether two hits name the same row (or are both no row).
function sameHit(a, b) {
  return (a?.kind ?? null) === (b?.kind ?? null) && (a?.index ?? null) === (b?.index ?? null);
}

// hitAt(frame, y) → the { kind, index } of the row painted on frame line y, or null for a line that is not
// a row (title, header, markers, blanks, notes, counts, footer) or a y outside the frame. A frame line's
// index is its screen row (§3.3), so y is the pointer's zero-based screen row.
export function hitAt(frame, y) {
  if (!Array.isArray(frame) || !Number.isInteger(y) || y < 0) return null;
  return frame[y]?.hit ?? null;
}

// The get-started line under the box (dashboard-plan-box §2.7): the box is right below it, so it points there.
// 'plan or build' since the box also builds (user, box-commands T05 drill, 2026-09-29).
export const EMPTY_LIST_BOX = '  No runs yet — type after @ below to plan or build';

// windowListBlock → the list block cut to `budget` lines (dashboard-plan-box §2.7, user 2026-09-26).
// The block is title, spacer, header, rows, spacer, counts, spacer. When it does not fit, the three spacers
// go first (bottom one first), then the title; the header and the counts line always stay. The rows then
// get what is left, at least one slot: they scroll so the selected row is visible, and a dim `↑ n more` /
// `↓ n more` takes the first / last slot when rows are cut on that side and there is room for the marker
// plus at least one row. With one slot only, it is the selected row and no marker shows.
function windowListBlock({ title, header, rows, rowLine, sel, counts, budget }) {
  const n = rows.length;
  const need = Math.max(1, n); // the empty list's one line counts as one row that always shows
  let keep = 4; // droppables still shown, dropped in the order sp3, sp2, sp1, title
  while (keep > 0 && 2 + keep + need > budget) keep -= 1;
  const slots = Math.max(1, budget - 2 - keep);
  const has = (i) => keep > 3 - i; // 0: sp3, 1: sp2, 2: sp1, 3: title — dropped in that order

  let body;
  if (n === 0) body = [lineOf(EMPTY_LIST_BOX, 'dim')];
  else {
    const s = Math.min(Math.max(0, sel | 0), n - 1);
    const w = rowWindow(n, s, slots);
    body = [];
    if (w.up > 0) body.push(lineOf(`  ↑ ${w.up} more`, 'dim'));
    for (let i = w.start; i < w.end; i++) body.push(rowLine(rows[i], i));
    if (w.down > 0) body.push(lineOf(`  ↓ ${w.down} more`, 'dim'));
  }

  const lines = [];
  if (has(3)) lines.push(title);
  if (has(2)) lines.push([]);
  if (n > 0) lines.push(header);
  lines.push(...body);
  if (has(1)) lines.push([]);
  lines.push(counts);
  if (has(0)) lines.push([]);
  return lines;
}

// rowWindow(n, sel, slots) → { start, end, up, down }: which rows show in `slots` lines, and how many are
// hidden above and below. The window is stateless — centred on the selection and clamped to the ends — so
// the pure frame needs no scroll offset carried between paints. Markers cost a slot each, so the widest
// window whose markers still fit wins; one slot is always the selected row alone.
export function rowWindow(n, sel, slots) {
  if (n <= slots) return { start: 0, end: n, up: 0, down: 0 };
  for (let v = slots; v >= 1; v--) {
    const start = Math.min(Math.max(0, sel - Math.floor((v - 1) / 2)), n - v);
    const up = start > 0 ? start : 0;
    const down = start + v < n ? n - start - v : 0;
    if (v + (up > 0) + (down > 0) <= slots) return { start, end: start + v, up, down };
  }
  // No marker fits beside a row: the slots are all rows, centred on the selection, and no marker shows.
  const start = Math.min(Math.max(0, sel - Math.floor((slots - 1) / 2)), n - slots);
  return { start, end: start + slots, up: 0, down: 0 };
}

// listFooter(ui, rows) → the list's footer line (the armed confirmation, or the key hint), for the list view
// to draw under its box (dashboard-plan-box §2.6). The same line buildListFrame ends with.
export function listFooter(ui, rows = []) {
  return footerLine('list', ui ?? initialUi(), rows);
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
  // Runs waiting on the person, amber like the row's state: a planning run's go (pir-plan-command §2.10)
  // and a build with a worker asking.
  if (counts.waiting > 0) spans.push(span(' · ', 'dim'), span(`${counts.waiting} waiting for you`, 'your-go'));
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
// live block, and, for a run that is NOT running, a stale note saying the frame is old and how `pir start {slug}`
// resumes it (§2.4: painting a stale snapshot plainly is more honest than a blank screen). A crashed run
// also shows the tail of its log and the full log path. A run with no snapshot yet shows a waiting line.
// The spinner ticks only while the run is running; a stale frame's glyph is a static dot.
export function buildWatchFrame(view, { now, spinnerChar = SPINNER[0], ui = initialUi(), columns = DEFAULT_COLS, logTail = null, progress = null, dropped = null } = {}) {
  // A planning run has steps, not tasks: its own frame (pir-plan-command §2.11), reached the same way.
  if (isPlan(view)) return buildPlanWatchFrame(view, { now, spinnerChar, ui, columns, logTail, progress });
  // So has a single run (single-runs DESIGN §2.8).
  if (isSingle(view)) return buildSingleWatchFrame(view, { now, spinnerChar, ui, columns, logTail, dropped });
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
      note(`Esc quits pir; then \`pir start ${slug}\` retries it.`, 'dim');
    } else if (state === 'finished') {
      // With no snapshot there is no runState to tell green from red, so never offer the merge on a guess
      // (DESIGN §2.8): point at run.log, which records how the gate ended.
      note('no snapshot recorded — finished. Whether its tests passed is in the log:', 'ended');
      note(logPath ?? "run.log in the run's control folder", 'dim', '    ');
    } else if (state === 'stopped') {
      note(`no snapshot recorded — stopped. \`pir start ${slug}\` resumes from committed work.`, 'ended');
    } else {
      note('no snapshot recorded.', 'dim');
    }
  } else {
    // A stale (non-running) frame freezes its spinner to a dot so it cannot read as still ticking.
    const spin = alive ? spinnerChar : '·';
    // The block's lines 1..n are the task rows, in rowEntries order (line 0 is the summary): the plan's
    // tasks, the separator and the coordinator agent's row (T12), then any end-of-run helper (T11). The
    // selected one carries the list's selected-row mark in place of its leading '  ' (painted as the grey
    // band, see paintLine), so this block is no longer byte-for-byte the coordinator's display, on purpose;
    // every other line is.
    const taskCount = rowEntries(snap.runState).length;
    const selLine = taskCount > 0 ? 1 + Math.max(0, Math.min(ui.taskSel ?? 0, taskCount - 1)) : -1;
    // Line i (1..n) of the block is rowEntries[i - 1], so it carries that index as its hit (mouse-navigation
    // §3.3); the separator line is never selected (moveRow), so it carries none.
    const entries = rowEntries(snap.runState);
    watchDisplayLines(snap, { now, spinnerChar: spin }).forEach((l, i) => {
      const line = i === selLine && l.text.startsWith('  ') ? [span('▎ ', 'selected'), span(l.text.slice(2), l.style)] : [span(l.text, l.style)];
      const entry = i >= 1 && i <= taskCount ? entries[i - 1] : null;
      lines.push(entry && !entry.separator ? withHit(line, 'task', i - 1) : line);
    });
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
        note(`← back to the list; \`pir start ${slug}\` resumes it.`, 'dim');
      } else if (state === 'finished') {
        const branch = record?.branch ?? `pir/${slug}`;
        // A complete run that is not ready to merge ended red (DESIGN §2.8): its footer above already shows
        // the reason and log path, so the stale note must not offer the merge.
        const red = !!snap.runState?.complete && !snap.runState?.readyToMerge;
        // A run the finisher ended has had its merge done for the person (finisher DESIGN §2.8), so the
        // stale note must not offer it again (same rule as the finisher's footer, user 2026-09-29, T07).
        const byFinisher = snap.runState?.finisher?.state === 'done';
        // The run's base rides in the snapshot (base-branch DESIGN §2.9); one written before it reads `main`.
        const base = snap.runState?.base ?? snap.runState?.handoff?.base ?? 'main';
        const end = red ? `Not ready to merge — fix ${branch}, see the output above.` : byFinisher ? 'The finisher is done.' : `Hand-off: git switch ${base} && git merge ${branch}`;
        note(`— finished · this frame is stale. ${end}`, 'ended', '');
      } else if (state === 'stopped') {
        note(`— stopped · this frame is stale. \`pir start ${slug}\` resumes from committed work.`, 'ended', '');
      }
    }
  }

  lines.push([]);
  // Why the last → on a task row opened nothing (a task with no worker yet), dim above the hint.
  if (ui.note) note(ui.note, 'dim', '');
  lines.push(footerLine(snap?.runState?.finisher?.id ? 'watch-finisher' : snap?.runState?.coordinator?.id ? 'watch-agent' : 'watch', ui));
  return lines;
}

// The step rows' glyphs and colours: a step is painted as a task row is (render.mjs's GLYPH and ROW_STYLE),
// so a live step spins, an asking one is the amber-bold dot, a done one the green check (§2.11).
const STEP_GLYPH = { asking: '●', done: '✔', failed: '✗', pending: '○' };
const STEP_STYLE = { active: 'active', asking: 'asking', done: 'done', failed: 'red', pending: 'idle' };

// mm:ss, render.mjs's clock format; null reads blank.
function fmtClock(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// buildPlanWatchFrame(view, { now, spinnerChar, ui, columns, logTail, progress }) → frame
// (pir-plan-command §2.8, §2.11). A planning run's live view: a header (name, state, branch), one row per
// step, then either the go question with its keys, or the one note the run's state calls for. `progress` is
// the reviewed plan's PROGRESS.md text, read by the shell only while the go is asked, for the width line.
export function buildPlanWatchFrame(view, { now, spinnerChar = SPINNER[0], ui = initialUi(), columns = DEFAULT_COLS, logTail = null, progress = null } = {}) {
  const { state, snap, record } = view ?? {};
  const d = buildPlanDisplay(snap?.runState ?? null, { now, record: record ?? { slug: view?.slug }, state, progress });
  const lines = [];
  const cols = Math.max(20, columns | 0 || DEFAULT_COLS);
  const note = (text, style, indent = '  ') => {
    const width = Math.max(1, cols - [...indent].length);
    for (const seg of wrapLine(text, width)) lines.push(lineOf(indent + seg, style));
  };
  const alive = state === 'running';
  lines.push([span(d.header.name, 'head'), span(` · ${d.header.state}${d.header.branch ? ` · ${d.header.branch}` : ''}`, 'dim')]);
  lines.push([]);
  const sel = Math.max(0, Math.min(ui.taskSel ?? 0, d.rows.length - 1));
  d.rows.forEach((r, i) => lines.push(stepLine(r, i, { sel, alive, spinnerChar })));
  lines.push([]);

  const f = d.footer;
  if (d.go) {
    note(`${d.go.slug} is reviewed. Start the parallel build now?`, 'your-go', '');
    if (d.go.widthLine) note(d.go.widthLine, null, '');
    if (d.go.branch) note(`It builds on ${d.go.branch}.`, 'dim', '');
    lines.push([]);
    lines.push([span('  ↵ Start the build', 'your-go'), span('     ', null), span('n Not now', 'your-go')]);
  } else if (f?.kind === 'asking') {
    note(`● ${f.step} — asking you; open it (→) to answer`, 'asking', '');
  } else if (f?.kind === 'build-later') {
    note(`Reviewed and waiting on ${f.branch}. Build it with: pir start ${f.slug}`, 'ended', '');
  } else if (f?.kind === 'no-plan') {
    note(`— finished · the planner ended without a plan. ${f.branch ? `Its branch ${f.branch} is kept.` : ''}`.trim(), 'ended', '');
  } else if (f?.kind === 'not-reviewed') {
    note('— finished · the review ended with the plan not reviewed. Ctrl+R Ctrl+R on the list resumes the reviewer.', 'ended', '');
  } else if (f?.kind === 'stale') {
    if (f.state === 'crashed') {
      note('— the planning program died; this frame is stale. Ctrl+R Ctrl+R on the list resumes it.', 'crashed', '');
      if (logTail && logTail.length) {
        lines.push([]);
        lines.push(lineOf('  last lines of run.log:', 'dim'));
        for (const raw of logTail) note(raw.replace(/\s+$/, ''), 'dim', '    ');
      }
    } else {
      note(`— ${f.state} · this frame is stale. Ctrl+R Ctrl+R on the list resumes it.`, 'ended', '');
    }
  }

  lines.push([]);
  if (ui.note) note(ui.note, 'dim', '');
  lines.push(footerLine(d.go ? 'go' : alive ? 'steps' : 'steps-ended', ui));
  return lines;
}

// One step row of a planning or single run's steps view, tagged with its index for the mouse.
function stepLine(r, i, { sel, alive, spinnerChar }) {
  const glyph = r.kind === 'active' ? (alive ? spinnerChar : '·') : STEP_GLYPH[r.kind];
  const text = `${glyph} ${r.id.padEnd(8)} ${r.role.padEnd(12)} ${r.text.padEnd(30)} ${fmtClock(r.clock)}`.replace(/\s+$/, '');
  return withHit([span(i === sel ? '▎ ' : '  ', i === sel ? 'selected' : null), span(text, STEP_STYLE[r.kind] ?? null)], 'step', i);
}
// What a step row's text starts at: the mark, the glyph, the id and the role columns (stepLine).
const STEP_TEXT_AT = 2 + 2 + 9 + 13;

// buildSingleWatchFrame(view, { now, spinnerChar, ui, columns, logTail, dropped }) → frame (single-runs
// DESIGN §2.8). A single run's steps view: the header (name, state, branch), the rows build, review and
// merge painted as a planning run's steps are, then the one note the run's state calls for. `view.merged`
// is the shell's merged check; `dropped` is the `dropped` report's body, read by the shell from state.json.
export function buildSingleWatchFrame(view, { now, spinnerChar = SPINNER[0], ui = initialUi(), columns = DEFAULT_COLS, logTail = null, dropped = null } = {}) {
  const { state, snap, record } = view ?? {};
  const d = buildSingleDisplay(snap?.runState ?? null, { now, record: record ?? { slug: view?.slug }, state, merged: !!view?.merged, dropped });
  const lines = [];
  const cols = Math.max(20, columns | 0 || DEFAULT_COLS);
  const note = (text, style, indent = '  ') => {
    const width = Math.max(1, cols - [...indent].length);
    for (const seg of wrapLine(text, width)) lines.push(lineOf(indent + seg, style));
  };
  const alive = state === 'running';
  lines.push([span(d.header.name, 'head'), span(` · ${d.header.state}${d.header.branch ? ` · ${d.header.branch}` : ''}`, 'dim')]);
  lines.push([]);
  const sel = Math.max(0, Math.min(ui.taskSel ?? 0, d.rows.length - 1));
  d.rows.forEach((r, i) => lines.push(stepLine(r, i, { sel, alive, spinnerChar })));
  lines.push([]);

  const f = d.footer;
  if (f?.kind === 'asking') {
    note(`● ${f.step} — asking you; open it (→) to answer`, 'asking', '');
  } else if (f?.kind === 'ready') {
    // The merge row carries the hand-off line; a frame too narrow for it would clip the command, so there
    // it is said again, wrapped, in the words a finished build's frame uses.
    if (STEP_TEXT_AT + [...f.line].length > cols) note(`Hand-off: ${f.line}`, 'your-go', '');
  } else if (f?.kind === 'dropped') {
    note(f.reason ? `Dropped: ${f.reason}` : 'Dropped.', 'ended', '');
  } else if (f?.kind === 'stale') {
    if (f.state === 'crashed') {
      note('— the single run\'s program died; this frame is stale. Ctrl+R Ctrl+R on the list resumes it.', 'crashed', '');
      if (logTail && logTail.length) {
        lines.push([]);
        lines.push(lineOf('  last lines of run.log:', 'dim'));
        for (const raw of logTail) note(raw.replace(/\s+$/, ''), 'dim', '    ');
      }
    } else if (f.state === 'stopped') {
      note('— stopped · this frame is stale. Ctrl+R Ctrl+R on the list resumes it.', 'ended', '');
    } else {
      note(`— ${f.state} · this frame is stale.`, 'ended', '');
    }
  }

  lines.push([]);
  if (ui.note) note(ui.note, 'dim', '');
  lines.push(footerLine(alive ? 'steps' : 'steps-ended', ui));
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
//   Ctrl+R       → 'ctrlR'            (arm / confirm resume, pir-plan-command §2.14)
//   Ctrl+C       → 'quit'             (leave `pir` at once)
//
// In the 'worker' view none of this applies: runTui hands every key to the conversation view, where Esc
// interrupts the worker and Ctrl+C clears the box or interrupts (live-workers §2.11, user 2026-09-25).
//
// Back and quit are split across two keys at the user's direction (2026-09-22): ← walks back a level, Esc
// leaves outright — rather than the original Esc-steps-back-then-quits from the prototype (DESIGN §2.4,
// §2.11). 'back' and 'quit' are the loop's own intents, not reducer events; the loop translates a ← in the
// live view into the reducer's 'back' and ignores it in the list, where there is no level to step back to.
//
// It decodes one key sequence with pi-tui's own parser, so every encoding a terminal may send reads the
// same: CSI (`\x1b[A`) and application-cursor SS3 (`\x1bOA`) arrows, CR and LF, and — once pi-tui has
// negotiated the Kitty keyboard protocol with the terminal — the CSI-u forms of Esc, Enter and the Ctrl
// chords (`\x1b[27u`, `\x1b[115;5u`), which the old byte table could not read. On a real terminal pi-tui
// splits a batch of input into single sequences before it arrives here, and tells a lone Esc from the
// start of an arrow by a short timeout. Anything unbound, a terminal reply included (the cell-size report
// `\x1b[6;16;8t`, FINDINGS 2026-09-25), decodes to null and is ignored.
const KEY_INTENTS = {
  up: 'up',
  down: 'down',
  left: 'back', // ← steps back a level
  right: 'open', // → opens the selected run, like Enter (user 2026-09-22)
  enter: 'enter', // opens, as → does, except on the go question, where it starts the build (§2.8)
  n: 'n', // `n` not now on the go question; unbound anywhere else
  c: 'c', // a build's live view: open its coordinator agent's conversation (pir-coordinator §2.8)
  escape: 'quit',
  'ctrl+c': 'quit',
  'ctrl+s': 'ctrlS',
  'ctrl+x': 'ctrlX',
  'ctrl+r': 'ctrlR',
};
export function decodeKey(data) {
  const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
  if (s === '' || isKeyRelease(s)) return null; // a Kitty key-up is not a second press
  return KEY_INTENTS[parseKey(s)] ?? null;
}

// withHeadLine(line, make, { host, colour }) → the component `make(tui)` builds, headed by one line (§2.12:
// the reviewer's conversation after following into it). The inner view is handed a terminal one row short,
// so the line costs it a row of scrollback and the frame still fits. With no line, `make(host)` as it is.
export function withHeadLine(line, make, { host, colour }) {
  if (!line) return make(host);
  const tui = {
    requestRender: (...a) => host.requestRender?.(...a),
    terminal: {
      get rows() {
        return Math.max(9, (host.terminal?.rows || 24) - 1);
      },
      get columns() {
        return host.terminal?.columns || DEFAULT_COLS;
      },
    },
  };
  const inner = make(tui);
  return {
    render: (width) => [paintLine([span(line, 'ok')], Math.max(20, width | 0), colour), ...inner.render(width)],
    handleInput: (data) => inner.handleInput(data),
    // The head line takes no mouse event; below it the inner view sees its own rows (mouse-navigation §2.3).
    handleMouse: (ev) => (ev.y === 0 ? undefined : inner.handleMouse?.({ ...ev, y: ev.y - 1 })),
    invalidate: () => inner.invalidate(),
    get focused() {
      return inner.focused;
    },
    set focused(v) {
      inner.focused = v;
    },
    dispose: () => inner.dispose(),
    get state() {
      return inner.state;
    },
  };
}

// --- The impure edge: painting a frame on a real terminal, and the input loop -----------------------

// The mouse modes pi-tui enables (?1000 buttons, ?1002 button-motion, ?1003 all-motion, ?1004 focus, ?1006
// SGR encoding), switched off in pi-tui's own order. MOUSE_OFF is what pi-tui's stop writes; the exit
// restore writes it too, so a signal that never reaches that stop still leaves no mouse mode behind.
const MOUSE_OFF = '\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l';
const ALL_MOTION_ON = '\x1b[?1003h';
// The whole exit restore: mouse off, bracketed paste off (pi-tui's terminal turns it on at start and off only
// in its own stop, so a SIGTERM left it on: T08 drill), autowrap back on (pi-tui turns it off), leave the
// alternate screen, show the cursor. Raw mode needs nothing here: Node resets the TTY mode itself when the
// process exits.
const EXIT_RESTORE = `${MOUSE_OFF}\x1b[?2004l\x1b[?7h\x1b[?1049l\x1b[?25h`;
const EXIT_SIGNALS = ['SIGTERM', 'SIGHUP', 'SIGINT'];

// Whether pi-tui will have asked for button-motion only (no hover): it checks exactly these, on its own
// reading of process.env (mouse-navigation §2.2, FINDINGS).
export function underMultiplexer(env) {
  const term = (env.TERM ?? '').toLowerCase();
  return env.TMUX !== undefined || env.STY !== undefined || env.ZELLIJ !== undefined || term.startsWith('tmux') || term.startsWith('screen');
}

// defaultCopy(text) → Promise<true | string>. pi-tui's copySelection on macOS: pbcopy with the text on its
// stdin, which reached the real clipboard in the spike, where pi-tui's default OSC 52 depends on the
// terminal allowing it (mouse-navigation §2.5). A failure comes back as its message, which pi-tui flashes.
// pbcopy decodes its stdin by the locale, and with no UTF-8 one (LANG unset: some ssh or cron shells) it
// turns 'é ⠋ ✅' into mojibake; Node always writes UTF-8, so the locale is forced to match (reproduced by
// hand, T04 review). `run` and `env` are injected so the test never touches the real clipboard.
export function defaultCopy(text, { run = execFile, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = run('pbcopy', [], { env: { ...env, LC_ALL: 'en_US.UTF-8' } }, (err) => resolve(err ? `Copy failed: ${err.message}` : true));
    child.stdin.on('error', () => {}); // an EPIPE from a pbcopy that failed to start is reported by execFile
    child.stdin.end(text);
  });
}

// createScreen({ stream, colour, terminal, copy, env, onExit, platform }) → { paint(frame), close(),
// listen?(onInput, onError, onMouse) }. The one
// impure piece. On a TTY it is a pi-tui alternate screen (TuiAltScreen) whose only component is a FrameView
// over the latest frame: pi-tui enters and leaves the alternate screen, hides the cursor, clips each line
// to the width, cuts the frame at the terminal's rows (from the top, as before) and repaints only the rows
// that changed, so a refresh never flickers. The screen owns the keyboard too, through pi-tui's
// ProcessTerminal (raw mode, sequence splitting, Kitty negotiation); runTui reads keys through `listen`.
// On a non-TTY there is no pi-tui at all: it appends plain text with no escapes, so a pipe or the test
// harness reads it as text, and it has no `listen`, so runTui reads stdin itself.
//
// The mouse is on (mouse-navigation §2.7): pi-tui parses the reports, runs its own drag-to-select and copies
// the selection on release through `copy` (pbcopy on macOS; elsewhere pi-tui's OSC 52), and hands every
// event to the root's handleMouse, which forwards it to the mounted component or to listen's onMouse. On
// close, pi-tui's last frame is not printed onto the main screen (`preserveScreen`), so quitting leaves the
// person's terminal exactly as it was before `pir`.
//
// Mouse reporting left on after pir is gone makes the shell print escapes on every pointer move, so while
// the screen is started it also restores the terminal on process `exit`, SIGTERM, SIGHUP and SIGINT, the
// exits pi-tui's stop never sees (§2.7). SIGKILL cannot be caught.
//
// `terminal` is pi-tui's Terminal seam: ProcessTerminal (process.stdin/stdout) by default, a fake in tests.
// `copy`, `env`, `onExit` (the process, as an emitter with exit()) and `platform` are injected so tests
// never touch the real clipboard, environment or process.
export function createScreen({ stream = process.stdout, colour, terminal, copy = defaultCopy, env = process.env, onExit = process, platform = process.platform } = {}) {
  const isTTY = !!stream.isTTY;
  // Colour only on a TTY, and honour NO_COLOR (the de-facto standard), matching render.mjs so the two
  // agree on when the live view is coloured.
  const useColour = isTTY && (colour ?? !('NO_COLOR' in env));

  if (!isTTY) {
    let mounted = null;
    return {
      colour: false,
      host: { requestRender() {}, terminal: { rows: stream.rows || 24, columns: stream.columns || DEFAULT_COLS } },
      paint(frame) {
        stream.write(frame.map((l) => l.map((s) => s.text).join('')).join('\n') + '\n');
      },
      mount(component) {
        mounted = component;
      },
      renderNow() {
        if (mounted) stream.write(mounted.render(stream.columns || DEFAULT_COLS).join('\n') + '\n');
      },
      close() {},
    };
  }

  let frame = [];
  let started = false;
  let closed = false;
  let painting = false;
  let onInput = null;
  let onError = null;
  let onMouse = null;
  // The screen row under the pointer (mouse-navigation §2.2, §3.5), set by runTui: the FrameView lives here,
  // so runTui cannot hand it a getter of its own.
  let hoverY = null;
  const view = new FrameView(() => frame, { colour: useColour, getHoverY: () => hoverY });
  // The conversation view (T13) is a pi-tui component of its own, with a typing box: while one is mounted
  // it is drawn in the frame's place and has the focus, so the box's cursor lands where the person types.
  let mounted = null;
  // pi-tui also renders on its own — after a resize, and once on start. A throw there would surface on a
  // timer, outside runTui's try, so it is caught and handed to runTui's error path (restore the terminal,
  // then rethrow, §2.14). A throw during paint() propagates straight to paint's caller instead.
  const guarded = {
    render(width) {
      try {
        return (mounted ?? view).render(width);
      } catch (err) {
        if (painting || !onError) throw err;
        onError(err);
        return [];
      }
    },
    invalidate() {},
    // Every mouse event pi-tui parses lands here, the layout root (mouse-navigation §3.2). A mounted
    // component takes it if it has a handler; a painted frame's events go to runTui's onMouse. Returning
    // undefined (no handler, or a handler that declines) leaves pi-tui its text selection and its
    // synthesised click, so nothing here handles a press.
    handleMouse(ev) {
      const r = mounted ? mounted.handleMouse?.(ev) : onMouse?.(ev);
      // A click that opened a row (runTui marks it `rowClick`) must not count towards pi-tui's double click.
      // pi-tui counts two presses on the same word within 500 ms as a double click and turns the second into
      // a word selection, copied on release: where the first click left the screen unchanged under the
      // pointer (a task with no worker, a step with no session) a double click flashed `Copied!` and
      // replaced the clipboard instead of being the second click §2.1 says it is (T08 drill). pi-tui keeps
      // that count in `lastClick` (0.87.1) and offers no call to reset it.
      if (ev?.type === 'click' && r?.rowClick) tui.lastClick = undefined;
      if (!mounted) return r;
      // pi-tui focuses the component its dispatch reached, which is this root, not the mounted one: a
      // click in a mounted typing box (the Editor answers { focus: true }) would take the focus off the
      // component and its cursor would vanish. A result naming its own target is passed through as is, so
      // the focus is pointed back at the mounted component with the target this root would have had.
      if (r?.focus && !('target' in r)) {
        return {
          ...r,
          handled: true,
          focusTarget: mounted,
          target: { component: guarded, originX: ev.screenX - ev.x, originY: ev.screenY - ev.y, width: ev.width, height: ev.height },
        };
      }
      return r;
    },
  };
  // TuiAltScreen scrolls its own viewport on PgUp/PgDn, Home/End and Ctrl+↑/↓, and opens a transcript
  // search on Ctrl+Shift+F, in an input listener that runs before pir's and consumes the key. pir's frame
  // is always exactly the terminal's height, so that viewport never moves: the keys just vanished, and the
  // conversation view's PgUp/PgDn scrolled nothing (T20). pir owns every key (§2.11), so every
  // `tui.altScreen.*` binding is unbound; pi-tui's keybindings are process-wide, which is fine for pir.
  const kb = getKeybindings();
  const unbound = Object.fromEntries(Object.keys(TUI_KEYBINDINGS).filter((id) => id.startsWith('tui.altScreen.')).map((id) => [id, []]));
  kb.setUserBindings({ ...kb.getUserBindings(), ...unbound });
  const term = terminal ?? new ProcessTerminal();
  const tui = new TuiAltScreen(term, false, undefined, {
    mouse: true,
    wheelScrollLines: 3,
    ...(platform === 'darwin' && copy ? { copySelection: copy } : {}),
  });
  tui.setLayoutRoot(guarded);
  tui.addInputListener((data) => {
    if (!onInput) return undefined;
    onInput(data);
    return { consume: true };
  });

  function mount(component) {
    if (mounted === (component ?? null)) return;
    mounted = component ?? null;
    tui.setFocus(mounted);
  }

  // The exit restore (§2.7), armed while the screen is started and not closed. It writes synchronously
  // (a TTY stdout write is synchronous in Node on POSIX), because nothing after an `exit` listener runs.
  let restored = false;
  function restore() {
    if (restored || !started || closed) return;
    restored = true;
    term.write(EXIT_RESTORE);
  }
  const onProcessExit = () => restore();
  const onSignal = (sig) => {
    restore();
    onExit.exit?.(128 + (osConstants.signals[sig] ?? 0));
  };
  function arm() {
    onExit.on('exit', onProcessExit);
    for (const sig of EXIT_SIGNALS) onExit.on(sig, onSignal);
  }
  function disarm() {
    onExit.off('exit', onProcessExit);
    for (const sig of EXIT_SIGNALS) onExit.off(sig, onSignal);
  }

  function start() {
    if (started || closed) return;
    started = true;
    arm();
    tui.start();
    // pi-tui asks only for button-motion under a multiplexer (it can lag there); the person wants hover
    // everywhere, so all-motion is asked for again after it (§2.2). pi-tui's stop turns ?1003 off itself.
    if (underMultiplexer(env)) term.write(ALL_MOTION_ON);
  }

  return {
    colour: useColour,
    host: tui,
    mount,
    renderNow() {
      if (closed) return;
      start();
      painting = true;
      try {
        tui.renderNow();
      } finally {
        painting = false;
      }
    },
    setHoverY(y) {
      hoverY = Number.isInteger(y) ? y : null;
    },
    listen(input, error, mouse) {
      onInput = input;
      onError = error;
      onMouse = mouse ?? null;
      start();
    },
    paint(next) {
      if (closed) return;
      if (mounted) mount(null);
      frame = next;
      start();
      painting = true;
      try {
        tui.renderNow();
      } finally {
        painting = false;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (!started) return;
      disarm();
      tui.stop({ preserveScreen: true });
    },
  };
}

// How long a `no` from the merged check stands before git is asked again (single-runs DESIGN §2.8).
export const MERGED_CHECK_MS = 30000;

// createMergedCheck({ contains, intervalMs }) → mergedCheck(view, { now }) → boolean: whether a finished
// `ready` single run's branch is in its base branch, so the row can stop calling for the person once
// their merge lands, with no process kept alive to watch (single-runs DESIGN §2.8). It asks
// baseContains(pir/{name}, { root, refs: [refs/heads/{base}] }) at most once per intervalMs per row and
// keeps the answer in memory; a yes is final and is never asked again. Only the local base is read: the
// hand-off merges there. A row with no base, branch or repo path on record reads not merged without
// asking. `contains` is injected so a test counts the calls; `now` is the caller's clock (ms).
export function createMergedCheck({ contains = baseContains, intervalMs = MERGED_CHECK_MS } = {}) {
  const cache = new Map();
  return function mergedCheck(view, { now }) {
    const key = runKey(view);
    const hit = cache.get(key);
    if (hit && (hit.merged || now - hit.at < intervalMs)) return hit.merged;
    const r = view?.record ?? {};
    const base = r.baseBranch ?? view?.snap?.runState?.base ?? null;
    let merged = false;
    if (base && r.branch && r.repoPath) {
      try {
        merged = !!contains(r.branch, { root: r.repoPath, refs: [`refs/heads/${base}`] });
      } catch {
        merged = false; // a repo that has gone reads as not merged, and is asked again next interval
      }
    }
    cache.set(key, { at: now, merged });
    return merged;
  };
}

// loadDashboard({ dir, now, kill, exec, fs, liveness, merged }) → { rows, counts }. The read half of a refresh (DESIGN §3.4):
// enumerate every index entry (T06), resolve each run's liveness (T05) and classify it (T01), read its
// snapshot (T07) for the progress/worker detail, then project the lot through buildDashboard (T04). Each
// row carries its record and snapshot alongside the fields the list needs, so the loop can act (stop/remove)
// and paint the watch view from the same read. Rows are sorted by repo then slug for a stable list order,
// since listRecords returns them in no guaranteed order.
// `liveness` (pid → { alive, liveStartTime }) defaults to an uncached resolveLiveness; runTui passes its
// createLivenessCache so a keypress does not spawn a `ps` per run. `merged` (mergedCheck) likewise
// defaults to an uncached one, and runTui passes the one it keeps.
export function loadDashboard({ dir = indexDir(), now = Date.now(), kill, exec, fs, liveness = (pid) => resolveLiveness(pid, { kill, exec }), merged = createMergedCheck() } = {}) {
  const records = listRecords({ dir, fs });
  const views = records.map((record) => {
    const { alive, liveStartTime } = liveness(record.pid);
    const state = classifyRun({
      recordedStartTime: record.startTime,
      finalState: record.finalState,
      alive,
      liveStartTime,
    });
    const snap = readSnapshot(record.controlDir, fs ? { fs } : {});
    // A planning run's snapshot has steps, not tasks (pir-plan-command §3.5): buildDisplay is the build's
    // model and is not fed it. Its WK is the number of live sessions, which is one or none.
    if (record.kind === 'plan' || snap?.runState?.kind === 'plan') {
      const live = (snap?.runState?.steps ?? []).filter((st) => st.worker?.live).length;
      const key = `${record.repo}__${record.slug}`;
      return { key, slug: record.slug, state, repo: record.repo, progress: { done: 0, total: 0 }, workers: live, snap, record, controlDir: record.controlDir };
    }
    // A single run's snapshot has steps too (single-runs DESIGN §3.5). Only a finished `ready` row asks
    // whether its branch is in the base (§2.8); every other state has nothing merged to find.
    if (record.kind === 'single' || snap?.runState?.kind === 'single') {
      const live = (snap?.runState?.steps ?? []).filter((st) => st.worker?.live).length;
      const key = `${record.repo}__${record.slug}`;
      const view = { key, slug: record.slug, state, repo: record.repo, progress: { done: 0, total: 0 }, workers: live, snap, record, controlDir: record.controlDir };
      if (state === 'finished' && snap?.runState?.outcome === 'ready') view.merged = merged(view, { now });
      return view;
    }
    const display = snap ? buildDisplay(snap.runState, { now }) : null;
    const progress = display
      ? { done: display.summary.done, total: display.summary.total }
      : { done: 0, total: 0 };
    // The live-worker count is the number of active workers this pass — exactly buildDisplay's `running`
    // tally (the active phases, DESIGN §2.4), so the list and the live view agree on it.
    const workers = display ? display.summary.running : 0;
    // key mirrors the index filename (`{repo}__{slug}`, §2.8): the slug alone repeats across repos.
    const key = `${record.repo}__${record.slug}`;
    return { key, slug: record.slug, state, repo: record.repo, progress, workers, snap, record, controlDir: record.controlDir };
  });
  views.sort((a, b) => a.repo.localeCompare(b.repo) || a.slug.localeCompare(b.slug));
  return buildDashboard(views);
}

// openDashboard(deps) / openWatch(slug, deps) — the two entry points pir.mjs (T11) dispatches to. The
// dashboard opens on the list; the watch form opens straight into a run's live view (`pir start {slug}` drops
// into the run it just started/opened, §2.1), and ← from there steps back to the list like any other open
// run (Esc quits pir; user 2026-09-22). Both run the one loop below.
//
// Only the bare dashboard publishes what it has open (PIR_DASHBOARD_STATE, dashboard-publish.mjs), for the
// agentic-ide cockpit that shows it in a pane; `pir start` and `pir plan` land in the same loop and do not.
export async function openDashboard(deps = {}) {
  const { makePublisher = createDashboardPublisher, ...rest } = deps;
  const publisher = makePublisher({ env: rest.env ?? process.env, now: rest.now ?? Date.now, ...(rest.fs ? { fs: rest.fs } : {}) });
  try {
    return await runTui({ ...rest, publisher, initial: initialUi() });
  } finally {
    publisher?.close();
    // After the screen is restored, so the one line cannot tear a frame.
    publisher?.report(rest.stderr ?? process.stderr);
  }
}

export function openWatch(slug, deps = {}) {
  return runTui({ ...deps, initial: { ...initialUi(), view: 'watch', openSlug: slug } });
}

// openPlanner(key, deps) — where both forms of `pir plan` land (pir-plan-command §2.12): the run's watch view
// told to open its `plan` step's conversation as soon as the snapshot names the planner's session. Until then
// the view says `starting the planner…`, and ← gives up the wait for the steps view.
export function openPlanner(key, deps = {}) {
  return runTui({ ...deps, initial: { ...initialUi(), view: 'watch', openSlug: key, openStep: 'plan' } });
}

// openBuilder(key, deps) — as openPlanner, for a single run (single-runs DESIGN §2.1, §2.8): the run's watch
// view told to open its `build` step's conversation once the snapshot names the builder's session. Until then
// the view says `starting the builder…`.
export function openBuilder(key, deps = {}) {
  return runTui({ ...deps, initial: { ...initialUi(), view: 'watch', openSlug: key, openStep: 'build' } });
}

// The step's session as the 'worker' view opens it (dashboardReducer's `open` on a step row), or null.
function stepWorker(step) {
  const w = step?.worker;
  return w?.id ? { taskId: step.id, workerId: w.id, logPath: w.logPath ?? null, live: !!w.live } : null;
}

// landStep(ui, views) → ui (§2.12). While `ui.openStep` names a step of the open planning or single run, the
// view waits for that step's session; once the snapshot names it, the ui is that session's conversation, the
// step row selected. Any other ui passes through unchanged.
export function landStep(ui, views) {
  if (!ui?.openStep || ui.view !== 'watch') return ui;
  const steps = openTasks(views, ui);
  const i = steps.findIndex((s) => s.id === ui.openStep);
  const openWorker = stepWorker(steps[i]);
  if (!openWorker) return ui;
  return { ...ui, view: 'worker', openWorker, taskSel: i, openStep: null };
}

// followStep(ui, views, seenReviewId) → ui with the reviewer's conversation open, or null for no move (§2.12;
// single-runs DESIGN §2.8 for a single run, whose first step is its builder's).
// Only a person in the planner's (builder's) conversation is moved, and only when the review step gains a
// session that was not there when that conversation opened (`seenReviewId`): reopening a finished run's
// planner must not bounce the person into its old reviewer. The steps view and the list are never moved.
export const FOLLOW_LINE = 'the planner finished; the reviewer has started';
export const SINGLE_FOLLOW_LINE = 'the builder finished; the reviewer has started';

// followFrom(view) → the step a run's reviewer follows and the line that heads the move, or null for a build.
function followFrom(view) {
  if (isPlan(view)) return { step: 'plan', line: FOLLOW_LINE };
  if (isSingle(view)) return { step: 'build', line: SINGLE_FOLLOW_LINE };
  return null;
}

export function followStep(ui, views, seenReviewId = null) {
  if (ui?.view !== 'worker') return null;
  const from = followFrom(findOpen(views, ui));
  if (!from || ui.openWorker?.taskId !== from.step) return null;
  const steps = openTasks(views, ui);
  const i = steps.findIndex((s) => s.id === 'review');
  const openWorker = stepWorker(steps[i]);
  if (!openWorker || openWorker.workerId === seenReviewId) return null;
  return { ...ui, openWorker: { ...openWorker, headLine: from.line }, taskSel: i };
}

// The landing frame's words by the step it waits on: the state the row reads while that step works, and the
// line (pir-plan-command §2.12; single-runs DESIGN §2.1 for the builder).
const LANDING = {
  plan: { state: 'planning', line: 'starting the planner…' },
  build: { state: 'building', line: 'starting the builder…' },
};

// buildLandingFrame(view, step) → the frame shown while `pir plan` waits for the planner's session, or the box's
// `/single` for the builder's (step `build`). FrameView clips each line to the terminal's width, as it does
// every frame. A run not yet renamed goes by its label in quotes, whichever kind it is.
export function buildLandingFrame(view, step = 'plan') {
  const branch = view?.record?.branch;
  const { state, line } = LANDING[step] ?? LANDING.plan;
  const label = view?.record?.label;
  const name = label ? `"${label}"` : view ? displayName(view) : '';
  return [
    [span(name, 'head'), span(` · ${state}${branch ? ` · ${branch}` : ''}`, 'dim')],
    [],
    lineOf(`  ${line}`, 'dim'),
    [],
    lineOf("← the run's steps · esc quit", 'hint'),
  ];
}

// isBuilding(rows, repo, slug) → whether the dashboard rows hold a build (not a planning or single run) of that slug, in
// that repo, running now: the slug pop-up's ` · building` (box-commands §2.2, §3.4). The repo is matched as
// startRun records it, the folder's basename, since two repos can share a slug.
export function isBuilding(rows, repo, slug) {
  const name = basename(repo?.path ?? '');
  return (rows ?? []).some((r) => !isPlan(r) && !isSingle(r) && r.state === 'running' && r.slug === slug && r.repo === name);
}

// runTui — the input/paint loop (DESIGN §2.3, §2.4, §5.1). It paints a first frame, then repaints on every
// keypress (through dashboardReducer, T04) and on a short refresh poll (§2.4: watch the snapshot by
// polling, the safe default). A pi-tui screen owns the keyboard (raw mode included) and hands keys over
// through `listen`; a screen without `listen` (a non-TTY, or a test's fake) gets raw mode and stdin from
// here, as before. It ALWAYS restores raw mode and leaves the alternate screen on exit — a clean quit, a
// stop/remove error, or a paint throw — via the finally block, so the terminal is never left in raw mode
// or the alternate screen (the T15/close discipline, §2.14). Everything the tests must not really do is
// injected: stdin/stdout, the clock, the process boundary (kill/exec), the screen, the loader, and
// stop/remove.
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
  resume = resumeRun,
  start = startRun,
  decline = (record, { dir }) => updateRecord({ repo: record.repo, slug: record.slug }, { go: 'declined' }, { dir }),
  readProgress = (record) => planHome(record.slug, { root: record.repoPath }).read('PROGRESS.md'),
  // A dropped single run's report body (single-runs DESIGN §2.8): state.json keeps it, the snapshot does not.
  readDropped = (record) => JSON.parse((fs ?? { readFileSync }).readFileSync(join(record.controlDir, 'state.json'), 'utf8'))?.accepted?.body ?? null,
  mergedCheck = createMergedCheck(),
  drop,
  follow,
  publisher = null,
  startPlan = startPlanRun,
  startSingle = startSingleRun,
  scan = scanRepos,
  scanBuildable = scanPlans,
  initial = initialUi(),
} = {}) {
  const dir = indexDir({ env });
  const screen = makeScreen({ stream: stdout, colour });
  let ui = initial;
  let spin = 0;
  // The selection is pinned to a RUN (its runKey), not to a row index, so a refresh never moves the
  // highlight even if the list changes underneath it (user 2026-09-22: "the selection keeps dropping
  // because of the refresh"). onData writes the run the user moved to; repaint re-derives the index from
  // it each frame, and only falls back to clamping the old index if that run is no longer listed. It is
  // the key and not the slug because two repos can share a slug: pinned by slug, ↓ onto the second of a
  // same-slug pair snapped back to the first, so no row below it could be reached (user 2026-09-25).
  let selectedKey = null;
  // The task row is pinned the same way, by task id, and per run (by runKey): a refresh that adds or
  // removes task rows keeps the highlight on its task, and two runs of one slug keep separate selections.
  const selectedTask = new Map();
  // The pointer's screen row (mouse-navigation §3.5): a paint concern, held beside `ui` and never in the
  // reducer, so a pointer move does not count as an event that clears `armed`. It follows the screen row,
  // not a run, so after a refresh or a click-open the row now under the pointer is the one lit (§2.2).
  let hoverY = null;
  // What the person sees now, so a click reads the lines they read (§3.3): the painted frame (null while
  // the list view or a conversation is mounted; the list view hands its own block to onMouse) and the rows
  // it was built from, which turn a hit's index into a run key or a task id before a fresh read.
  let painted = null;

  const liveness = createLivenessCache({ kill, exec, now });
  const read = () => load({ dir, now: now(), kill, exec, fs, liveness, merged: mergedCheck });

  // The open worker's conversation view (T13), created on entering the 'worker' view and disposed on
  // leaving it. It takes every key while it is open: its own table (§2.11) replaces Esc-quits and
  // Ctrl+C-quits, and it calls back on ← to step out.
  let conv = null;
  // The review step's session when the planner's conversation opened (followStep): only a new one moves it.
  let seenReviewId = null;
  let renderSoon = null; // a screen with no pi-tui host repaints the view on its own requests
  const host = screen.host ?? {
    terminal: { get rows() { return stdout.rows || 24; }, get columns() { return stdout.columns || DEFAULT_COLS; } },
    requestRender: () => renderSoon?.(),
  };

  // Tell the state file's reader what is open. The publisher writes only when that changes, so calling it
  // on every repaint costs nothing on a refresh tick or a cursor move.
  function publish(dash) {
    publisher?.update(ui, dash.rows);
  }

  // The runs list with its new-plan box (dashboard-plan-box §2.1, §3.2), mounted in the frame's place on a
  // screen that can mount a component and owns the keyboard (the pi-tui screen). A non-TTY screen, or a test's
  // paint-only fake, keeps today's painted list and key path: buildListFrame's box-less form is for exactly
  // that (T04). Built once and kept, so its text survives a refresh; it is reset to `@` on a start (§2.2).
  const boxed = typeof screen.mount === 'function' && typeof screen.listen === 'function';
  const roots = repoRoots(env);
  const rootsText = rootsLabel(roots, env);
  // The repos the pop-up last offered: the list view scans once per non-bare stretch (§2.4) through this, and
  // Enter parses against the same list the person just picked from. Scanned afresh only if it never scanned.
  let lastRepos = null;
  const repos = () => (lastRepos = scan({ env }));
  let listView = null;
  // The rows of the latest read, for the slug pop-up's ` · building` (isBuilding).
  let lastRows = [];
  const building = (repo, slug) => isBuilding(lastRows, repo, slug);
  // runTui's mouse handler, set once the input loop below is listening; the list view calls it for events
  // outside its box.
  let mouseHandler = null;
  // What the list view's last handleInput decided (its callbacks run synchronously inside it).
  let routed = null;
  function getListView() {
    if (!listView) {
      listView = createListView({
        tui: host,
        colour: screen.colour ?? false,
        repos,
        roots: rootsText,
        home: resolvePath(env.HOME || homedir()),
        // The list view caches this per repo until the box is bare again (§2.3). Only the path is passed:
        // runTui's `exec` is the process probe's, not the git runner scanPlans takes.
        plansOf: (repo) => scanBuildable(repo.path),
        building,
        onSubmit: (text) => (routed = { kind: 'submit', text }),
        onListKey: (data) => (routed = { kind: 'list', data }),
        onQuit: () => (routed = { kind: 'quit' }),
        onListMouse: (ev, frame) => mouseHandler?.(ev, frame),
      });
    }
    return listView;
  }

  function paintList(dash) {
    const lv = getListView();
    lastRows = dash.rows;
    lv.update({ dashboard: dash, ui, hoverY });
    screen.mount(lv);
    screen.renderNow();
  }

  // Enter on a box that is not bare (box-commands §2.4): a refusal keeps the text and says why. `/plan` resets
  // the box and lands in the planner's conversation exactly as `pir plan` does (openPlanner's ui, with the run's
  // key, since a run id alone could repeat across repos). `/start` starts or opens the build through startRun,
  // the call `pir start` makes, and lands in its live view as `pir start` does. `/single` starts a single run
  // and lands in its builder's conversation as `/plan` lands in the planner's (single-runs DESIGN §2.1).
  async function submitBox(text) {
    const lv = getListView();
    // The same cached plan scan the slug pop-up listed from, so Enter accepts exactly what it offered.
    const r = parseBoxText(text, lastRepos ?? repos(), { roots: rootsText, plansOf: lv.plansOf });
    if (!r.ok) {
      // The paths as the pop-up shows them, home as `~`: absolute, two of them overran 80 columns and the
      // second was cut off (T06 drill).
      const note = r.reason === 'ambiguous-repo' ? NOTES.ambiguousRepo(r.name, r.paths.map((p) => rootsLabel([p], env))) : r.note;
      lv.update({ note });
      return;
    }
    if (r.command === 'start') return submitStart(lv, r);
    if (r.command === 'single') return submitSingle(lv, r);
    let s;
    try {
      s = startPlan(r.brief, { cwd: r.repo.path, env, kill, exec });
    } catch (err) {
      lv.update({ note: startFailedNote(r.repo.name, err?.message ?? String(err)) });
      return;
    }
    if (!s?.started) {
      lv.update({ note: startFailedNote(r.repo.name, s?.reason ?? 'unknown', s) });
      return;
    }
    lv.reset();
    lastRepos = null;
    ui = { ...initialUi(), view: 'watch', openSlug: s.runId, openKey: `${s.record?.repo}__${s.runId}`, openStep: 'plan' };
  }

  // `/single`: a refusal keeps the text and says why; a start resets the box and waits for the builder's
  // session under the run's key, as `/plan` does for the planner's.
  function submitSingle(lv, r) {
    let s;
    try {
      s = startSingle(r.prompt, { cwd: r.repo.path, env, kill, exec });
    } catch (err) {
      lv.update({ note: startSingleFailedNote(r.repo.name, err?.message ?? String(err)) });
      return;
    }
    if (!s?.started) {
      lv.update({ note: startSingleFailedNote(r.repo.name, s?.reason ?? 'unknown', s) });
      return;
    }
    lv.reset();
    lastRepos = null;
    ui = { ...initialUi(), view: 'watch', openSlug: s.runId, openKey: `${s.record?.repo}__${s.runId}`, openStep: 'build' };
  }

  // `/start`: started and already-running both open the run's live view (§2.4, "start or open"). The key is the
  // build row's runKey, `{repo}__{slug}` with the repo as startRun records it (its folder's basename), so two
  // repos holding the same slug open the chosen one. The coordinator agent is on, as bare `pir start`.
  async function submitStart(lv, r) {
    let s;
    try {
      s = await start(r.slug, { cwd: r.repo.path, env, kill, exec });
    } catch (err) {
      lv.update({ note: startBuildFailedNote(r.repo.name, r.slug, err?.message ?? String(err)) });
      return;
    }
    if (!s?.started && !s?.alreadyRunning) {
      lv.update({ note: startBuildFailedNote(r.repo.name, r.slug, s?.reason ?? 'unknown') });
      return;
    }
    lv.reset();
    lastRepos = null;
    const repo = s.record?.repo ?? basename(r.repo.path);
    ui = { ...initialUi(), view: 'watch', openSlug: r.slug, openKey: `${repo}__${r.slug}` };
  }

  function closeConv() {
    conv?.dispose();
    conv = null;
    screen.mount?.(null);
  }

  function paintConv(dash) {
    if (!conv) {
      const open = findOpen(dash.rows, ui);
      const opened = { ...ui };
      const headLine = ui.openWorker?.headLine ?? null;
      conv = withHeadLine(headLine, (tui) => createConversationView({
        run: { slug: open?.slug ?? ui.openSlug, controlDir: open?.record?.controlDir ?? open?.controlDir ?? null },
        worker: ui.openWorker,
        // The coordinator is alive when the open run is `running` as classifyRun decides it (pid AND start
        // time, §2.5), read fresh at the moment of the drop.
        alive: () => findOpen(read().rows, opened)?.state === 'running',
        onBack: () => {
          ui = dashboardReducer(ui, { type: 'back' }, dash.rows).ui;
          closeConv();
          repaint();
        },
        tui,
        colour: screen.colour ?? false,
        ...(drop ? { drop } : {}),
        ...(follow ? { follow } : {}),
      }), { host, colour: screen.colour ?? false });
    }
    if (typeof screen.mount === 'function') {
      screen.mount(conv);
      screen.renderNow();
    } else {
      screen.paint(conv.render(Math.max(20, stdout.columns || DEFAULT_COLS)).map((l) => lineOf(l)));
    }
  }

  // Re-derive taskSel from the open run's pinned task id against a fresh read, then re-pin, as repaint
  // does for the list's `sel`. The keypress path runs it too, before the reducer, so an arrow moves from
  // where the task is now rather than from an index a refresh has since shifted.
  function syncTask(dash) {
    if (ui.view === 'list') return;
    const open = findOpen(dash.rows, ui);
    const runId = runKey(open) ?? ui.openKey ?? ui.openSlug;
    const tasks = openTasks(dash.rows, ui);
    let taskSel = ui.taskSel ?? 0;
    const idx = tasks.findIndex((t) => t.id === selectedTask.get(runId));
    if (idx >= 0) taskSel = idx;
    taskSel = Math.max(0, Math.min(taskSel, Math.max(0, tasks.length - 1)));
    // The separator above the agent's row is never selected (T12): a clamp that lands on it moves off it.
    if (tasks[taskSel]?.separator) taskSel = moveRow(tasks, taskSel, 1);
    ui = { ...ui, taskSel };
    if (tasks[taskSel]) selectedTask.set(runId, tasks[taskSel].id);
  }

  // The go question's width line reads the reviewed plan's PROGRESS.md through git (planHome), so it is
  // read once per run and kept, not on every refresh tick; the plan does not change while it waits.
  const progressCache = new Map();
  function goProgress(view) {
    const key = runKey(view);
    if (!progressCache.has(key)) {
      let text = null;
      try {
        text = readProgress(view.record);
      } catch {
        text = null;
      }
      progressCache.set(key, text);
    }
    return progressCache.get(key);
  }

  // A dropped single run's reason, read once per run and kept: a finished run's state.json does not change.
  // A read that fails (the folder was removed) is tried again on the next paint.
  const droppedCache = new Map();
  function droppedReason(view) {
    const key = runKey(view);
    if (!droppedCache.has(key)) {
      try {
        droppedCache.set(key, readDropped(view.record));
      } catch {
        return null;
      }
    }
    return droppedCache.get(key);
  }

  function repaint(dashboard) {
    const dash = dashboard ?? read();
    // Follow the open run through a rename (its index key changes under the open view, §2.6).
    ui = repinOpen(ui, dash.rows);
    let sel = ui.sel;
    if (selectedKey != null) {
      const idx = dash.rows.findIndex((r) => runKey(r) === selectedKey);
      if (idx >= 0) sel = idx;
      else selectedKey = null; // the pinned run is gone (removed) — fall back to the clamped index
    }
    sel = Math.max(0, Math.min(sel, Math.max(0, dash.rows.length - 1)));
    ui = { ...ui, sel };
    if (selectedKey == null) selectedKey = runKey(dash.rows[sel]); // seed / reseed the pin

    syncTask(dash);

    // `pir plan` lands in the planner's conversation once it has a session (§2.12), and a person still in it
    // when the reviewer starts follows into the reviewer's. A single run's builder is landed in and followed
    // from the same way.
    // The step row is re-pinned to the step now open, so ← from its conversation lands on that row.
    const moved = (next) => {
      ui = next;
      closeConv();
      selectedTask.set(runKey(findOpen(dash.rows, ui)) ?? ui.openKey ?? ui.openSlug, ui.openWorker.taskId);
    };
    const landed = landStep(ui, dash.rows);
    if (landed !== ui) moved(landed);
    // The planner's conversation about to be built: note the reviewer already there, before followStep reads
    // it, so opening a finished run's planner does not bounce the person into its old reviewer.
    if (!conv && ui.view === 'worker' && ui.openWorker?.taskId === followFrom(findOpen(dash.rows, ui))?.step) {
      seenReviewId = stepWorker(openTasks(dash.rows, ui).find((st) => st.id === 'review'))?.workerId ?? null;
    }
    const followed = followStep(ui, dash.rows, seenReviewId);
    if (followed) moved(followed);

    spin += 1;
    const spinnerChar = SPINNER[spin % SPINNER.length];
    painted = null;
    if (ui.view === 'watch' && ui.openStep) {
      screen.paint(buildLandingFrame(findOpen(dash.rows, ui), ui.openStep));
    } else if (ui.view === 'worker') {
      paintConv(dash);
    } else if (ui.view === 'watch') {
      const view = findOpen(dash.rows, ui) ?? { slug: ui.openSlug, state: 'crashed', repo: '', snap: null };
      // A crashed run's log tail is shown inline; read it only for the open, crashed run (not every row).
      const logTail = view.state === 'crashed' ? readLogTail(view.record?.controlDir ? join(view.record.controlDir, 'run.log') : null, 5, fs ? { fs } : {}) : null;
      const columns = Math.max(20, stdout.columns || DEFAULT_COLS);
      const progress = goOpen(dash.rows, ui) && view.record ? goProgress(view) : null;
      const dropped = isSingle(view) && view.record && view.state === 'finished' && view.snap?.runState?.outcome === 'dropped' ? droppedReason(view) : null;
      const frame = buildWatchFrame(view, { now: now(), spinnerChar, ui, columns, logTail, progress, dropped });
      painted = { frame, rows: dash.rows };
      screen.paint(frame);
    } else if (boxed) {
      painted = { frame: null, rows: dash.rows };
      paintList(dash);
    } else {
      const frame = buildListFrame(dash, ui, { columns: Math.max(20, stdout.columns || DEFAULT_COLS) });
      painted = { frame, rows: dash.rows };
      screen.paint(frame);
    }
    publish(dash);
  }

  // The screen reads the keyboard itself when it can (pi-tui); otherwise the loop drives stdin directly.
  const ownInput = typeof screen.listen !== 'function';
  if (ownInput && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
  if (ownInput && typeof stdin.resume === 'function') stdin.resume();

  try {
    await new Promise((resolve, reject) => {
      let refresh = null;
      let settled = false;

      function cleanup() {
        settled = true;
        renderSoon = null;
        if (refresh) clearInterval(refresh);
        if (!ownInput) return; // pi-tui drops its own stdin listener when the screen closes
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

      // The run action in flight (see onData), and how one is carried out.
      let acting = Promise.resolve();
      async function act(intent) {
        const view = read().rows.find((r) => runKey(r) === intent.key);
        if (!view) return;
        if (intent.type === 'stop') await stop(view.record, { kill });
        else if (intent.type === 'remove') remove(view.record, { dir, fs });
        else if (intent.type === 'resume') {
          // resumeRun (T08) re-spawns a planning program or starts the build; a refusal (the run came
          // back to life meanwhile, or startRun refused) is shown under the list rather than dropped.
          const r = await resume(view.record, { kill, exec, env });
          if (r && r.resumed === false) ui = { ...ui, note: `Could not resume ${displayName(view)}: ${r.reason}` };
        } else if (intent.type === 'start') {
          // The go (§2.8): the same call `pir start {slug}` makes. The build writes its own record under the
          // same key, so the open view becomes the build's live view on the next read. A refusal keeps the
          // question and says why under it.
          const r = await start(view.record.slug, { cwd: view.record.repoPath, kill, exec, env });
          if (r && r.started === false && !r.alreadyRunning) ui = { ...ui, note: `Could not start ${view.record.slug}: ${r.reason}${r.detail ? ` — ${r.detail}` : ''}` };
          else ui = { ...ui, taskSel: 0 };
        } else if (intent.type === 'decline') {
          decline(view.record, { dir });
        }
      }

      async function onData(data) {
        // A key pi-tui delivers between the quit and the screen closing belongs to nobody.
        if (settled) return;
        try {
          if (ui.view === 'worker' && conv) {
            conv.handleInput(Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? ''));
            if (ui.view === 'worker' && !settled) paintConv(read());
            return;
          }
          // On the list the box decides first (routeBoxKey, §2.3): a list key takes today's path below
          // unchanged, a submit starts the plan, and anything else was the box's own.
          if (boxed && ui.view === 'list' && !ui.openStep) {
            routed = null;
            getListView().handleInput(data);
            const r = routed;
            routed = null;
            // A key the box took (or a submit, or a reset) never reaches the reducer, whose invariant is that
            // every event but a chord's second half clears `armed` and the one-shot `note`. Without this, Ctrl+S,
            // then typing, then one more Ctrl+S stopped the run on a single press (T06 drill).
            if (r?.kind !== 'list' && (ui.armed || ui.note)) {
              ui = { ...ui, armed: null, note: null };
              if (r?.kind !== 'quit' && r?.kind !== 'submit') repaint();
            }
            if (r?.kind === 'quit') return finish();
            if (r?.kind === 'submit') {
              await submitBox(r.text);
              return repaint();
            }
            if (r?.kind !== 'list') return; // the box took it and asked pi-tui for a render itself
          }
          const key = decodeKey(data);
          if (key === 'quit') return finish(); // Esc or Ctrl+C: leave pir
          if (key == null) return;
          const dash = read();
          ui = repinOpen(ui, dash.rows);

          // Waiting for the planner's session: ← gives up the wait for the steps view; nothing else acts.
          if (ui.openStep) {
            if (key === 'back') ui = { ...ui, openStep: null, taskSel: 0 };
            return repaint(dash);
          }

          if (key === 'back') {
            // ← steps back a level: a worker → its run's live view → the list. In the list there is no
            // level to step back to (Esc quits), so ← is inert there.
            if (ui.view !== 'list') ui = dashboardReducer(ui, { type: 'back' }, dash.rows).ui;
            selectedKey = runKey(dash.rows[ui.sel]) ?? selectedKey;
            return repaint(dash);
          }

          const event = key === 'enter' || key === 'n' || key === 'c' ? { type: 'key', key } : { type: key };
          await dispatch(event, dash);
          repaint();
        } catch (err) {
          fail(err);
        }
      }

      // dispatch(event, dash) — one reducer event and everything that follows it: the selection pins and the
      // run action. The keys and the mouse both come through here, so a click and a key cannot drift apart
      // (mouse-navigation §2.1). `dash` is a read already repinned (repinOpen) by the caller.
      async function dispatch(event, dash) {
        const wasWatching = ui.view === 'watch';
        if (wasWatching) syncTask(dash);
        const { ui: nextUi, intent } = dashboardReducer(ui, event, dash.rows);
        ui = nextUi;
        // Pin the selection to whatever run the cursor is now on, so the next refresh keeps it there.
        selectedKey = runKey(dash.rows[ui.sel]) ?? selectedKey;
        if (wasWatching && ui.view === 'watch') {
          // …and the task row likewise, to the task the cursor is now on in the open run. Only a move
          // inside the live view re-pins it: opening a run starts its taskSel at 0, and repaint then
          // restores the task that run last had selected.
          const open = findOpen(dash.rows, ui);
          const task = openTasks(dash.rows, ui)[ui.taskSel ?? 0];
          if (task) selectedTask.set(runKey(open) ?? ui.openKey ?? ui.openSlug, task.id);
        }
        if (intent && intent.type !== 'quit') {
          // One run action at a time. A stop returns only after it has reaped the run's sessions, and
          // keys keep arriving meanwhile: the row can already read `stopped` (the program recorded it)
          // while the reap is still going, and a resume fired then had its new session killed by that
          // reap (pir-plan-command T11). So each action waits for the one before it, and then finds its
          // run in a fresh read, not in the rows of the keypress that armed it.
          const run = acting.then(() => act(intent));
          acting = run.catch(() => {});
          await run;
        }
      }

      // A hit's index is into the rows the frame was painted from; a fresh read may have moved them, so the
      // hit is carried across by run key (the list) or by row id (a build's tasks, a planning run's steps).
      // -1 when that row is gone.
      function resolveHit(hit, dash) {
        if (hit.kind === 'run') {
          const key = runKey(painted?.rows?.[hit.index]);
          return key == null ? -1 : dash.rows.findIndex((r) => runKey(r) === key);
        }
        const id = openTasks(painted?.rows ?? [], ui)[hit.index]?.id;
        return id == null ? -1 : openTasks(dash.rows, ui).findIndex((t) => t.id === id);
      }

      function setHover(y) {
        hoverY = y;
        screen.setHoverY?.(y);
        listView?.update({ hoverY: y });
      }

      // onMouse(ev, frame) — the painted frames' mouse (the live view, the steps view, the go question), and
      // the list's rows through the list view's onListMouse, which passes its own list block as `frame`
      // (mouse-navigation §2.1–§2.3, §3.2). Synchronous, as pi-tui's dispatch is: no event here produces a
      // run action, so the reducer and the repaint are done before it returns. Press, drag and release are
      // always declined (undefined), which leaves pi-tui its text selection and its synthesised click (§2.5).
      function onMouse(ev, frame = painted?.frame) {
        if (settled || !ev || ui.view === 'worker' || ui.openStep || !frame) return undefined;
        if (ev.type === 'move') {
          const changed = !sameHit(hitAt(frame, hoverY), hitAt(frame, ev.y));
          setHover(ev.y);
          return { handled: true, render: changed };
        }
        const wheel = ev.type === 'wheel' && ev.wheelDelta;
        const hit = ev.type === 'click' && ev.button === 'left' ? hitAt(frame, ev.y) : null;
        if (!wheel && !hit) return undefined;
        try {
          const dash = read();
          ui = repinOpen(ui, dash.rows);
          if (wheel) {
            // One notch is one ↑ or ↓, whatever pi-tui's lines-per-notch (§2.3).
            dispatch({ type: ev.wheelDelta < 0 ? 'up' : 'down' }, dash).catch(fail);
          } else {
            const index = resolveHit(hit, dash);
            if (index < 0) return undefined;
            dispatch({ type: 'select', index }, dash).catch(fail);
            dispatch({ type: 'open' }, dash).catch(fail);
          }
          repaint();
        } catch (err) {
          fail(err);
        }
        // rowClick: createScreen resets pi-tui's double-click count on it, so the next click is a click too.
        return wheel ? { handled: true } : { handled: true, rowClick: true };
      }
      mouseHandler = onMouse;

      renderSoon = () => {
        if (!settled && ui.view === 'worker' && conv && typeof screen.mount !== 'function') {
          try {
            paintConv(read());
          } catch (err) {
            fail(err);
          }
        }
      };
      if (ownInput) stdin.on('data', onData);
      else screen.listen(onData, fail, (ev) => onMouse(ev));
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
    conv?.dispose();
    if (ownInput && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    if (ownInput && typeof stdin.pause === 'function') stdin.pause();
    screen.close();
  }
}
