---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# The dashboard box takes commands — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan.
T04 carries the resulting behaviour into `docs/planning-runs.md`, `docs/detached-runs.md` and the README.
It never edits a finished plan's DESIGN.md: the box it changes was designed in `plans/dashboard-plan-box/`,
and where this file and that one disagree, this one wins for the box's grammar, completion and submit.

## 1. Purpose

The runs list's box (dashboard-plan-box) reads `@repo brief` and can only start a planning run. Building a
reviewed plan still means leaving `pir` and typing `pir start {slug}` in the repo. This plan makes the box
a small command line with two commands, `@repo/plan <brief>` and `@repo/start <slug>`, and guides every
step with a pop-up list: repos, then the two commands, then the repo's plans that can be built. The person
starts both kinds of run from where they already watch runs, without remembering a slug.

### Success criteria

- `@sk`, Enter, ↓, Enter, then Enter on the highlighted plan, then Enter starts that plan's build in `skaut`
  and shows its live view, with nothing typed but the three letters (user, plan review 2026-09-28: `plan`
  stays above `start` in the command pop-up, as in the prototype, so one ↓ reaches `start`).
- `@skaut/plan a packing list` and Enter starts planning exactly as `@skaut a packing list` does today.
- Nothing starts from a text that did not name its repo, its command and its argument exactly: every
  other text starts nothing and the note under the list says why.
- On a bare `@` every key the list binds today does what it did before this plan.

## 2. Behaviour specification

All decisions are the user's, 2026-09-28, unless marked (planner). Everything dashboard-plan-box §2 says
about the box and this section does not change stays as it is: where the box is (§2.1), `@` as its bare
text and the `@` absorbed on a bare box (§2.2), the key table (§2.3), which repos are listed and how they
are ranked (§2.4), a list taller than the screen (§2.7).

### 2.1 The grammar

The first line reads `@name`, `/`, `command`, then whitespace and the argument (the rest of the text,
trimmed; a brief keeps its newlines). `name` is the characters after `@` up to the first `/` or
whitespace, because a repo folder name never holds a `/`. The commands are exactly `plan` and `start`,
lower case (user).

- `@name/plan <brief>` starts a planning run in the repo, as the box does today.
- `@name/start <slug>` starts, or opens, the build of that plan in the repo, as `pir start <slug>` run in
  the repo does.

The old form `@name <brief>` no longer plans (user): one spelling for each thing, and a text that did not
name its command starts nothing. `pir plan` and `pir start` typed in a terminal, and the brief box, are
unchanged (user).

### 2.2 The pop-up, step by step

The box uses pi-tui's autocomplete pop-up, at most five rows (dashboard-plan-box §2.4), for three
contexts, decided from the first line's text before the cursor:

| Context | Text before the cursor | Rows | Picking one (Tab or Enter) |
|---|---|---|---|
| repo | `@` then name characters, no `/` yet | the repos whose name contains the typed part, case-insensitive, as today: `@name`, path beside it | writes `@name/`, cursor after the `/`, and opens the command pop-up (user) |
| command | `@name/` then letters | `plan` (`plan something new`) and `start` (`build a reviewed plan`) that start with the typed part | writes `@name/plan ` or `@name/start ` with one space; `start` opens the slug pop-up (user) |
| slug | `@name/start`, whitespace, then non-whitespace | the repo's buildable plans (§2.3) whose slug contains the typed part, in slug order (planner) | writes the slug, no trailing space, and closes; a second Enter starts it (user) |

- Typing `/` by hand after a name, or letters after it, opens or narrows the same pop-ups as picking does
  (user). A repo pick keeps whatever followed the name token (`/plan brief` survives a changed repo), and adds
  the `/` only when one is not already there (planner).
- The pop-up opens again by itself only after a typed character, a deletion or a repo or command pick, and
  only when the cursor is at the end of the first line (planner): an Esc that closed it must not have it
  reopen on the next render, a slug pick must not reopen a one-row list of the slug just picked, and a
  cursor moved back into the middle of a brief must not pop a list over it.
- Esc with a pop-up open closes it and keeps the text; Esc again resets the box to `@` (user; as §2.3 of
  dashboard-plan-box). Enter with a pop-up open picks, never submits (dashboard-plan-box §2.3 row 1).
- The slug pop-up shows each plan's progress beside it, `{done}/{total} done`, and ` · building` when a
  build of that slug in that repo is running now (user, approved in the prototype).
- A repo with no buildable plan opens no slug pop-up; the head line says so (§2.5; user).

### 2.3 Which plans are buildable

A plan is offered after `/start` when `pir start` would build or resume it (user): its PROGRESS.md says
the plan is reviewed, its DESIGN.md has a valid setup/test block (without one the engine counts the plan
as not reviewed, declared-test-command §2.3), and it has at least one task and at least one task not ✅.
A plan whose build is running now is offered too (user): Enter opens its live view, as `pir start` does.
An unreviewed plan is not offered, because Enter would only refuse it (user).

The plans are found where `pir start` looks (`planHome`, pir-plan-command §2.9): every folder under the
repo's `plans/` with a PROGRESS.md in its working tree, and every local branch `pir/{slug}` whose committed
tree holds `plans/{slug}/PROGRESS.md`, the working tree winning for a slug in both. Planning branches not
yet renamed (`pir/plan-{hex4}`) hold no plan under their own name and so drop out on their own.

The scan runs the first time the slug context is entered for a repo, and is reused until the box is bare
again (planner, as the repo scan does): a plan reviewed since the last typed stretch shows in the next.

### 2.4 Submitting

Enter with no pop-up open reads the text (§2.1). It starts nothing, keeps the text and sets the note, in
this order (the first that applies wins):

| Case | Note |
|---|---|
| no `@name` at the start | `start with @repo/plan or @repo/start` |
| `name` is not a listed repo | `no repo @{name} in {roots} — pick one from the list` (unchanged) |
| `name` is in two roots | `@{name} is in more than one folder: {path}, {path}` (unchanged) |
| no `/command` (`@skaut`, `@skaut brief`, `@skaut/`) | `pick a command: @{name}/plan or @{name}/start` |
| a command other than `plan` or `start` | `@{name}/{command} is not a command — use /plan or /start` |
| `/plan` with an empty brief | `say what to plan after @{name}/plan` |
| `/start` with no slug | `name a plan to build after @{name}/start` |
| `/start` with more than one word | `@{name}/start takes one plan name` |
| `/start` with a slug not buildable (§2.3) | `{slug} is not a reviewed, unfinished plan in {name}` |
| `startPlanRun` refuses or throws | `Could not start planning in {name}: {reason}` (unchanged) |
| `startRun` refuses or throws | `Could not start {slug} in {name}: {reason}` |

The slug must be one the pop-up offers (planner, the rule the repo name already follows): an exact
name, never a prefix. `{reason}` for `startRun` is in plain words, as startFailedNote does for planning:
`not-reviewed` → `it is not reviewed`, `no-plan` → `there is no such plan`, `no-test-block` → `its DESIGN.md
has no setup/test block`, anything else as it came.

Otherwise:

- `/plan`: `startPlanRun(brief, { cwd: repo.path, env, … })` and the planner landing, exactly as today.
- `/start`: `startRun(slug, { cwd: repo.path, env, kill, exec })`, with the coordinator agent on, as bare
  `pir start` (planner). On `started` or `alreadyRunning` the box resets to `@` and the run's live view
  opens, `{ view: 'watch', openSlug: slug, openKey: <that run's list key> }`, the view `pir start` lands in
  (user). ← steps back to the list, which reads `@`.

### 2.5 What the head and hint lines say

The head line's label is `new` (the prototype; `new plan` no longer fits a build). After it:

| Text | Words | Style |
|---|---|---|
| bare | `start with @repo` | dim |
| no name | `start with @repo` | amber |
| a name not listed | `@{name} is not a repo in {roots}` | amber |
| a listed name, no command | `in {name} — /plan or /start` | dim |
| a command that is not `plan` or `start` | `/{command} is not a command — /plan or /start` | amber |
| `/plan` | `plan in {name}` | dim |
| `/start`, the repo has a buildable plan | `build in {name}` | dim |
| `/start`, the repo has none | `nothing to build in {name}` | amber |

The head line reads the plan scan only in the `/start` rows, so a person typing a brief never pays for it
(planner). The hint on a bare box is the list's footer with ` · type @repo to plan or build` appended when it
fits; typed with `/start`, `↵ start the build · esc clear`; otherwise, typed, the existing `↵ start planning ·
shift+↵ new line · esc clear`; an armed chord's `⚠` line still wins over both (dashboard-plan-box §2.6).
Every line fits 80 columns.

### 2.6 Out of scope

- `--no-coordinator` from the box (planner): it is a rare debugging flag, and `pir start --no-coordinator`
  still has it.
- Any command beyond `plan` and `start`, and any change to the terminal commands (user).
- Listing unreviewed or finished plans (user, §2.3).

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core/` decides and never reads a clock, a file or a process; `src/shell/` touches the
world. `src/core/boundary.test.mjs` scans `src/core/` for forbidden imports; if it fails, move the code,
never relax the test.

### 3.2 Modules

| Module | Side | Holds |
|---|---|---|
| `src/core/planbox.mjs` (T01) | pure | the grammar (`parseBoxText`), `completionContext`, `COMMANDS`, the notes, `headLine`, `startBuildFailedNote` |
| `src/core/buildable.mjs` (new, T02) | pure | `buildablePlan({ progress, design })` |
| `src/shell/plan-scan.mjs` (new, T02) | shell | `scanPlans(repoPath, { exec, fs })` |
| `src/shell/list-view.mjs` (T03) | shell | the three-context completion provider, the re-open rule, slug rows, the `new` label and hints |
| `src/shell/pir-tui.mjs` (T04) | shell | `runTui` passes the plan scan and the running test in, and routes `/start` to `startRun` |

The grammar and the context decision are pure so every §2.1–§2.5 row is tested in milliseconds; the list
view only carries them out, as it does today.

### 3.3 Re-opening the pop-up

pi-tui 0.87.1 (pinned exactly in package.json) closes the pop-up after a pick and never reopens it, and its
own triggers fire only on `@`, `#` and a leading `/`, so a `/` or a space after a name opens nothing by
itself. The list view therefore calls `editor.tryTriggerAutocomplete()` after the key (§2.2's rule). That
method is private in pi-tui's TypeScript types but a plain method at runtime; measured 2026-09-28, it opens the
pop-up on `@skaut/` and on `@skaut/start `. The public alternative, feeding the editor a Tab, was measured
and rejected: with one suggestion pi-tui applies it without showing the list, so a repo with one buildable
plan would get its slug filled in unseen. T03 pins the private call with a test, so a pi-tui upgrade that
renames it fails `npm test` rather than silently dropping the pop-up.

### 3.4 Data flow

key → list view → `routeBoxKey` (unchanged) → `'box'`: editor, then re-open check (`completionContext`) |
`'submit'` → `parseBoxText(text, repos, { roots, plansOf })` → note, or `{ command: 'plan' }` →
`startPlanRun`, or `{ command: 'start' }` → `startRun` → the landing. `plansOf(repo)` is `scanPlans`
cached per repo until bare; `building(repo, slug)` reads the latest dashboard rows the list view already holds.

## 4. Testing

- Pure (T01, T02): every §2.1 grammar case, every §2.4 row in order, every §2.2 context, every §2.5 row,
  every §2.3 buildable rule. Milliseconds.
- Shell against real git in temp folders (T02): plans on the working tree, on `pir/*` branches, both, a
  finished one, an unreviewed one, a `pir/plan-a1b2` branch, no `plans/` at all.
- The component with pi-tui's stub host (T03): each pick, the re-open rule, Esc, the slug rows.
- End to end under a pty against the fake Claude (T04, T05): the plan rig, `PIR_REPOS` at its scratch root,
  a reviewed plan committed in its scratch repo so `/start` has something to build.

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon |
| Runtime | Node v24.2.0; git 2.50.1 (measured 2026-09-28) |
| TUI | `@earendil-works/pi-tui` 0.87.1, pinned exactly; §3.3 is measured on it |
| Deliberately absent | no Playwright; nothing here is a web page |

**The test command** is `npm test` (`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`): dots on green, a failure in full. For detail, `node --test --test-reporter=spec
<file>`. This shell exports `FORCE_COLOR=3`, which is why the command sets `FORCE_COLOR=0` itself.
**Setup** is `npm ci` of the committed lockfile: a fresh worktree has no `node_modules`. Measured
2026-09-28 in a fresh worktree: setup leaves `git status` clean (`node_modules/` is ignored), tests green in
about four minutes.

**Dependencies.** No new package. Any addition is the user's decision.

**End to end.** The existing tooling carries it: `startPlanRig` (`plan-rig.mjs`) with `driveScreen` runs the
real `pir.mjs` under a pty in a scratch HOME, PIR_HOME and repo, the fake Claude first on `PATH`, `PIR_REPOS`
at the rig root. A `/start` test needs a reviewed plan in the rig repo; the rig's `drillPlanFiles` and the
`coordinator-drill` script set already build one with the fake. Sizes: 80×24, 120×40. The prototype
(`prototype/index.html`, open it in a browser) is a non-binding reference for the flow.

**After changing engine code, run `./install.sh`**, once the code is on `main` and never while a run is live,
because live sessions use the installed engine. Built in parallel, the drill ends on a task branch, so it
does not install: it writes under PROGRESS "Blocked on the user" that the install follows the person's merge.

### 5.1 What the test command cannot reach

Nothing this plan needs. How the flow feels is judged by the T05 drill against this design and the prototype.

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Plan rig scratch HOME/PIR_HOME | no test touches the person's `~/.pir`, `~/.claude` or `~/src` |
| Fake Claude on `PATH` | no model is called by the test command, including the build a `/start` test starts |
| `PIR_REPOS` in every test | the repo and plan scans never read the person's real folders |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | exact locked versions only | delete `node_modules` | none |
| Refresh the installed engine | `./install.sh`, once the code is on `main`, no run live | `worker` | local and idempotent | re-run from the previous commit | none |

Both rows confirmed by the user at plan review, 2026-09-28; both are already in `.claude/settings.json`'s allow list.

## 6. Decisions and rationale

User decisions, 2026-09-28: everything marked (user) above. In addition:

- The prototype's direction was approved by the user on 2026-09-28 (`prototype/index.html`).
- Planner, from the code survey: extend `planbox.mjs`, `list-view.mjs` and `runTui`'s `submitBox` rather than add
  a second box, because the box, its key routing and its repo scan already exist and only the grammar changes.
  Start builds through `startRun`, the call `pir start` makes, so every refusal and the "start or open" rule
  come with it. Find plans through `planHome`, so the list and `startRun` can never disagree on where a plan is.
- Planner: the buildable test is a new pure module, not a function inside `planbox.mjs`, because it reads
  PROGRESS and DESIGN formats (`parseProgress`, `parseTestBlock`) that the box's rules have no business with,
  and it lets T02 run beside T01.
- Planner: the slug must be exact and offered (§2.4), matching the repo rule, so a typo never starts a build
  of a finished or unreviewed plan.
- Planner: `tryTriggerAutocomplete` over a synthetic Tab (§3.3), measured.
