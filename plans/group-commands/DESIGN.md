---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Grouped tool steps in the conversation view — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan. T03
carries the resulting behaviour into `docs/detached-runs.md` (§ The conversation view, § Key bindings,
§ The mouse) and the README.

## 1. Purpose

A worker's conversation in `pir` (`src/shell/conversation-view.mjs`, drawn by `src/core/conversation.mjs`)
shows every tool step as its own `⎿` line. A worker runs dozens of steps between two messages, and the
person is not interested in them one by one: the steps bury the messages they do read. This plan folds
each run of consecutive steps into one line that counts them, `▸ Ran 2 shell commands, read 3 files`, and
lets the person unfold any group with a click. It applies wherever the conversation view is used: a build
worker, an end-of-run helper, the coordinator agent, and the planner and plan reviewer of `pir plan`.

### Success criteria

- Between two messages, finished steps take one line, whatever their number.
- A step still running is visible on its own line until it finishes, then joins the count.
- A failed step is never silent: its group line says `· N failed` in red. A step the person refused says
  `· N refused`, not failed.
- One click on a group line shows its steps; another click hides them. Dragging to copy text still works.
- Tab still shows full detail with every step and its output, as before this plan.

## 2. Behaviour specification

### 2.1 What forms a group (user 2026-09-29)

Every tool step groups, whatever the tool (user: not only shell commands). A group is a maximal run of
tool-use events with no drawn line between them. A message (the worker's, the person's, pir's), a
permission request or question set drawn in the scrollback, an interrupt, a failed-turn line, a pir note
(`· …`), a background line (`↳ …`) and an unreadable log line each end the group; the next step starts a
new one. An event that draws nothing (a tool result, `init`, a synthetic or empty text, a successful
`result`, a system event that is not background work, the pinned request, which is drawn below the
scrollback and not in it) does not end a group, because the person sees nothing between the steps it
separates.

A group's identity is the `toolUseId` of its first step. Groups only grow at their end and a break is
never removed, so the id is stable as the log grows and the view can remember which groups are open.

### 2.2 The group line (user 2026-09-29)

The group line counts the group's finished steps (a step whose result is in the log) per kind, listing
only the kinds present, in the order each kind first appeared, joined with `, `, first letter capitalised:
`▸ Ran 2 shell commands, read 3 files, edited 1 file`. A group of one finished step folds too, into
`▸ Ran 1 shell command` (user brief). Kinds, keyed by tool name, singular and plural:

| Tool | Phrase |
|---|---|
| Bash | ran N shell command / commands |
| Read | read N file / files |
| Write | wrote N file / files |
| Edit, MultiEdit, NotebookEdit | edited N file / files |
| Grep, Glob | searched N time / times |
| WebFetch | fetched N page / pages |
| WebSearch | searched the web N time / times |
| Task, Agent | ran N agent / agents |
| Skill | loaded N skill / skills |
| TodoWrite | updated the to-do list N time / times |
| AskUserQuestion | asked N question set / sets |
| Monitor | started N monitor / monitors |
| anything else | used {Tool} N time / times |

Tools sharing a phrase share one count (an Edit and a MultiEdit are `edited 2 files`), because the person
reads what happened, not which tool did it. An unknown tool keeps its own name, so a tool a newer Claude
adds still reads sensibly, as `mainArg` already does for step lines. The kinds were planner's wording
under the user's per-kind decision; the user read them back on 2026-09-29.

If any finished step in the group failed (`isError` on its result), the line ends in ` · N failed` in the
`step-error` style (user 2026-09-29: fold it, flag the group). The rest is the `step` style. The line is
one screen row, clipped at the width like a step line; the failed suffix is never clipped: the label is
cut first, so a failure stays visible at any width.

A step whose request was answered no is **refused**, not failed (user 2026-09-29, plan review): a refused
permission, including a typed reply that refuses, and a question set answered in text instead, whoever
answered (the person, the coordinator agent, pir's own rule). Claude records its result as `isError`, but
the person chose it, and red "failed" read as something that broke. It counts in its kind as usual and adds
` · N refused` in the `dim` style after any failed suffix (` · 1 failed · 1 refused`), never clipped
either; it is not counted as failed. The step is tied to its request by the request's `toolUseId`, which
`worker-proc.mjs` records on the log's `request` entry from the SDK's `canUseTool` `toolUseID` (today
it logs only `requestId`). A request without one (a log written before this plan) is tied when its
`requestId` equals the step's `toolUseId`; otherwise its step reads failed, as its `isError` says. Open,
a refused step's one-liner keeps today's `step-error` style: the `→ refused` line below says why.

The line starts `  ▸ ` while the group is folded and `  ▾ ` while it is open (planner; approved with the
prototype). The marker shows the line is clickable, which colour-off terminals need since they get no
hover.

### 2.3 Running steps (user brief)

A step with no result in the log is running. It is drawn as today's one-line step (`  ⎿ Bash npm test`),
after the group line, in the order the steps were used. When its result arrives it leaves its own line and
joins the group's count: "Ran 1 shell command" becomes "Ran 2 shell commands". A group whose steps are all
running has no group line yet, only the running lines. In a read-only view a step whose result never came
(the worker died mid-step) stays on its own line for good, as it does today.

### 2.4 Unfolding (user 2026-09-29)

A left click on a group line opens that group; a left click on it again folds it. An open group draws its
group line (`▾`) and under it each finished step as today's one-line step line indented two more columns
(`    ⎿ Read src/x.mjs  last result line`), a failed one in `step-error`. Running steps stay after the
finished ones, at today's indent, as in §2.3. There is no key for one group: the conversation view has no
cursor to pick a group with (§5 out of scope).

A click is pi-tui's synthesised click (press and release in one cell, no movement); press, drag and
release stay declined so text selection keeps working (mouse-navigation §2.5, docs/detached-runs.md § The
mouse). The click answers `{ handled: true, rowClick: true }`, so pi-tui's double-click count is reset and
two quick clicks are an open and a fold, never a word selection. A click on any other scrollback line does
nothing, as before this plan. Right and middle clicks do nothing. Clicks work in read-only views too.

The key hint line is unchanged: it names no click (user 2026-09-29, plan review), because it is full at
80 columns and the marker, the hover and the docs already show a group line opens.

The group line brightens under the pointer, as every clickable row in `pir` does (mouse-navigation §2.2:
hover applies to rows a click acts on), through `paintLine`'s `hovered`. With colour off there is no hover.

Which groups are open is held by the view and lasts while the person stays in that conversation; leaving
it (←, or the worker's view being replaced) forgets it (user 2026-09-29). It is not written anywhere,
because it is a reading aid, not state anyone else needs.

### 2.5 Keeping the place on a click (planner)

After a click, the clicked group line stays on the screen row it was on, so the steps appear under the
pointer and nothing the person was reading jumps. Exception: if the opened steps would run past the bottom
of the scrollback area, the view scrolls just enough to show the last of them, never so far that the
clicked line leaves the top. Folding keeps the clicked line on its row too, clamped at the end of the
history (scrolled to the end, the view follows new lines again). This matters because a click near the
bottom of a live conversation is the common case, and there the steps must come into view.

### 2.6 Full detail and Tab (user 2026-09-29)

Tab still switches between the default view and full detail. Full detail is exactly today's: every step
drawn with every result line, no groups, no group lines, so nothing is clickable there. Tab back shows the
groups again, the ones the person had opened still open, because the open set is kept across the switch.

### 2.7 Scrolled up while steps arrive (planner)

Folding changes the line count at the end of the history: a running step's line disappears into its
group's count. While the person is scrolled up, the view already shifts its offset by the lines that
arrived so the text they read does not move; that shift now uses the signed change (clamped at 0), so a
line folding away at the end does not nudge the text either. A rebuild caused by a click is not counted as
arrival: §2.5 places it.

## 3. Architecture

### 3.1 The boundary

`src/core/conversation.mjs` is pure (DESIGN of live-workers §3.1; `src/core/boundary.test.mjs` scans
`src/core/` for forbidden imports): the grouping, the labels, the open/folded drawing and which line is a
group line are decided there and tested exhaustively. `src/shell/conversation-view.mjs` only holds the
open set and the hover row, routes clicks and moves, and places the scroll offset. If the boundary test
fails, the fix is to move the code, never to relax the test.

### 3.2 Interface

`buildConversation(entries, { full, width, taskId, readOnly, open })` gains `open`, a `Set` of group ids
(default empty). Each group line in `lines` carries a `hit` property, `{ kind: 'group', id }`, on the line
array, the same convention the dashboard frames use for clickable rows (`FrameView` paints `hovered` only on
a line with a `hit`, mouse-navigation §3.3). Tagging the line the builder emits, rather than computing a
layout elsewhere, means a layout change cannot move a line without moving its hit. In full mode no line has
a `hit`.

The view maps a click's row to a scrollback line with the same arithmetic `render` uses to cut the visible
slice (header rows, `end`, `height`), so the painted line and the hit line are one line.

### 3.3 Modules

| Module | Side | Change |
|---|---|---|
| `src/core/conversation.mjs` | pure | grouping, labels, `open`, `hit`, refused (T01) |
| `src/shell/worker-proc.mjs` | shell | logs `toolUseId` on each `request` entry (T01, §2.2) |
| `src/shell/conversation-view.mjs` | shell | open set, click and hover, §2.5 and §2.7 scroll (T02) |
| `src/shell/conversation-rig.mjs` | shell, test rig | reused; a scenario is added only if the `tour` one cannot show a case (T02) |
| `docs/detached-runs.md`, `README.md` | docs | T03 |

## 4. Testing

- Pure (T01): `buildConversation` over hand-built logs: every §2.1 breaker, every §2.2 kind and plural,
  the failed and refused suffixes and their clipping at narrow widths, running steps before and after their result, open
  and folded, full mode unchanged, `hit` on group lines only, id stability as entries are appended.
- View (T02): `createConversationView` with synthetic mouse events in `conversation-view.test.mjs`: click
  toggles, clicks elsewhere and press/drag/release declined, `rowClick`, hover painting, §2.5 placement,
  §2.7 offset, Tab keeping the open set.
- End to end (T02, T03): the real `pir.mjs` under a pty through `conversation-rig.mjs` (`startRig`,
  `openScreen`, `mouseBytes`), against the fake Claude.

Existing tests that assert a default-mode `⎿` step line (`conversation.test.mjs`,
`conversation-view.test.mjs`, `conversation-rig.test.mjs`) change with the default: each is rewritten to
the grouped form or to an open group or full mode, whichever keeps what it was testing. None is deleted to
make the suite pass.

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon |
| Runtime | Node v24.2.0; python3 (the pty relay) |
| TUI | `@earendil-works/pi-tui` 0.87.1: `Component.handleMouse` gets every parsed event; `click` is synthesised from a declined press and release; `lastClick` holds the double-click count (see pir-tui.mjs `rowClick`) |
| Deliberately absent | no Playwright, nothing here is a web page; no `timeout` binary |

**The test command** is `npm test` (`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`): dots on green, a failure in full, colour forced off inside the command. For detail,
`node --test --test-reporter=spec <file>`. Measured green 2026-09-29 in this worktree after `npm ci` (about
3.5 minutes, most of it the pty suites). Without `npm ci` a fresh copy fails, so **setup** is `npm ci` of
the committed lockfile, which leaves the tree clean (`node_modules/` is ignored).

**Dependencies.** No new package. pi-tui already carries mouse parsing and click synthesis.

**End to end.** The existing rig carries it: `startRig` stands up a run with the fake Claude and its
`tour` scenario, whose opening has four paced consecutive steps (Read, Grep, a failing Bash, Edit), then a
message; `openScreen`/`driveScreen` run the real `pir.mjs` under a pty and `mouseBytes` sends real SGR
clicks. No second rig. Sizes: 80×24 and 120×40. The prototype (`prototype/index.html`) is a non-binding
reference for the look.

**After changing engine code, run `./install.sh`**, once the plan's code is on `main` and never while a run
is live, because live sessions use the installed engine. Built in parallel, the last task ends on a task
branch, so it does not install: it writes under PROGRESS "Blocked on the user" that the install follows
the person's merge.

### 5.1 What the test command cannot reach

Nothing new. Whether the person's terminal delivers clicks and pointer moves was verified by hand in the
mouse-navigation spike (2026-09-28); this plan uses the same events.

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Rig scratch HOME/PIR_HOME, fake Claude on `PATH` | no test touches the person's `~/.pir` or `~/.claude`, no model is called |
| `pbcopy` shim first on `PATH` (as `plan-rig.mjs`) | a drag or double click in a pty test never writes the person's clipboard; `startRig` lacks it today, T02 adds it before any drag test |
| Exit restore (mouse-navigation §2.7) | a failing pty test cannot leave its terminal reporting the mouse |

### 5.3 Outside the code — who acts

Both rules are already in `.claude/settings.json` `allow`. The user approved the table as is at plan review,
2026-09-29.

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | exact locked versions only | delete `node_modules` | none |
| Refresh the installed engine | `./install.sh`, once the code is on `main`, no run live | `worker` | local and idempotent | re-run from the previous commit | none |

## 6. Decisions and rationale

- User, 2026-09-29: every tool step groups, not only shell commands; the line counts per kind; a failed
  step folds and flags its group; a click opens and folds one group; Tab keeps full detail and unfolds
  everything there; the open set is forgotten on leaving the conversation. The read-back of §2 was
  confirmed the same day.
- User, 2026-09-29 at plan review: a step whose request was answered no reads `· N refused`, not failed
  (§2.2); the reviewer found Claude records a refusal as `isError`, which the plan would have shown in red.
- Prototype approved by the user 2026-09-29 (`prototype/index.html`), with the `▸`/`▾` markers.
- Planner, from the code survey: extend `stepLines`/`buildConversation` rather than add a second
  renderer, so full detail and the grouped view come from one place; reuse pi-tui's click synthesis, the
  `hit`-on-line convention and `paintLine`'s `hovered`, and the existing `conversation-rig` and its `tour`
  scenario for end-to-end tests. Nothing in the repo grouped steps before.
- Planner: the group id is the first step's `toolUseId` (§2.1), because a line index shifts as the log
  grows and a counter would renumber when a break appears.
- Planner: the mouse-navigation rule "a click in the conversation view outside the typing box does
  nothing" is amended by the user's decision here for group lines only; mouse-navigation's `DESIGN.md` is
  sealed, so the change lands in `/docs` (T03).

## 7. Explicitly out of scope

- A key to open one group: the view has no cursor, and adding one for this would change how every key in
  the view works (user chose the click).
- Open-all / fold-all: Tab's full detail already shows everything.
- Remembering open groups across visits or restarts: it is a reading aid, and folded is the calm default.
- Grouping in any other view: only the conversation view draws tool steps.
