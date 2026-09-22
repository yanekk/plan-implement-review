# T12 — dashboard-tui

**Phase:** 4 · **Depends on:** T04, T07, T09, T10, T11 · **Weight:** heavy

## Goal

The dashboard as a live terminal application: the cross-repo list, opening a run into its ticking
task display, Esc navigation, and the double-confirm stop/remove chords. Everything a person could
check is already proven pure (T04) or in the stores and control logic (T06–T10); this task is the
raw-mode painting and input loop that wires them to a real terminal, and it is the piece only the
user's eyes can settle.

## Design sections this implements

DESIGN §2.3 (the dashboard), §2.4 (the live view), §2.6/§2.7 (the chords), §2.11 (appearance and
key bindings — **binding**), §5.1 (hand-verified).

**The prototype binds this task's colours and behaviour** (§2.11, `prototype/index.html`). Build the
semantic colour mapping and the interaction model as specified; do not redesign them. The live
view's colours come from reusing `src/shell/render.mjs` unchanged; the list's colours follow §2.11.
Exact terminal spacing and column widths are yours — a real terminal is not the browser mock.

## Files

- `src/shell/pir.mjs` — extend: the `openDashboard`/`openWatch` the dispatch (T11) calls.
- `src/shell/pir-tui.mjs` — new (if it keeps `pir.mjs` thin): the raw-mode loop and painting.
- `src/shell/pir-tui.test.mjs` — new: what can be tested without a TTY (frame content).
- Reuses `src/core/dashboard.mjs` (T04), `src/core/display.mjs` + `src/shell/render.mjs` for the
  live view, `src/shell/index-store.mjs` (T06), `src/shell/identity.mjs` (T05),
  `src/core/runstate.mjs` (T01), `src/shell/snapshot-store.mjs` (T07),
  `src/shell/control-run.mjs` (T09).

## Interface

```
openDashboard({ stdin=process.stdin, stdout=process.stdout, ...deps } = {}) → Promise<void>
openWatch(slug, { ... } = {}) → Promise<void>

loop each refresh:
  list view:  listRecords → resolveLiveness + classifyRun per run → read each snapshot for
              progress/workers → buildDashboard → paint rows + counts + key-hint/armed footer.
              With no rows, paint the get-started line "No runs yet — start one with `pir {slug}`"
              in place of the empty list (§2.3).
  watch view: readSnapshot(openSlug) → buildDisplay(runState,{now}) → render.mjs styledLines → paint;
              a stale/final run shows its last frame marked stale (§2.4).
  keys → dashboardReducer (T04) → apply intent: 'quit' leaves; 'stop' → stopRun (T09);
         'remove' → removeRun (T09); 'open'/'back' switch views.
```

- Refresh the live view by polling the snapshot on a short interval (the safe default — FSEvents
  behaviour with atomic renames is the kind of thing that bites, PLAN). Watching the file is a later
  option, not this task's risk to take.
- Reuse `render.mjs`'s alt-screen enter/leave, clip-to-terminal and `styledLines` for the watch
  frame, so the live view is byte-for-byte the coordinator's display. The list is new painting but
  follows the same clip-and-colour approach.
- Raw mode: set `stdin.setRawMode(true)`, decode arrows / Enter / Esc / Ctrl+S (0x13) / Ctrl+X
  (0x18); always restore raw mode and leave the alt-screen on every exit, including a thrown error
  (the T15/close discipline in `render.mjs`).

## Tests

- [ ] the frame builder for the list produces the expected lines from a fixed set of run views
      (paint logic separated from the TTY, like `render.test.mjs`).
- [ ] the watch frame equals `render.mjs`'s `formatLines(buildDisplay(runState,{now}))` for a fixed
      snapshot — i.e. it is the coordinator's display, not a reimplementation.
- [ ] a key-decode table maps the arrow/Enter/Esc/Ctrl-S/Ctrl-X bytes to the reducer events.
- [ ] a stale/final run renders its last frame with the stale marker.
- [ ] with no runs, the list frame shows the get-started line, not a blank list (§2.3).
- [ ] the list frame applies the §2.11 colour mapping: running green, crashed red, finished/stopped
      dim; progress bar blue when running and red when crashed; the selected row marked; the armed
      confirmation amber and bold. Assert the styles the frame builder emits, the way `render.test.mjs`
      asserts the coordinator's line styles.
- [ ] raw mode and the alt-screen are restored on a thrown error (a close is always called).

## Done when

- [ ] The list uses the §2.11 semantic colours and the live view reuses `render.mjs`, so both
      palettes match the prototype and the coordinator; a test asserts the list frame's styles.
- [ ] The interaction model matches §2.1–2.7 and §2.11: start-or-open, open into the live block, Esc
      back then quit, finished/crashed openable, Ctrl+S/Ctrl+X double-confirm with an armed line.
- [ ] `npm test` passes and the terminal is never left in raw mode or the alt-screen on exit.

## Needs a person

The list content, the reducer and the watch frame are all tested, but whether the app *reads right*
— the in-place repaint, the feel of moving and opening, the confirm chords — can only be judged by
a person at a real terminal. The worker starts one or two real runs, then hands over:

```
pir                 # the dashboard: arrow-move between runs, open one (Enter), watch it tick, Esc back, Esc quit
# on a running run: Ctrl+S once (armed line appears), Ctrl+S again (it stops)
# on a stopped/finished run: Ctrl+X twice (its record clears)
```

Expect: the list repaints cleanly with no leftover rows; opening a run shows the same ticking
display as `pir-coordinate`; Esc steps back then quits; the chords arm on the first press and act on
the second; a cancelled arm (any other key) does nothing.
Tell me: does it read and feel right, and did anything paint wrong, lag, or leave the terminal in a
bad state on exit?
