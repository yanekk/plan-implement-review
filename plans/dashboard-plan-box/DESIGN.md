---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# The dashboard's new-plan box — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan.
T01 and T05 carry the resulting behaviour into `docs/planning-runs.md`, `docs/run-lifecycle.md`,
`docs/detached-runs.md` and the README. It never edits a finished plan's DESIGN.md.

## 1. Purpose

Starting a plan today means leaving `pir`, `cd`-ing into the repo and typing `pir plan`. The person
watches every run from the dashboard, so the dashboard is where they already are when they think of
the next thing. This plan puts a typing box at the bottom of the runs list: `@repo` picks the repo, the
rest of the text is the brief, and Enter starts the same planning run `pir plan` starts and lands the
person in the planner's conversation. It also removes the rule that refused to plan or build inside
the `plan-implement-review` checkout, at the user's direction.

### Success criteria

- From the runs list, typing `@skaut a packing list` and Enter starts a planning run in `~/src/skaut`
  and shows its planner's conversation, with no other command typed.
- On a bare `@` every key the list binds today does exactly what it did before this plan.
- Nothing is ever started from a text the person did not mean: an unknown or partial repo name, or no
  brief, starts nothing and says why.
- `pir plan`, the box and `pir start` all work inside `plan-implement-review` with no environment flag.

## 2. Behaviour specification

All decisions in this section are the user's, 2026-09-26, unless marked (planner).

### 2.1 Where the box is

The box is on the runs list only, pinned to the bottom of the screen. It is not on a run's live view,
a steps view or a conversation, because those views already bind every key and have their own box
(user). Bottom to top: the hint line, the box (pi-tui `Editor`, the same component the brief box and
the conversation view type into), the box's head line, and the one-shot note line when there is one.
The list fills the rows above.

### 2.2 The box starts as `@`

The box's text is `@` whenever the list opens, after a plan starts, and after a reset. A brief must
start with `@repo` (user: the repo is always explicit, so nothing is ever planned somewhere the person
did not name). The text is **bare** when it is exactly `@` or empty.

### 2.3 Which keys go where

On a bare box the list keeps its whole key table (user): ↑↓ select, → and Enter open, Ctrl+S/X/R arm and
confirm, Esc and Ctrl+C quit `pir`. No pop-up shows. Any other key (a printable character, a paste,
Backspace) goes to the box. An `@` typed, or a paste starting with `@`, into a box that is exactly `@` loses
that leading `@`, so `@skaut …` typed out of habit reads the same as `skaut …` (user, 2026-09-26).

Once the box is not bare:

| Key | Does | Why |
|---|---|---|
| any key while the repo pop-up is open | goes to the pop-up (↑↓ move, Tab/Enter pick, Esc closes it) | pi-tui's own completion behaviour, the one the person knows from the conversation box |
| Enter | submits (§2.5) | as in the brief box |
| Shift+Enter, Ctrl+J | new line | as in the brief box (`tui.input.newLine`) |
| Esc | resets the box to `@`, clears the note | user; a second Esc then quits |
| Ctrl+C | resets the box to `@`, as Esc | (planner) matches Esc here and the conversation box's Ctrl+C-clears; quitting still takes one more press |
| Ctrl+S, Ctrl+X, Ctrl+R | the list's chords, on the selected run, as on a bare box | (planner) a double-press chord cannot be typed by accident and loses no text |
| ↑↓←→ and everything else | the editor | a wrapped brief needs cursor movement |

The routing is a pure function (§3.2) so the table is tested exhaustively rather than through a pty.

### 2.4 The repo list and the pop-up

The repos are every git repo directly inside each root (user). The roots are `PIR_REPOS`, split on `:`,
`~` expanded, empty entries dropped; unset, the one root is `$HOME/src` (user). A root that does not
exist is skipped silently. An entry counts when its `.git` is a directory (a linked worktree's `.git`
file is skipped, because its main worktree is the repo and would otherwise be listed twice) and it has
a local `main` (`git rev-parse --verify --quiet refs/heads/main`), because `pir plan` refuses a repo
without one and the list offers only repos where Enter works (user). Repos are ordered most recently
worked in first, by the newest mtime of `.git/index`, `.git/HEAD` and `.git/logs/HEAD` (user; the
planner chose the three files because together they move on commit, checkout and staging), with the
name as the tie-break.

The scan runs when the box leaves bare and is reused until it is bare again (planner): the list costs
nothing to a person only watching runs, and a repo cloned since the last brief shows up in the next.

Typing after `@` opens pi-tui's autocomplete pop-up over the repos whose name contains the typed text
(case-insensitive), each row `@name` with its path (home as `~`) beside it, at most five visible
(`autocompleteMaxVisible`). Picking one replaces the token with `@name ` and the pop-up closes.

### 2.5 Submitting

The text is read as `@name`, then whitespace, then the brief (the rest, newlines kept, trimmed). Enter
starts nothing and sets the note, keeping the text, when:

| Case | Note |
|---|---|
| the text does not start with `@`, or `@` is followed by whitespace (no name) | `start with @repo, then say what to plan` |
| `name` is not exactly a listed repo's name | `no repo @{name} in {roots} — pick one from the list` |
| two listed repos share `name` (two roots) | `@{name} is in more than one folder: {path}, {path}` |
| the brief is empty | `say what to plan after @{name}` |
| `startPlanRun` refuses or throws | `Could not start planning in {name}: {reason}` |

A partial name is never completed on Enter (user, 2026-09-26, reversing an earlier yes to unique-prefix
matching): only an exact name starts a run. A name in two roots is the one repo §2.4's list offers that Enter
refuses; the pop-up shows both rows with their paths (user, 2026-09-27: never guess a folder, and it needs
two roots to happen). `{roots}` is the roots as the person would type them (`~/src`).

Otherwise the screen calls `startPlanRun(brief, { cwd: repo.path, env, … })`, the call `pir plan` makes,
resets the box to `@`, and opens the run as `openPlanner` does: `{ view: 'watch', openSlug: runId, openKey:
'{repo}__{runId}', openStep: 'plan' }` (`findOpen` matches `openSlug` against the bare slug, and the key keeps a run
id two repos share apart), so the person lands in the planner's conversation once it has a session, exactly as
after `pir plan` (planning-runs.md § Where `pir plan` lands). ← steps back as it does there; back on the
list, the box reads `@`.

### 2.6 What the head and hint lines say

The head line is `new plan  in {name}` (dim) when the text names a listed repo, `new plan  start with
@repo` (dim) when bare, and `new plan  @{name} is not a repo in {roots}` (amber, `your-go`) when it names
anything else, and `new plan  start with @repo` (amber) when there is no name at all (prototype). On a bare box the hint is the list's existing footer (`footerLine('list', …)`, armed
confirmations included) with ` · type to plan (@repo)` appended when it fits the width; not bare, it is
`↵ start planning · shift+↵ new line · esc clear`. Every line fits 80 columns, which the prototype's
hint did not.

### 2.7 A list taller than the screen

The list rows scroll so the selected row is always visible (user). When rows are cut, a dim `↑ {n} more`
line replaces the first visible row slot and `↓ {n} more` the last (planner), so the person knows the
list goes on. When the list block does not fit, its three blank spacer lines go first, then the title line;
the column header and the counts line stay (user, 2026-09-26: at 80×12 the full chrome left one run row).
The markers show only when there is room for them and at least one run row; the selected row always shows. The box grows as its text wraps (user); pi-tui's Editor already caps itself at 30% of the
terminal rows (minimum 5) and scrolls inside beyond that, which keeps the list at least partly visible.
The empty-list line becomes `No runs yet — type after @ below to plan something new`.

### 2.8 The canonical-repo guard is gone

`canPromoteHere`, the `canonical-repo` pre-flight refusal and `PARALLEL_ALLOW_HERE` are removed from
`pir plan`, `startPlanRun` and the coordinator (user: the person builds this project with the flag set
anyway, so it guarded against nothing they fear, and one rule beats a special case). The harness live
launcher (`src/shell/harness/run.mjs` `main`) keeps its own refusal to run a paid scenario in a checkout
named `plan-implement-review`, because that protects a paid test run, not the person's planning or
building (planner); its override becomes only `--into <dir>`, so the variable disappears everywhere.
The harness's `allowHere` plumbing, which existed only to pass the variable to the coordinator, goes.

### 2.9 Out of scope

- `@repo` in bare `pir plan`'s brief box (user): it plans in the repo it was typed in.
- Remembering the last repo, a config file, scanning deeper than one level (user).
- A box on any view other than the list (user).

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core/` decides and never reads a clock, a file or a process; `src/shell/` touches the
world. `src/core/boundary.test.mjs` scans `src/core/` for forbidden imports; if it fails, move the code,
never relax the test.

### 3.2 Modules

| Module | Side | Holds |
|---|---|---|
| `src/core/planbox.mjs` (new, T02) | pure | `parseBoxText`, `rankRepos`, `routeBoxKey`, `isBare`, the note texts |
| `src/shell/repo-scan.mjs` (new, T03) | shell | `repoRoots(env)`, `scanRepos({ env, fs, exec })` |
| `src/shell/list-view.mjs` (new, T04) | shell | `createListView`: the list frame windowed above the box, as one pi-tui component |
| `src/shell/pir-tui.mjs` (T04, T05) | shell | `buildListFrame` gains a row window; `runTui` mounts the list view and routes its submit |
| `src/shell/launch.mjs`, `coordinate.mjs`, `pir.mjs`, `harness/run.mjs` (T01) | shell | the guard's removal |

The list view is a mounted component rather than a painted frame because the box needs a cursor, focus
and pi-tui's asynchronous autocomplete, all of which `TuiAltScreen` gives only to a mounted component;
the conversation view (`conversation-view.mjs`) is the precedent. `buildListFrame` stays the one place
the list's rows are drawn, so the list looks identical.

### 3.3 Data flow

keypress → `runTui.onData` → list view mounted? → `routeBoxKey({ text, key, completing })` → `'list'`
(the existing `decodeKey`/`dashboardReducer` path) | `'box'` (editor) | `'reset'` | `'quit'` | `'submit'`
→ `parseBoxText(text, repos)` → note, or `startPlanRun` → `ui` to the planner landing. The repos come
from `scanRepos`, held by the list view per §2.4.

## 4. Testing

- Pure (T02): every row of the §2.3 table and every §2.5 case, `rankRepos` ordering and ties. Milliseconds.
- Shell against real git in temp folders (T03): roots, `~`, missing roots, worktree `.git` files, no
  `main`, ordering by mtime (set with `utimesSync`).
- The component with pi-tui's stub host (T04): render at widths and heights, windowing, wrap, the pop-up.
- End to end under a pty against the fake Claude (T05, T06): the plan rig (`src/shell/plan-rig.mjs`)
  with `PIR_REPOS` pointed at its scratch repo's parent.

No live Claude run: the box calls the same `startPlanRun` a real `pir plan` run already exercised
(pir-plan-command T18), so a live run would prove nothing this plan changes.

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon |
| Runtime | Node v24.2.0; git 2.50.1; python3 (the pty relay) |
| TUI | `@earendil-works/pi-tui` 0.87.1: `Editor` wraps, caps at 30% of rows, and has `setAutocompleteProvider` and `isShowingAutocomplete()` (measured 2026-09-26) |
| Deliberately absent | no `timeout` binary; no Playwright, nothing here is a web page |

**The test command** is `npm test` (`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`): dots on green, a failure in full. For detail, `node --test --test-reporter=spec
<file>`. This shell exports `FORCE_COLOR=3`, which is why the command sets `FORCE_COLOR=0` itself.
Measured green 2026-09-26. **Setup** is `npm ci` of the committed lockfile.

**Dependencies.** No new package; pi-tui already has the editor and the pop-up. Any addition is the
user's decision.

**End to end.** The existing tooling carries it: `openScreen`/`driveScreen` (`conversation-rig.mjs`) run
the real `pir.mjs` under a pty, and `startPlanRig` (`plan-rig.mjs`) stands up a scratch HOME, PIR_HOME
and repo with the fake Claude first on `PATH`. The rig sets `PIR_REPOS` to its scratch repos' parent.
Sizes: 80×24, 120×40, and 80×12 for a list taller than the screen. The throwaway mock in `prototype/`
(`node plans/dashboard-plan-box/prototype/plan-box-mock.mjs`) is a non-binding reference.

**After changing engine code, run `./install.sh`**, once the plan's code is on `main` and never while a
run is live, because live sessions use the installed engine. Built in parallel, T06 ends on a task branch
while the build is live, so it does not install: it writes under PROGRESS "Blocked on the user" that the
install follows the person's merge, and any session they ask runs it (user, 2026-09-27).

### 5.1 What the test command cannot reach

Nothing this plan needs. Whether the box is pleasant to use is judged by the T06 drill against this
design and the prototype.

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Plan rig scratch HOME/PIR_HOME | no test touches the person's `~/.pir`, `~/.claude` or `~/src` |
| Fake Claude on `PATH` | no model is called by the test command |
| `PIR_REPOS` in every test | the scan never reads the person's real folders |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | exact locked versions only | delete `node_modules` | none |
| Refresh the installed engine | `./install.sh`, once the code is on `main`, no run live | `worker` | local and idempotent | re-run from the previous commit | none |

## 6. Decisions and rationale

User decisions, 2026-09-26: everything marked (user) above. In addition:

- The prototype's direction was approved by the user on 2026-09-26 (`prototype/plan-box-mock.mjs`).
- Planner, from the code survey: extend the list screen into a mounted component beside
  `conversation-view.mjs` rather than paint an editor into the frame, because only a mounted component
  gets a cursor and pi-tui's async autocomplete. Reuse `startPlanRun` and the `openPlanner` landing
  unchanged; nothing about starting a planning run is rebuilt. Reuse the plan rig for end to end.
- Planner: the brief box (`brief-box.mjs`) is not reused as the box, because it is a full-screen
  component with its own Esc-cancels contract; its editor theme is the shared piece and may be lifted
  into a helper both use.
- Planner: the harness keeps its paid-scenario guard (§2.8), since removing the build guard does not
  make an accidental paid run in the real checkout safe.
