# Planning runs — `pir plan`

`pir plan` moves the front half of the method into `pir`. It runs the planner (`/pir-plan`) and then
a fresh plan reviewer (`/pir-review-plan`) as sessions `pir` holds, answered in `pir`'s own screen,
on a side branch in its own worktree. When the plan is reviewed, `pir` asks whether to start the
parallel build on that same branch. `main` is never written: the plan reaches `main` with its code,
through the person's own `git merge pir/{slug}` at the end of the build.

The planning conversation is the one in the `pir-plan` and `pir-review-plan` skills, unchanged in
substance; `pir` only hosts it. The skills' "Run by pir plan" sections say what differs for a session
`pir` holds (below). A plan made by hand with `/pir-plan` on `main` still builds with `pir start
{slug}` exactly as before; see [detached-runs.md](detached-runs.md).

The pure rules — report parsing, slug and run-id rules, session names and the step machine
`decidePlanStep` — are in `src/core/planflow.mjs`. The detached planning program that executes them is
`src/shell/plan-run.mjs`; the launch and resume are `startPlanRun` and `resumeRun` in
`src/shell/launch.mjs`.

## Starting one

- **`pir plan "a daily screen budget"`** starts a run with that brief. Unquoted words are joined by one
  space, so `pir plan a daily screen budget` is the same brief.
- **`pir plan`** on its own opens the **brief box**: a full-screen box titled `pir plan  new plan in
  {repo}`, the same text editor the conversation view uses, and the hint `↵ start planning · shift+↵ new
  line · esc cancel`. `shift+↵` or `ctrl+j` adds a line and `↵` sends. An empty or whitespace-only brief
  is not sent. `esc` (or `Ctrl+C`) cancels: nothing is created and `pir` exits 0 (`brief-box.mjs`).
- **The new-plan box on the dashboard's runs list** starts one without leaving `pir` (§ The new-plan
  box, below).

### The new-plan box

The runs list (`pir`) has a typing box pinned to its bottom (`src/shell/list-view.mjs`, the same editor
as the brief box). Its text is `@` whenever the list opens, after a plan starts and after `esc`. The
text reads as `@repo`, whitespace, then the brief; Enter calls `startPlanRun(brief, { cwd: repo })`,
the call `pir plan` makes, resets the box to `@` and lands in the planner's conversation as below.

- **Keys.** While the box is bare (`@` or empty) the list keeps every key it had: `↑↓`, `↵`/`→`,
  `Ctrl+R/S/X` twice, `esc` and `Ctrl+C` quit. Any other key types into the box. An `@` typed (or a
  paste starting with `@`) into a bare `@` is absorbed, so `@skaut` and `skaut` read the same. Once the
  box has text: `↵` starts, `shift+↵` or `ctrl+j` adds a line, `esc` or `Ctrl+C` resets it to `@`
  (a second `esc` then quits), `Ctrl+R/S/X` still act on the selected run, and the arrows move the
  cursor. The hint line under the box is `↵ start planning · shift+↵ new line · esc clear`, except
  while a chord is half-pressed: then it shows the chord's `⚠ … again to …` warning, as on a bare box.
  A key typed into the box cancels a half-pressed chord, like any other key. The routing is
  `routeBoxKey` in `src/core/planbox.mjs`.
- **The repos.** Every git repo directly inside each root with a real `.git` folder (a linked
  worktree is skipped) and a local `main`, most recently worked in first (`scanRepos` in
  `src/shell/repo-scan.mjs`). The roots are `PIR_REPOS`, split on `:` with `~` expanded; unset, the
  root is `~/src`. The scan runs when the box leaves bare, and again the next time. Typing after `@`
  opens a pop-up of the repos whose name contains the text (at most five shown), each with its path;
  `Tab` or `↵` picks one.
- **The head line** above the box reads `new plan  in {repo}` for a listed repo, `start with @repo`
  when bare, and, amber, `@{name} is not a repo in {roots}` or `start with @repo` otherwise.
- **What Enter refuses** (nothing is started, the text stays, and a note says why): no `@name`
  (`start with @repo, then say what to plan`); a name that is not exactly a listed repo's
  (`no repo @{name} in {roots} — pick one from the list`; a partial name is never completed on Enter);
  a name in two roots (`@{name} is in more than one folder: {path}, {path}`, home written as `~`); no
  brief (`say what to plan after @{name}`); and `startPlanRun` refusing or throwing
  (`Could not start planning in {name}: {reason}`; a refusal code in words, e.g. `it has no local
  main branch`, a thrown error by its message).

The box is only on the runs list, not on a run's view or a conversation. On a terminal that is not a
TTY the list is painted without it, as before.

Before anything is created — before the brief box opens, for the bare form — `pir plan` refuses, with
one line on stderr and exit 1:

1. outside a git work tree. The repo root is the **main** worktree, so `pir plan` works from any folder
   or linked worktree of the repo;
2. a repo with no local `main` branch. A planning run never creates or checks out `main`, because that
   would move the person's own checkout;
3. an empty brief (`pir plan ""`; the brief box never sends one).

The first two are `planPreflight`; the third is checked by `startPlanRun`, still before anything is
created. There is no repo-name check: planning works in any repo, the `plan-implement-review` checkout
included, with no environment flag (the old canonical-repo refusal and `PARALLEL_ALLOW_HERE` are gone).

Then `startPlanRun`:

- draws a **run id** `plan-{hex4}` (four random hex characters), redrawn while branch `pir/plan-{hex4}`,
  index entry `{repo}__plan-{hex4}` or folder `plans/plan-{hex4}/` already exists;
- cuts branch `pir/plan-{hex4}` from local `main`, checked out in worktree
  `.claude/worktrees/pir-plan-{hex4}` (`openPlanBranch` in `worktree.mjs`);
- creates the control folder `<main>/plans/plan-{hex4}/.parallel/plan/` and writes `brief.md` and
  `state.json` there (below);
- spawns the planning program detached, exactly as a build's coordinator is spawned: its own session and
  process group, output to `run.log` in the control folder, `PIR_RUN=1`, and `caffeinate -i -w {pid}`
  holding the Mac awake for its lifetime;
- writes the index entry `~/.pir/runs/{repo}__plan-{hex4}.json` with `kind: 'plan'`, `label` (the
  brief's first line, cut to 24 characters with `…`) and `go: null`.

`pir` then lands directly in the planner's conversation (below), from the box as from `pir plan`.

## The two sessions

The planner and the reviewer are held exactly as build workers are: `startWorker` in
`worker-proc.mjs`, auto permission mode, the person's input through `startPersonInbox`, the same "do
not ask again" grants, the same conversation log format, and the same `workers.json` for reaping.
Answering the planner in `pir` is the same act as answering a worker (see
[human-flow.md](human-flow.md)).

- **One at a time.** The reviewer is started only after the planner is closed, because
  `pir-review-plan` refuses to read back a plan whose author is still in the room.
- **Names** are `{repo} / {runId-or-slug} / plan / planner` and `{repo} / {slug} / plan / reviewer`.
  They have no `T{nn}`, so no coordinator ever counts or closes them.
- **Working directory** is the plan branch's worktree.
- **Remote Control is on for the whole session**, not only while it waits on the person as for a build
  worker: a planning session is a conversation with the person from start to finish, so it can be
  followed on claude.ai or the phone throughout. `PARALLEL_REMOTE=0` turns it off, as for a build.
- **Opening instructions** name the skill, say the session is run by `pir plan`, and give the reports
  folder (the session cannot derive it: the folder moves at the rename). The planner's also carries the
  brief.

The skills, when told they are run by `pir plan`: run on the `pir/…` branch in its worktree without
halting on the "main checkout, main branch" rule; the planner checks a proposed slug is free before
writing anything (no `plans/{slug}/` on `main`, no branch `pir/{slug}`, not of the form `plan-xxxx`);
the prototype, when there is one, is written to `plans/{slug}/prototype/index.html` and opened with
`open`, because a headless session has no Artifact tool; both commit everything and leave the worktree
clean; and each ends by dropping its report instead of naming the next command to type.

## Reports, and how `pir` checks them

A planning session reports by dropping a file into the reports folder, in the worker report format
(`skills/pir-worker` § You report by dropping a file) with `plan=` in place of `task=`:

```
[pir:v1 kind=planned plan={slug}]        the plan is committed on this branch
[pir:v1 kind=no-plan plan=-]             the person called it off; nothing to review
[pir:v1 kind=reviewed plan={slug}]       the plan is marked reviewed and committed
[pir:v1 kind=not-reviewed plan={slug}]   the review ended with the plan not marked reviewed
```

Questions are not reported: a planning session asks in its own conversation, and the screen shows it
asking.

A report is a claim; `pir` checks it against git before acting (`plannerChecks`, `reviewerChecks` in
`plan-run.mjs`).

- **`planned`**: `plans/{slug}/PROGRESS.md`, `PLAN.md` and `DESIGN.md` are committed at the branch
  head; the slug is kebab-case and not of the form `plan-{hex4}`; it is free (no branch `pir/{slug}`, no
  `plans/{slug}/PROGRESS.md` on `main`, no index entry `{repo}__{slug}`); the worktree is clean.
- **`reviewed`**: on the committed branch tree, `plans/{slug}/PROGRESS.md` reads reviewed by the same
  gate a build uses, `DESIGN.md` opens with a valid setup/test block, and the worktree is clean.

A failed check is sent to the session as a message from pir, naming what failed and what to do (for a
taken name: choose another with the person, rename the folder, commit, report again), and the step
carries on. `pir` never commits for a session: a dirty worktree is a message, not a commit, because
the plan is the person's. When every check passes, `pir` waits until the session is not busy — the same
idle gate the coordinator uses, so a final commit is never cut off — then closes it.

`no-plan` closes the planner and finishes the run with outcome `no-plan`. `not-reviewed` closes the
reviewer and finishes the run with outcome `not-reviewed`, which stays resumable (below), because the
person usually stopped to think, not to abandon the plan. A session that exits without either report
leaves the run with no way forward: the planning program exits without a final status and the run
shows crashed.

## The rename

The run has no slug until the planner names the plan, so it starts under its run id and is renamed
after an accepted `planned`, between the two sessions, because a live session's working directory must
not move under it. In order, each step skipped when already done, so a crash halfway is finished by a
resume:

1. `git branch -m pir/plan-{hex4} pir/{slug}`
2. `git worktree move .claude/worktrees/pir-plan-{hex4} .claude/worktrees/pir-{slug}`
3. the control folder moves from `plans/plan-{hex4}/.parallel/plan/` to `plans/{slug}/.parallel/plan/`,
   and the emptied `plans/plan-{hex4}/` is removed (only if empty)
4. the index entry is renamed to `{repo}__{slug}.json`, keeping `kind: 'plan'` and clearing `label`

The new worktree path is exactly the build's feature worktree path, so the build later finds the branch
already checked out there and reuses it (see [branch-model.md](branch-model.md)).

## The control folder

A planning run's folder is `.parallel/plan/`, beside the build's `.parallel/control/` and gitignored
by the same `plans/*/.parallel/` rule. It is `plans/plan-{hex4}/.parallel/plan/` before the rename and
`plans/{slug}/.parallel/plan/` after. It is under `plans/`, not `.git`, because Claude Code never
auto-approves a write under `.git`, which would stall the planner at its last step.

| Entry | What it is |
|---|---|
| `brief.md` | the brief, as sent |
| `state.json` | the run's state: `{ version, id, slug, step, sessions: { plan, review }, outcome, renamed }`, written temp-then-rename after every transition. `step` is `plan`, `rename`, `review` or `done`; `sessions` lists each step's session ids, which resume uses |
| `reports/` | the sessions' report files |
| `conversations/` | `plan-{n}.ndjson` and `review-{n}.ndjson`, one per session. A resumed session appends to its own log after a `resumed` note, so the person reads one conversation |
| `inbox/` | the person's input on its way to the session, as for a build |
| `workers.json` | the live session's pid and start time, for reaping |
| `status.json`, `run.log` | the snapshot the screen paints, and the program's output |

The snapshot's `runState` for a planning run is `{ kind: 'plan', label, slug, step, outcome, steps }`,
one entry per step (`plan`, `review`, `build`) with its phase, clocks, worker and what it is asking.
The index entry carries `kind: 'plan'|'work'` (absent reads `work`), `label` and `go`.

## On the screen

The dashboard ([detached-runs.md](detached-runs.md)) lists planning runs beside builds, with a
**TYPE** column, `plan` or `work`. One row per plan: at the go, the planning row becomes the build's row.

- **SLUG**: before the rename, the label in quotes, dimmed.
- **STATE**: `planning` or `reviewing` while running (green), `your go` for a reviewed run waiting for
  the person's go (amber, bold), `finished` otherwise, `stopped`, `crashed`.
- **PROGRESS**: `plan …`, `plan ✓ review …`, `plan ✓ review ✓`, `plan ✗` for no plan, `plan ✓ review
  ✗` for not reviewed.
- The counts line gains `· N waiting for you` while any row reads `your go`.

**Where `pir plan` lands.** Both forms open the planner's conversation directly; until the program has
named its planner the view reads `starting the planner…`. `←` goes to the run's steps view. When the
reviewer starts while the person is still in the planner's conversation, the view follows into the
reviewer's, headed `the planner finished; the reviewer has started`. A person on the steps view or the
list is not moved.

**The steps view.** Opening a planning row shows its steps as rows — `plan` (planner), `review`
(reviewer), `build` — each with a glyph, its text and its clock, painted like task rows: a live step
spins, a step asking the person is amber (`asking you · a question`, `asking you · allow a command?`),
a done step is green and shows how long it worked, a pending one is dim and names what it waits on.
`↑↓` pick a step, `→` or `↵` open its conversation (its latest session, read-only when not live), `←`
back to the list. `pir start {slug}` on a live planning run opens this view.

## The go

A finished run with outcome `reviewed` and no go recorded is waiting for the person. Its row reads `your
go`, and its steps view ends with `{slug} is reviewed. Start the parallel build now?`, the plan's width
(`N tasks, longest chain M, up to W can run at once.`, from its `PROGRESS.md`) and the branch it builds
on.

- **`↵` start**: the screen calls `startRun(slug)`, the same call `pir start {slug}` makes. The build
  writes its own index record under the same key, without `kind: 'plan'`, so the row flips from `plan`
  to `work` and the view switches to the build's live view.
- **`n` not now**: `go: 'declined'` is written into the index record. The row reads `finished`, and the
  steps view says `Reviewed and waiting on pir/{slug}. Build it with: pir start {slug}`.
- **`esc`** quits `pir` and leaves the question in place.

The question is derived from files, not held by a waiting process, so it survives a reboot. `pir start
{slug}` builds a waiting or declined plan too; it is the same call. The build reads the plan from the
committed branch until it is merged to `main` (see [run-lifecycle.md](run-lifecycle.md)).

## Stop, remove, resume

- **Quitting `pir`** stops nothing; the session waits for its answer, as a worker does.
- **Stop** (`Ctrl+S Ctrl+S` on a running row, or in its steps view) is the build's stop: SIGTERM to the
  planning program, which closes its session, records `stopped` and exits; SIGKILL after 4 s; then the
  sessions recorded in `workers.json` are reaped.
- **Remove** (`Ctrl+X Ctrl+X`) is the build's remove: the index entry, the snapshot and
  `conversations/`. The branch, the worktree and the plan files stay.
- **Resume** (`Ctrl+R Ctrl+R`) is offered on a `stopped` or `crashed` row, and on a finished planning
  row whose outcome is `not-reviewed`. The planning program is spawned again with `--resume`: it
  finishes a half-done rename, then reopens the current step's last session **by its session id**, in
  the same worktree, appending to its log. The planner or reviewer remembers everything discussed, and
  nothing typed is lost. Because a resumed session takes no turn until spoken to, and a question it had
  open died with the process, `pir` sends it one fixed message first:

  ```
  You were stopped and have been resumed in the same worktree. Whatever you were doing when you stopped
  may not have finished: check `git status` and the plan files, tell the person where things stand, and
  carry on. Any question you had open was lost, so ask it again.
  ```

  (A work row resumes too, by the same chord: it is `startRun(slug)`, exactly `pir start {slug}`; see
  [restart-recovery.md](restart-recovery.md).)

`pir start {slug}` on a plan that lives on its branch and is not reviewed is refused with `'{slug}' is
not reviewed — resume its planning run in pir (Ctrl+R)`. Two planning runs in one repo at once are
independent; their run ids differ, and a slug collision is caught by the `planned` check.

**By hand**, if `pir` is unavailable: kill each pid in the control folder's `workers.json` whose `ps -p
<pid> -o lstart=` equals its `startTime`, then the program's pid from
`~/.pir/runs/{repo}__{id|slug}.json`. An unwanted plan branch: `git worktree remove --force
.claude/worktrees/pir-{name}` then `git branch -D pir/{name}`. `pir` itself never deletes a branch, and
none of this touches `main`.

## Known limitations

- **Classic `/pir-work` cannot build a plan that lives only on `pir/{slug}`.** Merge it to `main` first,
  or build it with `pir start {slug}`.
- **Editing a reviewed plan before the go** is not a `pir` action: resume a session, or edit the branch
  by hand.
- **A run that dies before its planner has a session** leaves the landing view on `starting the
  planner…` with the row reading `planning`; `←` reaches the steps view.
- **A crash between the control-folder move and the index rename**: the resumed program finds the moved
  `state.json`, but its `run.log` output for that run lands in the old `plans/plan-{hex4}/` folder.
- **In a repo whose `.gitignore` does not ignore `plans/*/.parallel/` and `.claude/worktrees/`**, the
  control folder and the worktree show as untracked in the person's main checkout (`?? plans/`, `??
  .claude/`). The same is true of a build.
- **A person's own stop** shows `the worker's line failed: … exited with code 143` in the stopped
  conversation, as it does for a build worker.
- **Whether the planning conversation is good** is the person's judgement; the test command proves the
  flow with a fake Claude, and one real run is the `plan-command` harness fixture.
