---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Mouse navigation in the `pir` dashboard — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan.
T07 carries the resulting behaviour into `docs/detached-runs.md`, `docs/human-flow.md`,
`docs/coordinator-agent.md` and the README.

## 1. Purpose

The `pir` dashboard is keyboard-only, and mouse reporting is switched off on purpose (`createScreen`,
`{ mouse: false }`) so the terminal's own text selection keeps working. The person wants to move around
it with the mouse as well: click a run, a task or a step to open it, see which row the pointer is on,
and scroll with the wheel. The keyboard stays exactly as it is.

### Success criteria

- One click on a run in the list, a task in a build's live view or a step in a planning run's view
  opens it, as selecting it and pressing Enter does.
- The row under the pointer is visibly brighter than its neighbours and distinct from the selected
  row's grey band, in a plain terminal. Under tmux, screen and zellij pir asks for pointer movement
  (`?1003h`, pty-tested); whether a real multiplexer delivers it is unchecked (tmux and zellij are not
  installed here; user at plan review, 2026-09-28).
- The wheel scrolls a worker's conversation, and moves the selection in the run, task and step lists.
- Dragging across text still copies it to the clipboard.
- Every key does what it did before this plan, and quitting or crashing never leaves the person's shell
  in mouse-reporting mode.

## 2. Behaviour specification

All decisions in this section are the user's, 2026-09-28, unless marked (planner).

### 2.1 Click opens

A left click on a row opens it at once (user): the run list's rows, a build's live-view rows, and a
planning run's step rows. A build's live-view rows are `openTasks`'s entries (`rowEntries`,
pir-coordinator T11/T12): the plan's tasks, then, once its coordinator agent has started, a separator line
and the agent's pinned row, then any end-of-run helper (main-sync, tests-fix) while it runs. It is exactly `select` of that row followed by `open`, through the same reducer path a
key takes, so the selection lands on the clicked row and ← comes back to it. A double click is two clicks,
each acting on the screen it lands on: on a run it opens the run, then opens the live-view row now under
the pointer (user at plan review, 2026-09-28: every click counts, no suppression). Whatever `open` does for
that row, the click does: a task with no worker shows the same "no worker" note → shows (user), the
coordinator agent's row opens the agent's conversation as → on it and `c` do (or shows
`noCoordinatorNote` when it has no session), a helper's row opens its worker, a planning step with no
session shows its note, and a step row under the go question opens the step (it is `open`, not the go
question's Enter). The separator above the agent's row is never selected by a key (`moveRow`), so it is
not a row for the mouse either: no click, no hover (planner, following the keys).

A click that is not on a row does nothing (user): the title, the column header, the `↑ n more` markers,
blank lines, notes, the counts line and the hint line. A click on a row opens it whatever the modifier
keys (planner: nothing else is bound to a modified click). Right and middle clicks do nothing (planner).

A click is a press and a release in the same cell with no movement between, as pi-tui decides it; a
press that moves is a text selection (§2.5), never a click, so starting a drag on a row does not open it.

### 2.2 Hover

The row under the pointer is painted brighter (user): its text bold, and its dim spans lifted to a
lighter colour so a finished or stopped run brightens too. An amber-bold span (an `asking you` row) turns a
brighter amber, since bold alone changed nothing on it (user, T08 drill, 2026-09-28). A hovered row that is also the selected row
paints as the selected band only, because the band already marks it and two cues on one row read as
noise (planner). Hover applies only to rows a click would open (§2.1). The look was confirmed by the user
in the spike, 2026-09-28 (FINDINGS).

Hover follows the pointer's screen row, not a run: when a refresh reorders the list, or a click opens a
new view, the row now under the pointer is the one highlighted, because that is what a click there would
open (planner). The terminal does not report the pointer leaving the window, so the last hovered row
stays lit until the pointer moves again inside it (planner; the same as Claude Code). With colour off
(`NO_COLOR`) there is no hover, since bold is painted only with colour (planner).

Hover needs the terminal to report pointer movement (all-motion tracking, `?1003h`). pi-tui turns that
off under tmux, screen and zellij because multiplexers can lag. The user wants hover everywhere, so pir
re-enables it there after the screen starts (user, 2026-09-28; the spike does this and pi-tui's stop
turns it off again). The spike ran outside any multiplexer and tmux is not installed on this machine, so
only the request is proven (§5.1).

### 2.3 Wheel

In a worker's conversation, the wheel scrolls the history, three lines a notch, as PgUp/PgDn do a page
(user; three is the planner's). In the run list, a build's task list and a planning run's steps, one
notch is one ↑ or ↓ (user), wherever the pointer is on that screen, and it goes through the reducer as
those keys do, so it clears an armed chord and steps over the agent's separator as they do. On the landing screen (`starting the planner…`)
the wheel does nothing (planner).

### 2.4 What stays on the keyboard

Going back, quitting, the go question (`↵ start · n not now`), a worker's question picker, the
permission prompt (allow/refuse), the Ctrl+R/S/X chords and `c` (open the coordinator agent) have no
mouse action (user; `c` added by the planner on 2026-09-28 when the coordinator agent landed, since it
is a hint-line key and the agent's row is clickable anyway). The end-of-run hand-off (`ready to merge`)
is a footer and a list state, not a control, so it has none either. The hint lines
stay plain text: they are not buttons and do not hover. Every key keeps its current meaning (user).

### 2.5 Text selection and copy

With mouse reporting on, the terminal no longer selects text itself; pi-tui's own selection does
(user accepted, 2026-09-28): a drag highlights text across any lines and copies it to the clipboard
on release. In most terminals Option-drag (iTerm2) or Shift-drag (Ghostty, others) still gives the
terminal's native selection. pir copies through `pbcopy` on macOS, which reached the real clipboard in
the spike, rather than pi-tui's default OSC 52, which some terminals refuse or ask about (planner). On
another platform pi-tui's OSC 52 default stays.

### 2.6 Clicks inside the typing boxes

pi-tui's Editor already handles its own clicks: a click in the box moves the caret there, and a click on
an entry of the new-plan box's `@repo` pop-up picks it. Both come for free once mouse events reach the
box, and both are kept (user for the caret; planner for the pop-up, on the ground that it is picking from
a list, which is what the mouse is for here; confirmed by the user at plan review, 2026-09-28). A click on a run while the
new-plan box holds text opens the run, and the text is still in the box when the person comes back
(user), because the list view is built once and kept (`getListView`).

### 2.7 Always on, and always turned off

The mouse is always on, with no setting to switch it off (user). A non-TTY run has no pi-tui screen and
so no mouse. Because a shell left in mouse-reporting mode prints escape codes on every pointer move, pir
turns every mouse mode off on every exit it can see: a normal quit (pi-tui's stop), a thrown error
(runTui's `finally`), process `exit`, and SIGTERM, SIGHUP and SIGINT (planner). SIGKILL cannot be caught;
`reset` in the shell recovers from it, and the docs say so.

### 2.8 Out of scope

- Clickable hints, buttons, a back button, or right-click actions (user: navigation stays on the keys).
- Mouse answers to a worker's questions or permission prompts (user).
- An off switch or an opt-in setting (user).
- The brief box of bare `pir plan` beyond what the Editor does by itself (planner: it has no list). The
  mouse is on there through `createScreen`, but no task drills it (user at plan review, 2026-09-28: same
  code path as the dashboard, small risk).

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core/` decides and never reads a clock, a file or a process; `src/shell/` touches the
world. `src/core/boundary.test.mjs` scans `src/core/` for forbidden imports; if it fails, move the code,
never relax the test. The frame builders in `pir-tui.mjs` are pure functions living in the shell by
history; this plan keeps them pure and tests them without a TTY.

### 3.2 How a mouse event travels

pi-tui parses SGR mouse sequences in its own input listener, which runs before pir's key listener, and
dispatches a `TuiMouseEvent` (`type` press/release/move/drag/click/wheel, zero-based `x`/`y`,
`wheelDelta`) to the layout root's `handleMouse`. In `createScreen` the root is `guarded`. A handler
that returns `undefined` for press, drag and release lets pi-tui run its text selection and synthesise
the `click` (measured in the spike); returning `{ handled: true }` for a press would take the selection
away, so no pir handler handles press, drag or release.

```
terminal ─SGR→ pi-tui ─TuiMouseEvent→ guarded.handleMouse
   ├─ a component is mounted (list view, conversation view)  → component.handleMouse(ev)
   │     list view: box rows → Editor.handleMouse; list rows → onListMouse(ev) → runTui
   │     conversation view: wheel → scroll(±3·n); box rows → Editor.handleMouse
   └─ a painted frame (live view, steps, landing, go question) → runTui's onMouse(ev)
runTui: move → hoverY; click on a hit line → dispatch select+open; wheel → dispatch up/down
```

### 3.3 Row hits

A click or a hover must know which run, task or step is on a screen line. The frame builders already
decide every line's position, so they tag the row lines they emit rather than a second function
recomputing the layout (planner: a parallel layout function would drift from the painted one). A row
line is still an array of spans, carrying one extra property, `hit`:

```
line.hit = { kind: 'run' | 'task' | 'step', index }   // index into dashboard rows, openTasks, or plan rows
```

A build's `task` hits index `openTasks` (= `rowEntries`), so the coordinator agent's row and the helpers'
rows are `task` hits like any task, and `open` already tells them apart. The separator line carries no
hit.

`hitAt(frame, y)` returns `frame[y]?.hit ?? null`. The list view's list block starts at screen row 0,
and a painted frame is cut from the top, so a frame line's index is its screen row. The conversation
view has no row hits.

### 3.4 Modules

| Module | Side | Change |
|---|---|---|
| `src/shell/pir-tui.mjs` | pure builders | `buildListFrame`, `windowListBlock`, `buildWatchFrame`, `buildPlanWatchFrame` tag row lines; `hitAt` (T02) |
| `src/core/dashboard.mjs` | pure | `select` in the live view sets `taskSel` (T02) |
| `src/shell/pir-view.mjs` | pure | `paintLine(…, { hovered })`, `FrameView` paints the hovered line (T03) |
| `src/shell/palette.mjs` | pure | the hover colours (T03) |
| `src/shell/pir-tui.mjs` | shell | `createScreen`: mouse on, `copySelection`, multiplexer `?1003h`, exit restore, `guarded.handleMouse` (T04); `runTui` `onMouse` (T05); `withHeadLine` forwards `handleMouse` (T06) |
| `src/shell/list-view.mjs` | shell | `handleMouse`, hover in `update` (T05) |
| `src/shell/conversation-view.mjs` | shell | `handleMouse`: wheel scroll, box clicks (T06) |
| `src/shell/conversation-rig.mjs` | test rig | private modes, bold cells, mouse byte helpers (T01) |

### 3.5 State

Hover is `hoverY`, a screen row or null, held by `runTui` beside `ui`, not in the reducer: it is a paint
concern with no effect on what any key does, and keeping it out of the reducer keeps the reducer's
"every event clears `armed`" invariant true without an exception for pointer moves (planner). A move
repaints only when the hit under the pointer changes, so a pointer crossing a line does not repaint on
every cell (planner).

## 4. Testing

- Pure (T02, T03): every builder's hits at several sizes, including a windowed list with markers and a
  cut frame; `hitAt` off the end; `select` in the live view; `paintLine` hovered, hovered and selected,
  colour off.
- The screen with pi-tui's fake terminal (`fakeTerminal` in `pir-tui.test.mjs`, whose `press` feeds raw
  bytes through pi-tui's parser): SGR moves, clicks, drags and wheels reach the right handler, a drag
  copies through an injected `copy`, and the exit handlers write the mouse-off sequence.
- End to end under a pty (`openScreen`, `startPlanRig`, the fake Claude): T01's helpers send real SGR
  bytes to the real `pir.mjs`; the screen model reports the private modes and bold cells.

No test calls the real `pbcopy`: `createScreen` takes the copy function as a dependency, so the test
command never overwrites the person's clipboard. The real `pbcopy` path was checked in the spike.

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon |
| Runtime | Node v24.2.0; python3 (the pty relay) |
| TUI | `@earendil-works/pi-tui` 0.87.1: `TuiAltScreenOptions` `mouse`, `wheelScrollLines`, `copyOnSelect`, `copySelection`; `Component.handleMouse`; Editor handles `click` (caret, pop-up); enables `?1000h ?1002h ?1003h ?1004h ?1006h`, only button-motion under `TMUX`/`STY`/`ZELLIJ`/`TERM=tmux*`/`screen*`; stop writes `?1006l ?1004l ?1003l ?1002l ?1000l` (measured 2026-09-28) |
| Deliberately absent | no `timeout` binary; no Playwright, nothing here is a web page |

**The test command** is `npm test` (`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`): dots on green, a failure in full. For detail, `node --test --test-reporter=spec
<file>`. This shell exports `FORCE_COLOR=3`, which is why the command sets `FORCE_COLOR=0` itself.
Measured green in a fresh worktree 2026-09-28, before and after the pir-coordinator merge (`7c59312`),
which `setup` left clean. **Setup** is `npm ci` of the
committed lockfile.

**Dependencies.** No new package: pi-tui already carries mouse parsing, selection and the Editor's click
handling. Any addition is the user's decision.

**End to end.** The existing tooling carries it: `openScreen`/`driveScreen` (`conversation-rig.mjs`) run
the real `pir.mjs` under a pty, and `startPlanRig` (`plan-rig.mjs`) stands up a scratch HOME, PIR_HOME
and repo with the fake Claude first on `PATH`. Its `coordinator-drill` script set stands up a build with
a coordinator agent and its `end-helper` set one with an end-of-run helper (pir-coordinator T07, T11);
those carry the agent's and helpers' rows. T01 extends the screen model; no second rig is built.
Sizes: 80×24, 120×40, and 80×12 for a list taller than the screen. The spike in `prototype/`
(`node plans/mouse-navigation/prototype/spike.mjs`) is a non-binding reference for the look.

**After changing engine code, run `./install.sh`**, once the plan's code is on `main` and never while a
run is live, because live sessions use the installed engine. Built in parallel, T08 ends on a task branch
while the build is live, so it does not install: it writes under PROGRESS "Blocked on the user" that the
install follows the person's merge.

### 5.1 What the test command cannot reach

Whether the person's own terminal sends pointer moves, clicks and wheel events, and whether `pbcopy`
reaches their clipboard. Both were verified by hand with the user in the spike on 2026-09-28 (FINDINGS);
nothing in this plan changes them, so no task asks the person again. Whether a real tmux, screen or
zellij forwards pointer moves to pir is also out of reach and stays unchecked (§1, user at plan review).

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Injected `copy` in `createScreen` | no test writes the person's clipboard |
| Plan rig scratch HOME/PIR_HOME | no test touches the person's `~/.pir`, `~/.claude` or `~/src` |
| Fake Claude on `PATH` | no model is called by the test command |
| Exit restore (§2.7) | a failing pty test cannot leave the terminal it ran in reporting the mouse |

### 5.3 Outside the code — who acts

Confirmed by the user at plan review, 2026-09-28; both rules are already in `.claude/settings.json` `allow`.

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | exact locked versions only | delete `node_modules` | none |
| Refresh the installed engine | `./install.sh`, once the code is on `main`, no run live | `worker` | local and idempotent | re-run from the previous commit | none |

## 6. Decisions and rationale

User decisions, 2026-09-28: everything marked (user) above. In addition:

- Amended 2026-09-28 after the pir-coordinator plan merged to `main` (`7c59312`): the live view's rows
  became `rowEntries` (tasks, separator, the agent's pinned row, end-of-run helpers), `c` opens the agent,
  and the list gained `ready to merge` with wider STATE. The mouse follows the keys on all of it (§2.1,
  §2.3, §2.4); no user decision was needed.
- The spike (`prototype/spike.mjs`) was run by the user in their own terminal on 2026-09-28: hover
  brightens rows and looks right, and click, wheel and drag-to-copy behave. It stands as the approved
  direction and replaces a T00: the only load-bearing unknown, whether the person's terminal delivers
  pointer moves to pi-tui, is answered.
- Planner, from the code survey: reuse pi-tui's mouse parsing, click synthesis, selection and Editor
  click handling rather than decode SGR in pir; reuse the reducer's existing `select` event for runs and
  extend it to tasks; reuse the conversation view's `scroll(by)` for the wheel; extend the pty rig's
  screen model rather than build a mouse rig.
- Planner: hits are tagged on the lines the builders already emit (§3.3), not computed by a separate
  layout function, so a layout change cannot move a row without moving its hit.
- Planner: `pbcopy` over OSC 52 on macOS (§2.5), because it does not depend on the terminal's clipboard
  permission and was proven in the spike.
