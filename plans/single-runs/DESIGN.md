---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Single runs — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T13 carries the resulting behaviour into a new `docs/single-runs.md`, `docs/README.md`, `README.md` and
the command table in `CLAUDE.md`. It never edits a finished plan's DESIGN.md.

**Built on base-branch.** This plan extends the settings files, the base-branch resolution and the
`git switch {base} && git merge` hand-off that `plans/base-branch` (on `pir/base-branch`, being built
when this plan was written) adds. Its build starts only after `pir/base-branch` is merged into `main`
and `main` is merged into `pir/single-runs` (user, 2026-09-29). Every function this file cites from that
plan (`parseSettings`, `effectiveBase`, `resolveBaseSetting`, `prepareBase`, `openPlanBranch(runId, {
root, base, from })`, `slugTaken`, `baseContains`, `refusalText`, the hand-off text) is named as that
plan's task docs define it; if the merged code differs, the merged code wins and the task doc is read
against it.

## 1. Purpose

Some changes do not need a plan: a bug fix, a typo, a small modification. Today the person either runs
the whole plan, review and build cycle for them, or leaves `pir` to work in a plain Claude session with
none of pir's guarantees. A single run is the third workflow type. The person types
`@repo/single <what to change>` in the dashboard box; pir cuts a branch in its own worktree, runs the
project's setup, holds a builder session that makes and commits the change, runs the tests itself,
then holds a fresh reviewer session that reads the change and fixes what it finds, runs the tests
again, and hands the person `git switch {base} && git merge pir/{name}` to run by hand, as a build does
today. No plan is written.

### Success criteria

- `@repo/single fix the typo in the README` in a scratch repo, answered through `pir`'s screen, ends
  with a reviewed, green branch `pir/{name}` named by the builder, the row reading `ready to merge`, and
  the base branch untouched. Proven with fake sessions in `npm test` (T08–T11) and once with real Claude
  (T12).
- A repo whose settings name no setup or test commands is refused before anything is created, with a
  message naming the file and the line to add.
- A red test run goes back to the session that caused it, at most three rounds before the session
  asks the person, and the session is told whether the tests also fail on the untouched starting point.
- Stop, resume and remove behave as for a planning run; the row turns `merged` once the person's merge
  lands.

### Stance

- The method's promise holds: nobody reviews their own work. A single run always has a fresh reviewer,
  even for a typo (user, 2026-09-29).
- Green is pir's word, not the session's. pir runs the setup and test commands itself, from settings
  the person committed or set, never from a session's claim (user, 2026-09-29).
- pir never merges, pushes or deletes a branch. The person merges by hand, as today.

---

## 2. Behaviour specification

### 2.1 The command

`@name/single <prompt>` in the runs list's box starts a single run in repo `name`. The prompt is the
rest of the text, trimmed, newlines kept, exactly like a `/plan` brief. The dashboard box is the only
way in; there is no `pir single` shell command (§8).

The box grows a third command (`src/core/planbox.mjs`). The command pop-up lists `plan`, `start`,
`single` in that order, `single` described as `change something small`. It is last so that the
learned `@sk ↵ ↓ ↵` still reaches `start` (box-commands, user 2026-09-28).

The box's texts that name the commands change to name all three:

| Where | Text |
|---|---|
| Enter, no `@name` | `start with @repo/plan, /start or /single` |
| Enter, no command | `pick a command: @{name}/plan, /start or /single` |
| Enter, other command | `@{name}/{cmd} is not a command — use /plan, /start or /single` |
| Enter, `/single` with no prompt | `say what to change after @{name}/single` |
| Enter, startSingleRun refused or threw | `Could not start the change in {name}: {reason}` |
| head line, `@name` alone | `in {name} — /plan, /start or /single` |
| head line, other command | `/{cmd} is not a command — /plan, /start or /single` |
| head line, `/single` | `change in {name}` (dim) |
| hint line, `/single` text | `↵ start the change · shift+↵ new line · esc clear` |

The refusal reasons in words (the `{reason}` above): `no-commands` → `no setup/test commands in its
.pir/settings.json`; `bad-settings` → `its pir settings are broken: {why}`; `empty-prompt` → `the
change is empty`; the base-branch refusal codes as base-branch words them for the box. Anything else
as it came. On `started`, the box resets to `@` and the screen lands in the builder's conversation
exactly as `/plan` lands in the planner's (`starting the builder…` until the program has named it).

### 2.2 Where the setup and test commands come from

The two settings files base-branch introduces gain two keys (user, 2026-09-29):

```json
{ "baseBranch": "main", "setup": ["npm ci"], "test": ["npm test"] }
```

- `setup` is a JSON array of non-empty strings; `[]` means no setup. `test` is a non-empty array of
  non-empty strings. Each entry is one shell line, run as a plan's setup/test block lines are
  (`runLines`/`startLines` in `src/shell/commands.mjs`: `/bin/sh -c` from the worktree root, scrubbed
  env, stop at the first failure).
- The repo file `<repo>/.pir/settings.json` is read first, then `~/.pir/{repo}/settings.json`; the user
  file overrides key by key, the same merge as `baseBranch`, so a person can change their own test
  line without a commit. `setup` and `test` merge independently.
- Both keys are required for a single run. Either missing after the merge refuses the start with
  `no-commands`, naming both files and the exact line to add. A file that is not valid JSON, or a key of
  the wrong shape, refuses with `bad-settings`, naming the file and what is wrong, even when the other
  file would supply a good value (base-branch §2.2's rule for a broken file).
- A single run reads the commands once, at its start, and stores them in its `state.json`, so a
  settings edit mid-run does not change what green means for a run already going.

Why settings and not a plan's DESIGN.md block: a single run has no plan, and "borrow the latest plan's
block" fails in a repo never planned and goes stale. Why refuse rather than let the session guess:
green must be pir's check against commands the person chose (§1 Stance). Plan builds keep reading
their DESIGN.md block; unifying the two sources is out of scope (§8).

### 2.3 Starting a run

`startSingleRun(prompt, { cwd })` (`src/shell/launch.mjs`), before anything is created, refuses in
order: not a git repo; the base-branch refusals (`planPreflight`'s, which resolve the base and its
commit); `bad-settings`/`no-commands` (§2.2); an empty prompt. Then:

- draws a run id `single-{hex4}`, redrawn while branch `pir/single-{hex4}`, index entry
  `{repo}__single-{hex4}` or folder `plans/single-{hex4}/` exists;
- cuts `pir/single-{hex4}` from the base commit in worktree `.claude/worktrees/pir-single-{hex4}`
  (`openPlanBranch(runId, { root, base, from })`, which is id-agnostic);
- creates the control folder `<root>/plans/single-{hex4}/.parallel/single/` with `prompt.md` and
  `state.json` (§3.5);
- spawns `src/shell/single-run.mjs --control <dir>` detached, exactly as the planning program is
  (own process group, `run.log`, `PIR_RUN=1`, `caffeinate -i -w`);
- writes the index entry `{repo}__single-{hex4}` with `kind: 'single'`, `label` (the prompt's first
  line cut to 24 characters, `labelFromBrief`), `baseBranch`, `go: null`.

The control folder sits under `plans/` for the planning run's reason: a session writes its reports
there, and Claude Code never auto-approves a write under `.git`. `plans/*/.parallel/` is already
gitignored. A single run therefore leaves a `plans/{name}/` folder holding only `.parallel/` in the
main checkout; it is invisible to git and is not a plan (no PROGRESS.md).

### 2.4 The run, step by step

The program (`single-run.mjs`) executes the pure decision `decideSingleStep` (§3.3). Steps:

1. **setup.** pir runs the `setup` lines in the run's worktree (`startLines`, log
   `setup.log`). A failure does not stop the run: the builder is started anyway with
   `formatSetupNote`'s note appended to its opening instruction, as a build worker is (best effort,
   declared-test-command). With `setup: []` this step is skipped.
2. **build.** pir holds the builder session in the worktree (§2.6). It makes the change, commits it, and
   reports `built` with the name it chose (§2.7).
3. **checks and tests.** On `built`, pir checks the claim (§2.7). A failed check is sent to the builder
   and the step carries on. On passing checks pir records the branch head and runs setup then test
   lines in the worktree (`tests-{n}.log`), the same pair `runFeatureTests` runs at the end of a build,
   because the change may have altered the dependencies.
   - Green, and the worktree is still clean at the recorded head: the step is done. If the head moved
     or the tree is dirty (the session went on editing), the tests run again.
   - Red: see §2.5.
4. **rename.** The builder is closed (the same idle gate the planning run uses, so a final commit is
   never cut off), then branch, worktree, control folder and index entry are renamed from
   `single-{hex4}` to the builder's name, in planflow's order and with its resume rules
   (planning-runs § The rename). The rename comes after the tests because a red run goes back to the
   builder, whose working directory must not move under it.
5. **review.** A fresh reviewer session is held in the renamed worktree. It reads the change against
   the prompt, fixes what it finds, commits, and reports `reviewed`. Its checks are the worktree being
   clean. Then the tests run as in step 3, and red goes back to the reviewer, except when the head is
   still the one step 3 tested green and the tree is clean: the reviewer changed nothing, so that result
   stands and the step is done (user, 2026-09-29, plan review: a second run of the same commit proves
   nothing and costs a full test run).
6. **done.** Green after review: the reviewer is closed and the run finishes with outcome `ready`. The
   row reads `ready to merge`, the steps view shows `git switch {base} && git merge pir/{name}`
   (base-branch's hand-off text), and the end alert is sent (§2.10).

Either session may instead report `dropped` (§2.7): the session is closed and the run finishes with
outcome `dropped`. The branch and anything committed on it stay.

Why two sessions in sequence and not one: the reviewer must not have seen the change being written
(§1 Stance). Why the reviewer fixes rather than sends back: that is how `pir-review` works on a task;
sending it back would reintroduce the builder into the review.

### 2.5 Red tests

Rounds are counted per step (build, review). A red run in a step:

- **The first red of the run** starts the baseline check: pir runs setup then test in a throwaway
  detached worktree `.claude/worktrees/pir-{id}-base` at the run's starting commit (`baseline.log`),
  then removes that worktree. The result is stored in `state.json` and reused for every later red of
  the run. The message to the session waits for it. Why only on red: the tests take minutes here, and a
  green change never needs the answer (user, 2026-09-29, over running it up front or in parallel).
- **Rounds 1–3**: pir sends the session a message (`singleflow.redMessage`):

  ```
  pir ran the tests on your commit {sha7} and they failed: {reason}. Round {n} of 3.
  {baseline line}
  Log: {logPath}
  {last lines of the log}
  Fix it, commit, and report again.
  ```

  The baseline line is `They also fail on the untouched starting point ({base} {sha7}), so the failure
  may be older than this change.` or `They pass on the untouched starting point ({base} {sha7}), so this
  change broke them.` or, when the baseline itself could not run (setup failed there),
  `The untouched starting point could not be tested: {reason}.`
- **Round 4 and later**: the same message, with its last line replaced by `This is round {n}, past the
  limit of 3: stop, tell the person what fails and what you tried, and ask how to go on. Report again
  only after they answer.` The session then stops and its row reads `asking you` by the ordinary
  stopped-session rule (§2.9); pir alerts the phone as for any question. Why a limit: a session that
  cannot solve a failure should not burn tokens looping on it; three rounds fixes the ordinary slip
  (user, 2026-09-29).

A person may also answer at any time in the conversation; nothing in the round count stops that.

### 2.6 The two sessions

Held as planning sessions are (planning-runs § The two sessions), through the shared holder (§3.2):
auto permission mode, the person's input through `startPersonInbox`, the same grants, the same log
format, `workers.json`, Remote Control on for the whole session (`PARALLEL_REMOTE=0` turns it off). No
coordinator agent: the person answers every question and permission request, as in planning.

- **One at a time**; the reviewer only after the builder is closed.
- **Names**: `{repo} / {id-or-name} / single / builder` and `{repo} / {name} / single / reviewer`. No
  `T{nn}`, so no coordinator ever counts them.
- **Opening instructions** (`singleflow.builderInstruction`, `reviewerInstruction`):

  ```
  Load the pir-single skill and run it as the builder. You are run by `pir single`. Reports folder:
  {reportsDir}. Starting point: {base} at {sha}.{setup note, if any}
  The change:

  {prompt}
  ```

  ```
  Load the pir-single skill and run it as the reviewer of pir/{name}. You are run by `pir single`.
  Reports folder: {reportsDir}. Starting point: {base} at {sha}.
  The change that was asked for:

  {prompt}
  ```

- **Resume**: `resumeInstruction()` from planflow, unchanged.

The skill `skills/pir-single/SKILL.md` (T07) is one skill with a builder section and a reviewer
section, because both share the rules about scope, commits, reports and waiting for pir's tests. It
binds: work only in the run's worktree on its branch; keep the change to what the prompt asks, and say
so and ask rather than widen it; commit before reporting; after reporting, wait for pir's word and
change nothing until it arrives; never merge, rebase, push or touch the base branch; the builder checks
its name is free (the planner's three checks, with `single-{hex4}` also refused) before reporting;
`dropped` only after the person agreed in the conversation, for a change too big or one with nothing
to do (§2.12).

### 2.7 Reports and checks

Dropped into the reports folder in the planning report format (planning-runs § Reports) with `single=`:

```
[pir:v1 kind=built single={name}]      the builder committed the change; {name} is the branch name
[pir:v1 kind=reviewed single={name}]   the reviewer is done, fixes committed
[pir:v1 kind=dropped single=-]         the person agreed to call it off: it is too big for a single
                                       run (the body recommends /plan), or there is nothing to change
                                       (the body says what was found)
```

A report is a claim checked against git (`singleChecks` in `single-run.mjs`):

- `built`: the name is kebab-case and of neither form `single-{hex4}` nor `plan-{hex4}`; it is free by
  base-branch's `slugTaken` (no branch `pir/{name}`, no `plans/{name}/PROGRESS.md` on the base, no index
  entry `{repo}__{name}`); the branch has at least one commit beyond the starting commit
  (`nothing is committed on the branch yet`); the worktree is clean.
- `reviewed`: the worktree is clean, and `{name}` is the run's name.

A failed check is sent to the session as a message from pir naming what failed and what to do, and the
step carries on, exactly as for a planner. pir never commits for a session. A report of the other
step's kind is ignored. A session that exits without a report leaves the run crashed, resumable.

### 2.8 On the screen

The dashboard lists single runs beside plans and builds (`src/core/dashboard.mjs`, `pir-tui.mjs`).

- **TYPE**: `single`.
- **SLUG**: the label in quotes, dimmed, before the rename; the name after.
- **STATE**: `building` (setup and build working), `testing` (pir's tests or the baseline running),
  `reviewing`, `asking you` (amber, bold) while the live session has a request or a question set
  pending or has stopped on the person, `ready to merge` (amber, bold) for a finished `ready` run whose
  branch is not yet in the base, `merged` once it is, `finished` for `dropped`; `stopped` and `crashed`
  as for any run.
  `asking you` and `ready to merge` count in `N waiting for you`.
- **PROGRESS**: `build …`, `build · tests …`, `build ✓ review …`, `build ✓ review · tests …`,
  `build ✓ review ✓`, `build ✗` (dropped in build), `build ✓ review ✗` (dropped in review). A red round
  adds ` (red {n})` after the step's `tests`.
- **merged**: for a finished `ready` row, the list's loader asks `baseContains(pir/{name}, { refs:
  [refs/heads/{base}] })` at most once every 30 s per row and caches the answer in memory; once true it
  is not asked again. Why: the row should stop calling for the person once their merge lands, without a
  process kept alive to watch (user, 2026-09-29).
- **The steps view** (opening the row): rows `build` (builder), `review` (reviewer), `merge`, painted
  as the planning steps view paints its rows (glyph, text, clock). A step whose tests are running reads
  `testing…`; a red round shows `tests red · round {n}`. `→`/`↵` opens a step's conversation, `←` back.
  The `merge` row is dim `waits on review` until ready, then shows the hand-off line (and `merged` when
  it is). A `dropped` run's footer says `Dropped: {first line of the report body}`.
- **Where the box lands**: the builder's conversation; `←` goes to the steps view. When the reviewer
  starts while the person is in the builder's conversation, the view follows, headed `the builder
  finished; the reviewer has started` (planning's `followStep`, generalised).

### 2.9 Asking

A step reads asking exactly as a planning step does (`sessionAsking`, `stoppedOnPerson`): a pending
permission request or question set, or the session stopped with nothing of its own running and no
report of the step accepted. While pir's tests or baseline run, the session is idle waiting on pir, not
on the person: the step reads `testing`, never `asking`. Why: the stopped-session rule would otherwise
read every test run as a question.

### 2.10 Phone alerts

A single run alerts like a build (user, 2026-09-29), through the existing machinery (`notifyStep`,
`ntfy.mjs`, `~/.pir/notify.json`); with ntfy not configured nothing is sent.

- **Asking**: one episode per session while it reads asking (§2.9), title `{name-or-label} · builder`
  or `· reviewer`, message by `alertText`; the 15-minute reminder and the clear on answer as for a
  worker. The session starts with the Claude app's own push silenced when ntfy is configured, as a
  build worker does (`workerEnv`).
- **End**: once, when the run finishes `ready`: title `{name} · ready to merge`, message
  `git switch {base} && git merge pir/{name}`, tag `tada`. A `dropped` run sends nothing: dropping
  needs the person's agreement in the conversation, so they already know.

### 2.11 Stop, remove, resume

As for a planning run (planning-runs § Stop, remove, resume): stop is SIGTERM to the program, which
closes its session and any running test or baseline command (`startLines`' `kill`), records `stopped`
and exits; remove clears the index entry, snapshot and conversations and keeps branch, worktree and
commits. Resume (`Ctrl+R` twice) is offered on `stopped` and `crashed`; `resumeRun` spawns
`single-run.mjs --resume`, which finishes a half-done rename, removes a leftover baseline worktree,
and then either reopens the current step's last session by id with `resumeInstruction()`, or, when
the run was stopped during a test run, starts that test run again. A finished run (`ready`, `dropped`)
is not resumable.

### 2.12 The unhappy paths

- **No settings, or broken settings**: refused before anything is created (§2.2, §2.3).
- **Setup fails at the start**: best effort; the builder is told (§2.4 step 1).
- **Setup fails inside a test run**: that run is red with `half: 'setup'`; the message says the setup
  line failed.
- **The session edits while tests run**: the green result is only taken if the head and a clean tree
  still match what was tested (§2.4 step 3); the skill tells it not to.
- **The name is taken or malformed**: a check message; the builder picks another (§2.7).
- **Nothing committed**: a check message.
- **Two single runs in one repo**: independent ids; a name collision is caught by the `built` check.
- **A crash mid-rename**: finished on resume (§2.11), as for planning.
- **The base branch moves on while the run works**: nothing happens; the person's merge handles it,
  as for a build without the coordinator agent. pir does not sync the base into a single run's branch.
- **The builder decides it is too big**: it tells the person and recommends `/plan`; with their
  agreement it reports `dropped` (§2.7).
- **Nothing to change** (already done, or what the prompt describes is not there): the builder tells the
  person what it found; with their agreement it reports `dropped` (user, 2026-09-29, plan review).
- **A test run that never ends**: no time limit, as for a build's tests; the row reads `testing` with
  its clock running and the person stops the run. A known limitation, named in the docs (user,
  2026-09-29, plan review: no per-repo guess at how long is too long).
- **The baseline worktree cannot be created or its setup fails**: the baseline line says the starting
  point could not be tested (§2.5); the round goes on.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/    pure: inputs as parameters, decisions returned. No clock, fs, child process or network.
src/shell/   everything that touches git, processes, files, the terminal and ntfy.
```

`src/core/boundary.test.mjs` scans `src/core/` for forbidden imports. If it fails, the fix is to move
the code, never to relax the test. Everything in §2.4–§2.5's decisions is in `singleflow.mjs` so the
whole run, red rounds and baseline included, is tested in milliseconds.

### 3.2 Modules

| Module | Side | Owns | New / extended |
|---|---|---|---|
| `src/core/basebranch.mjs` | core | `parseSettings` accepts `setup`/`test`; `effectiveCommands`; `commandsRefusalText` | extended (T01) |
| `src/shell/base-branch.mjs` | shell | `resolveSettings(root)` returns the merged settings object the base and the commands read from | extended (T01) |
| `src/core/singleflow.mjs` | core | run ids, name rule, session names, instructions, report parser, `initialSingleState`, `decideSingleStep`, `redMessage`, `singleProgress` | new (T02) |
| `src/core/runrecord.mjs` | core | `kind: 'single'` | extended (T02) |
| `src/shell/held-session.mjs` | shell | holding one Claude session at a time: spawn/resume, close, platform for the person inbox, grants, `workers.json`, Remote Control, the waker, session-log lookup | new, extracted from `plan-run.mjs` (T03) |
| `src/shell/plan-run.mjs` | shell | the planning program, now on `held-session.mjs`, behaviour unchanged | refactored (T03) |
| `src/shell/single-run.mjs` | shell | the single program: executes `decideSingleStep`'s actions, runs setup/tests/baseline, checks, rename, snapshot, final status | new (T04) |
| `src/shell/worktree.mjs` | shell | `openBaseline(runId, { root, from })` / `removeBaseline` for the throwaway detached worktree | extended (T04) |
| `src/shell/launch.mjs` | shell | `startSingleRun`, `resumeRun` for `kind: 'single'` | extended (T05) |
| `src/core/notify.mjs`, `src/shell/notify-config.mjs` | both | `singleEndAlert`; `workerEnv` moved from `coordinate.mjs` so both programs share it | extended (T06) |
| `skills/pir-single/SKILL.md`, `install.sh` | — | the sessions' procedure; installed with the others | new (T07) |
| `src/shell/plan-rig.mjs`, `src/shell/fake/sessions.mjs` | shell | fake builder and reviewer scripts, a single-run scenario in the rig | extended (T08) |
| `src/core/planbox.mjs`, `src/shell/pir-tui.mjs`, `src/shell/list-view.mjs` | both | the `/single` command and its landing | extended (T09) |
| `src/core/dashboard.mjs`, `src/core/plandisplay.mjs`, `src/shell/pir-tui.mjs` | both | the row, the steps view, `merged` | extended (T10) |

### 3.3 The decision function

`decideSingleStep(state, facts) → { state, actions }`, in `singleflow.mjs`, a function of its arguments
only, shaped like planflow's `decidePlanStep`. `facts` carries what the shell observed since the last
call: new reports (parsed), check results for an accepted-pending report, whether the live session is
idle, a finished setup/test/baseline run (`{ kind, ok, half, reason, logPath, tail, head, clean }`),
the session exiting, and a rename sub-step done. Actions:

```
{ type: 'runSetup' }                                  step 1
{ type: 'spawn', step: 'build'|'review', note? }      open the step's session with its instruction
{ type: 'resumeSession', step, sessionId }            reopen by id and send resumeInstruction()
{ type: 'check', kind, name }                         run singleChecks for a report
{ type: 'send', text }                                a message from pir to the live session
{ type: 'runTests', head }                            setup+test in the worktree
{ type: 'runBaseline' }                               setup+test at the starting commit, throwaway worktree
{ type: 'closeWhenIdle' }                             close the live session at the idle gate
{ type: 'rename', substep }                           one of RENAME_SUBSTEPS
{ type: 'finish', outcome: 'ready'|'dropped' }
{ type: 'exitCrashed' }
```

### 3.4 Data flow

Box text → `parseBoxText` → `startSingleRun` (preflight, commands, branch, control folder, spawn,
index) → `single-run.mjs` loop: gather facts (reports from the drop folder, session events, command
handles' `poll()`), call `decideSingleStep`, execute actions in order, write `state.json` and
`status.json` → the dashboard reads the index and snapshot → `buildDashboard`/`runDisplayState` →
`pir-tui` paints.

### 3.5 Storage

The control folder `plans/{id|name}/.parallel/single/`:

| Entry | What it is |
|---|---|
| `prompt.md` | the prompt, as sent |
| `state.json` | `{ version, id, name, step, sessions: { build, review }, commands: { setup, test }, base, baseSha, rounds: { build, review }, tested: { head, ok } \| null, baseline: null \| { ok, half, reason, logPath }, outcome, renamed, live, accepted, rejected, running }`, written temp-then-rename after every transition |
| `reports/`, `conversations/` (`build-{n}.ndjson`, `review-{n}.ndjson`), `inbox/`, `workers.json`, `status.json`, `run.log` | as for a planning run |
| `setup.log`, `tests-{n}.log`, `baseline.log` | the command logs |

`running` names a command run in flight (`setup`, `tests`, `baseline`); a resume that finds it set
starts that run again, since the child died with the program. The snapshot's `runState` is `{ kind:
'single', label, name, step, phase: 'working'|'testing', outcome, base, rounds, steps }` with `steps`
one entry per `build`, `review`, `merge` (phase, clocks, what it is asking). The index record carries
`kind: 'single'`, `label`, `baseBranch`.

A crash mid-write loses at most the last transition; every action is safe to repeat (a test run
restarts, a rename sub-step is read from disk as planning does, a send may repeat once).

---

## 4. Testing

- **Pure core** (`singleflow`, `basebranch`, `planbox`, `dashboard`, `plandisplay`, `notify`): every
  rule in §2 has a unit test, run in milliseconds.
- **Shell with real git** (`single-run.mjs`, `launch.mjs`, `worktree.mjs`): temp repos, the fake Claude
  (`fake/claude-stream.mjs` via the shim), real `sh` for the setup/test lines (scripts that pass, fail,
  or fail only on the base commit).
- **End to end**: the planning rig (`plan-rig.mjs`) extended with single-run scripts drives the real
  `pir` under a pty from the box to `ready to merge` (T08–T11).
- **Live**: one real run with real Claude through the harness (T12). What none of these prove is
  whether a real builder makes good changes; that is judged in use.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5) |
| Language / runtime | Node v24.2.0 (package `engines` `>=22.19`), ES modules |
| Toolchain | npm, git; `node --test` |
| Deliberately absent | no TypeScript, no bundler, no test framework beyond `node:test` |

**The test command.** `npm test`, the block at the top. It runs `FORCE_COLOR=0 NO_COLOR=1 node --test
--test-reporter=dot 'src/**/*.test.mjs'` and ends with a TESTS PASSED/FAILED line (main's `b39a53f`,
which reaches this branch with the start-condition merge). Measured green on this machine 2026-09-29,
about 5 minutes; green again in a fresh copy at plan review. `COLORTERM=truecolor` is set in this shell; colour is off
because the script sets `FORCE_COLOR=0` itself. For detail while debugging, run one file with
`node --test --test-reporter=spec path/to/file.test.mjs`.

**Setup.** `test ! -f package-lock.json || npm ci`; `node_modules/` is gitignored, so the copy stays
clean.

**Dependencies.** No new npm packages. The locked ones (`@anthropic-ai/claude-agent-sdk`,
`@earendil-works/pi-tui`, `uqr`) cover everything.

**End to end.** The existing pty rig: `conversation-rig.mjs` bound by `plan-rig.mjs` to a scratch repo,
fake Claude first on `PATH`, `PIR_HOME`/`HOME`/`PIR_REPOS` scratch. T08 adds single-run scripts to it;
no second rig. Sizes: 80×24 and 120×40. It is in `npm test`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| A real builder and reviewer completing a single run through `pir` | Only real `claude` sessions do it (T12, worker bin, plan limits) |
| Whether a real single run's change is good | The person's judgement of their own change, in use |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| Scratch repo, scratch `PIR_HOME`/`HOME`/`PIR_REPOS` | every rig and harness run | Never the person's repos, index or skills |
| Fake Claude on `PATH` | every `npm test` end to end | No model is called by the test command |
| `perl -e 'alarm 1200'` around the live run | T12 | A stuck live run is killed |
| The red-round limit | 3 | A session stops and asks instead of looping |
| `workers.json` reap; `startLines` `kill` | stop, resume, teardown | No orphaned session or test process survives |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | worker | exact locked versions only | delete `node_modules` | none | none |
| Real single run for the live check (T12) | `perl -e 'alarm 1200; exec @ARGV' node src/shell/harness/run.mjs single-run-live --into /tmp/pir-single-live` | worker | draws plan limits only, no paid API; a scratch repo | delete `/tmp/pir-single-live` | two short sessions | `claude auth status` |
| Scratch teardown | `rm -rf /tmp/pir-single-live` | worker | local scratch only | none needed | none | none |
| Refresh the installed engine and skills | `./install.sh` | worker | CLAUDE.md requires it after engine or skill changes; local, idempotent | re-run on the previous commit | none | none |

The user approved these bins as they stand at plan review, 2026-09-29, the live run left in `worker`.

Credentials: the Claude Code login this machine already uses (`claude auth status`, measured as in
earlier plans); headless sessions draw on plan limits (checked 2026-09-25). No paid API, nothing others
can see. A single run's own actions at runtime (the person's merge) are not build actions of this plan.

---

## 6. Recovery

A single run touches only its own branch `pir/{id|name}`, its worktree and its control folder. By hand,
if `pir` is unavailable: kill each pid in the control folder's `workers.json` whose `ps -p <pid> -o
lstart=` equals its `startTime`, then the program's pid from `~/.pir/runs/{repo}__{id|name}.json`;
remove a leftover `.claude/worktrees/pir-{id}-base` with `git worktree remove --force`. An unwanted run:
`git worktree remove --force .claude/worktrees/pir-{name}`, `git branch -D pir/{name}`. None of this
touches the base branch.

---

## 7. Decisions and rationale

- **Name `single-runs`, command `/single`** (user, 2026-09-29).
- **Builder then fresh reviewer**, over one session or review on request: keeps "nobody reviews their
  own work" (user, 2026-09-29).
- **Commands from the settings files, refuse if missing**, over a session-written file, the latest
  plan's block or the session deciding alone (user, 2026-09-29: "first check the repo file, then
  `~/.pir/{repo}/settings.json`; refuse to start if missing"). The merge rule is base-branch's (user
  file wins key by key), so the two files mean one thing for every key.
- **Built after base-branch lands**, over a second settings reader now (user, 2026-09-29). The finisher
  and visible-helpers plans also touch `pir-tui.mjs`, `plan-run.mjs`, `notify.mjs` and
  `worker-proc.mjs`; building after them too means fewer merge clashes. That order is the person's call
  at `pir start` time.
- **The builder names the branch**, renamed after the build step, over a fixed random name or one made
  from the prompt (user, 2026-09-29). The rename reuses planning's machinery.
- **Red: back to the session, 3 rounds, then it asks** (user, 2026-09-29).
- **Baseline only on the first red**, over always up front or always in parallel (user, 2026-09-29):
  same information when it matters, no wait on a green change.
- **Phone alerts like a build** (user, 2026-09-29).
- **Box only, no `pir single` shell command** (brief; user confirmed the play-back 2026-09-29).
- **`merged` row state** (planner, shown to the user at the task checkpoint 2026-09-29): a finished
  `ready` row otherwise calls for the person forever.
- **Extend, not rebuild** (Stage 4 survey): the planning run already holds sessions, renames, reports
  and resumes; `plan-run.mjs`'s session holding is extracted to `held-session.mjs` (T03) and shared,
  rather than copied into a second program. `openPlanBranch`, `renamePlanBranch`, `slugTaken`,
  `startLines`/`runLines`, `formatSetupNote`, `sessionAsking`/`stoppedOnPerson`, `notifyStep`,
  `labelFromBrief`, `resumeInstruction`, the plan rig and the planning steps view are all reused. The
  pure flow is new (`singleflow.mjs`) because its steps differ (tests, red rounds, baseline) and
  bending `decidePlanStep` to carry them would make both harder to read.
- **One skill for both roles**: builder and reviewer share most rules (§2.6).
- **No prototype**: the surfaces are a third command in an existing box, a row type and a steps view
  patterned on the planning ones; there is no new feel to confirm.
- **The harness has a fixture named `single`** (a one-task plan). The live fixture is named
  `single-run-live` to avoid confusion.

---

## 8. Explicitly out of scope

- **A `pir single` shell command.** The brief asks for the box; the shell command can follow if wanted.
- **The finisher or the coordinator agent on a single run.** The brief keeps the manual merge; the
  person answers every question, as in planning.
- **Syncing the base into the branch.** A small change merges cleanly or the person sees the conflict
  in their own merge.
- **Plan builds reading setup/test from the settings files.** Two sources for the same commands would
  need a precedence rule nobody has decided; a later plan can unify them.
- **Promoting a dropped single run into a plan.** The builder recommends `/plan`; the person starts it.
- **Written records beyond commits.** No PROGRESS, FINDINGS or report file; the commits and the
  conversation are the record.
