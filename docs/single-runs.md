# Single runs — `@repo/single`

A single run makes one small change without a plan: a bug fix, a typo, a small modification. The
person types `@repo/single <what to change>` in the dashboard box. `pir` cuts a branch in its own
worktree, runs the repo's setup lines, holds a **builder** session that makes and commits the change,
runs the repo's tests itself, renames the run to the name the builder chose, holds a fresh **reviewer**
session that reads the change and fixes what it finds, and runs the tests again. It then brings the
base branch into the run's branch and tests again, as a build's end does, and hands the branch to the
**finisher**, the same session a build with the coordinator agent ends with
([finisher.md](finisher.md)): it prepares the merge, asks the person one `Go` question, and after their
`Go` merges into the base and does whatever the project's finishing rules add. No plan is written and
no plan review runs.

Three things hold as for every other run:

- **Nobody reviews their own work.** The reviewer is a new session started only after the builder is
  closed, even for a typo.
- **Green is pir's word, not a session's.** pir runs the setup and test lines itself, from the repo's
  settings, never from a session's claim that the tests pass. What the finisher merges is what pir
  tested green after the base was brought in.
- **The merge into the base is the person's go.** pir merges the base into the run's branch, never the
  branch into the base; that merge is the finisher's after the person's `Go`, or the person's own by
  hand. Nothing pushes or deletes a branch.

The pure rules (run ids, the name rule, session names, opening instructions, the report parser, the
step machine `decideSingleStep`, the red-round message and the PROGRESS cell) are in
`src/core/singleflow.mjs`. The detached program that executes them is `src/shell/single-run.mjs`; the
launch and resume are `startSingleRun` and `resumeRun` in `src/shell/launch.mjs`; the sessions are held
through `src/shell/held-session.mjs`, the holder the planning program uses. The sessions follow the
`pir-single` skill (`skills/pir-single/SKILL.md`), one skill with a builder, a reviewer and a section for
the two sync helpers. The base watch's verdict is `baseWatchVerdict` and `watchDue` in
`src/core/basewatch.mjs`, shared with builds; the finisher is the build's (`startFinisher` with `kind:
'single'` in `src/shell/finisher-agent.mjs`).

## The settings: `setup` and `test`

A single run has no plan and so no DESIGN.md setup/test block. Its commands come from the same two
settings files that name the base branch ([branch-model.md](branch-model.md#the-base-branch)):

```json
{ "baseBranch": "main", "setup": ["npm ci"], "test": ["npm test"] }
```

- `setup` is a JSON array of non-empty strings; `[]` means no setup. `test` is a non-empty array of
  non-empty strings. Each entry is one shell line, run as a plan's block lines are (`runLines` /
  `startLines` in `src/shell/commands.mjs`): `/bin/sh -c` from the worktree root, a scrubbed
  environment, stop at the first failing line.
- The repo file `<repo>/.pir/settings.json` is read first, then `~/.pir/{repo}/settings.json`; the
  user file overrides key by key, so `setup` and `test` are taken independently and a person can change
  their own test line without a commit (`effectiveCommands` in `src/core/basebranch.mjs`).
- Both keys are required. Either missing refuses the start with `no-commands`, naming only the missing
  keys: `{repo} has no setup/test commands for a single run. Add to {repoFile} (or {userFile}):
  "setup": ["<install command>"], "test": ["<test command>"]` (`commandsRefusalText`).
- A file that is not valid JSON, or a `setup` or `test` of the wrong shape (`"setup" must be a list of
  commands`, `"test" must be a non-empty list of commands`), refuses with `bad-settings`, naming the
  file and what is wrong, even when the other file would supply a good value. Because the base branch
  is read from the same files, a malformed `setup` or `test` also refuses `pir plan` in that repo, and
  `pir start` of a plan whose branch `pir/{slug}` does not yet record its base (a plan made by hand);
  a plan made by `pir plan` already records it, and its build does not read the settings.
- The commands are read once, at the start, and stored in the run's `state.json`, so a settings edit
  mid-run does not change what green means for a run already going.

Plan builds still read their DESIGN.md block; the two sources are not unified.

## Starting one

The dashboard box is the only way in; there is no `pir single` shell command. The box's grammar,
pop-ups and keys are the ones in [planning-runs.md](planning-runs.md#the-dashboard-box); `/single` is
its third command, last in the command pop-up as `single` (`change something small`). The prompt is the
rest of the text, trimmed, newlines kept, as a `/plan` brief is. While the text is a `/single` text the
head line reads `change in {name}` and the hint `↵ start the change · shift+↵ new line · esc clear`.

Enter refuses, leaving the text in the box, with `say what to change after @{name}/single` for an empty
prompt, and with `Could not start the change in {name}: {reason}` when `startSingleRun` refuses or
throws. The reasons in words (`startSingleFailedNote` in `src/core/planbox.mjs`):

| Code | Words |
|---|---|
| `not-a-repo` | `it is not a git repository` |
| `no-base-setting` | `no base branch is set` |
| `no-base-branch` | `{base} does not exist` |
| `fetch-failed` | `can't reach {remote}` |
| `diverged` | `{base} split from {remote}/{base}` |
| `bad-settings` | `its pir settings are broken: {why}` |
| `no-commands` | `no setup/test commands in its .pir/settings.json` |
| `empty-prompt` | `the change is empty` |

Anything else, a thrown error included, is shown as it came. A note wider than the screen wraps at a
word, up to three lines.

`startSingleRun(prompt, { cwd })` refuses, in order and before anything is created: not a git repo;
the base-branch refusals (`planPreflight`, which fetches and prepares the base as for `pir plan`);
`bad-settings` or `no-commands`; an empty prompt. Then it:

- draws a **run id** `single-{hex4}`, redrawn while branch `pir/single-{hex4}`, index entry
  `{repo}__single-{hex4}` or folder `plans/single-{hex4}/` exists;
- cuts `pir/single-{hex4}` from the prepared base commit, checked out in worktree
  `.claude/worktrees/pir-single-{hex4}`, recording `pirBase` on the branch (`openPlanBranch`);
- creates the control folder `<main>/plans/single-{hex4}/.parallel/single/` with `prompt.md` and
  `state.json` (below);
- spawns `src/shell/single-run.mjs --control <dir>` detached, as the planning program is: its own
  process group, output to `run.log`, `PIR_RUN=1`, and `caffeinate -i -w {pid}` holding the Mac awake;
- writes the index entry `~/.pir/runs/{repo}__single-{hex4}.json` with `kind: 'single'`, `label` (the
  prompt's first non-blank line, trimmed, cut to 23 characters and `…` when longer than 24), `baseBranch` and `go: null`.

On `started` the box resets to `@` and the screen lands in the builder's conversation, reading
`starting the builder…` until the program has named it.

## The run, step by step

1. **setup.** pir runs the `setup` lines in the run's worktree (log `setup.log`). A failure does not
   stop the run: the builder starts anyway, its opening instruction carrying a note that names the
   failure, the last lines of output, the log and the setup lines pir runs (`formatSingleSetupNote`).
   With `setup: []` the step is skipped.
2. **build.** pir holds the builder in the worktree. It makes the change, commits it, chooses a name
   for the branch and reports `built` with it.
3. **checks and tests.** pir checks the report against git (below). A failed check is sent to the
   builder and the step carries on. When the checks pass, pir records the branch head and runs the
   setup then the test lines in the worktree (`tests-{n}.log`), because the change may have altered the
   dependencies.
   - Green, at the recorded head, with a clean worktree: the step is done.
   - Green, but the head has moved (the session went on committing): the tests run again on the new
     head. The report's checks are not run again; adding commits cannot make them fail.
   - Green on the recorded head with a dirty worktree: pir does not rerun. It tells the session
     `pir ran the tests on your commit {sha7} and they passed, but the worktree is not clean afterwards:`,
     the `git status --porcelain` listing, and to commit its edits or make git ignore files the tests
     wrote, then report again; the step waits for a new report.
   - Red: see [Red tests](#red-tests).

   At the idle gate, before the step closes, pir reads the head and status again and checks the report
   once more, so a commit or edit made after a green result, unreported, never closes the step untested.
4. **rename.** The builder is closed at the idle gate (it is not cut off mid-commit), then the run is
   renamed from `single-{hex4}` to the builder's name, as a planning run is renamed
   ([planning-runs.md](planning-runs.md#the-rename)): `pir/single-{hex4}` → `pir/{name}`, the worktree
   to `.claude/worktrees/pir-{name}`, the control folder to `plans/{name}/.parallel/single/` (the emptied
   `plans/single-{hex4}/` removed), the index entry to `{repo}__{name}.json` with `label` cleared. Each
   sub-step is skipped when already done, so a crash halfway is finished by a resume. The rename comes
   after the tests because a red run goes back to the builder, whose working directory must not move.
5. **review.** A fresh reviewer is held in the renamed worktree. It reads the change against the prompt,
   fixes what it finds, commits, and reports `reviewed`. The tests then run as in step 3, and red goes
   back to the reviewer, except when the head is still the one step 3 tested green and the tree is
   clean: the reviewer changed nothing, so that result stands and no second test run happens.
6. **sync.** Green after review: the reviewer is closed at the idle gate and the run brings the base
   in ([The sync](#the-sync)). It may hold a **resolve** helper for a clash or a **fix** helper for red
   tests.
7. **wait.** The sync settled. Green: pir starts the finisher, which prepares the merge and asks the
   person `Go` ([The finisher](#the-finisher)). Red: the run waits `not ready`, offering no merge
   ([Red after the sync](#red-after-the-sync)). Either way the program keeps running and watches the
   base ([Watching the base](#watching-the-base)).
8. **end.** The run finishes `finished` when the finisher writes `done`, `closed` when it writes
   `close` (the person asked it to close the run without finishing), or `merged` when the person merged
   the branch by hand before any go.

Either the builder or the reviewer may instead report `dropped`: the session is closed and the run
finishes with outcome `dropped`. The branch and anything committed on it stay. A drop takes precedence
over anything else in the same pass, a test result included. A dropped run gets no sync and no
finisher; the helpers may not drop a run.

A run finished by an older pir carries outcome `ready`; it is read as before (`ready to merge` until the
merged check sees the branch in the base).

## The sync

The sync mirrors a build's end sequence (`endSync`, `endSyncing`, `endTests`, `startFix`, `endFixing` in
`coordinate.mjs`), decided by `endStep` in `singleflow.mjs` and executed by `single-run.mjs`. One pass of
it is a **sequence**, counted in `state.end.seq`:

1. **Prepare the base.** `prepareBase(root, base, { mode: 'start' })` (`base-branch.mjs`) fetches the
   remote's copy and decides which commit is the base, as a build's end does. A non-ok result
   (`fetch-failed`, `diverged`, `no-base-branch`, or a throw, held as `fetch-failed`) holds the sync with
   `holdText`'s reason (`src/core/basebranch.mjs`) and tries again every 60 s (`SYNC_RETRY_MS`). pir never
   merges a base it did not just try to fetch.
2. **Already merged?** If the local base, its remote-tracking copy or the commit just prepared holds the
   branch tip (`baseContains`), the person merged by hand: the run ends `merged`.
3. **Merge the base in.** `syncBase(worktree, { baseSha, base })` (`worktree.mjs`):
   - `up-to-date`: the head the review tested stands; the sequence settles green. A head nobody has
     tested since a resume is tested first.
   - `merged` (a merge commit `sync {base} into pir/{name}`): the tests run (step 4).
   - `conflict`: pir holds a **resolve** helper ([The sync helpers](#the-sync-helpers)); after its
     accepted `resolved` the tests run.
   - `syncBase` throwing (git refused before merging, such as an untracked file in the way): logged, the
     sync is `unresolved` and the run waits red.
4. **Tests.** The setup then the test lines, as every single-run test run, logged in
   `sync-tests-{n}.log` (numbered on from `tests-{n}.log`, `nextTestsLogPath`). Green: the sequence
   settles green. Red, and this sequence has had no fix helper: pir holds a **fix** helper, then tests
   again. Red after the fix: the sequence settles red.

Each sequence gets at most one fix helper and one resolve helper; a later sequence (the base moved
again) gets its own, as a build's `resync` resets `fixUsed`. There are no red rounds for helpers: the fix
helper is the one attempt and its result is the next test run.

## The sync helpers

Held through the run's holder exactly as the builder and reviewer are, one session at a time:

| Role | Session name | Starts when | Asked to |
|---|---|---|---|
| `resolve` | `{repo} / {name} / single / resolve` | the merge stopped on a clash | finish the merge in progress: resolve the listed files keeping both sides' intent, commit the merge, report `resolved` |
| `fix` | `{repo} / {name} / single / fix` | the tests are red after a sync, first time this sequence | make the tests pass without undoing the change or the merged base, commit, report `fixed` (or report `fixed` and say why nothing could be fixed) |

Their opening instructions (`helperInstruction` in `singleflow.mjs`) begin `Load the pir-single skill and
run it as the {role} helper of pir/{name}. You are run by `pir single`.`, give the reports folder and the
base, and then for `resolve` the clashing files one per line, for `fix` the failing reason and the log
path.

A helper that exits without an accepted report: `resolve` with the merge still in progress → pir aborts
the merge (`abortSync`), the sync is `unresolved` and the run waits red, as `endSyncing` does for builds;
a `resolve` that committed the merge counts as resolved. `fix` → pir runs the tests anyway, as
`endFixing` does.

## The finisher

On the pass a sequence first settles green, pir starts the finisher (`startTheFinisher` in
`single-run.mjs`), with `startFinisher` called as a build's `handOver` calls it, except:

- `kind: 'single'`: the session is named `{repo} / {name} / single / finisher`, matching the run's other
  sessions and carrying no `T{nn}`.
- `controlDir` is the run's control folder, so the finisher's files are under
  `plans/{name}/.parallel/single/finisher/`; `featurePath` is the run's worktree; the branch is
  `pir/{name}`; the target is the run's recorded base.
- The opening instruction (`finisherOpening` with `kind: 'single'`, `finisher-brief.mjs`) says it is the
  finisher of the single run `{name}`, drops `Plan:` and `Report:`, and adds `Change asked for:
  {controlDir}/prompt.md`. The `pir-finisher` skill tells it, for a single run, to read that file and
  `git log --oneline {target}..pir/{name}` in place of `REPORT.md`.
- The rules file is chosen as for builds (`chooseRules`: the project's `.pir/rules/on-finish.md` in the
  run's worktree, then `~/.pir/{repo}/`, then `~/.pir/default/`, then the engine's), and `askRules` are
  read from the worktree's `.claude/settings.json` (`readAskRules`).

Everything else is the build's: the hook and the gate, look-only before the go, the phases and
`state.json`, the ledger, the status files, go recognition, the restart budget and `afterRestart`
([finisher.md](finisher.md)). There is no coordinator agent, so every question, permission request and
`Go` is the person's. The person's answers reach the finisher through the run's inbox wrapped with
`withAgent(holder.platform, () => finisher)` (`coordinator-agent.mjs`), as a build wraps its platform: the
go counts only as an answer logged `from: 'person'` in the finisher's own conversation.

Each pass in the wait with the finisher on (the build's `finisherWaiting` order):

1. A re-sync just settled: green → `finisher.resynced(baseSha)`, and the finisher re-checks and writes a
   fresh `ready`; red → the finisher is closed for good and the run waits red. It is not handed over
   again in this run.
2. The finisher failed to start or gave up (a fourth exit within the hour) → fallback (below).
3. Its statuses are drained: `done` → the run ends `finished`; `close` → the run ends `closed`.
4. After any go (`goGiven`), nothing else: the finisher's own merge moves the base, so the run ends only
   on `done` or `close`, and a `stuck` after that merge still reaches the person.
5. Before any go, the base watch: `merged` → the run ends `merged` and the finisher is closed; `moved` →
   `finisher.resyncing()` (no go counts until the re-sync settles) and a new sequence starts.

**Fallback.** `finisher failed to start: …` in `run.log`, or the finisher giving up: the run waits as an
older pir's `ready` did, the merge row shows `git switch {base} && git merge pir/{name}`, and the run ends
`merged` when the person merges. The fallback is for good in this run; a branch that turns red under the
finisher falls back to the red wait.

## Red after the sync

A sequence that settles red (an unresolved merge, or red after the fix helper) leaves the run in the wait,
tests red: no merge is offered, and the sync and merge rows read `not ready · tests red` or `not ready ·
clash unresolved`. The run keeps watching the base; when it moves, a new sequence runs, and green then
hands over to the finisher unless the finisher already fell back in this run. A hand merge by the person
ends the run `merged`.

## Watching the base

Each pass in the wait (the finisher before any go, a red wait, or the fallback) pir reads the local base;
every `watchMs` (5 minutes, `DEFAULT_BASE_WATCH_MS`, or `PARALLEL_BASE_WATCH_MS`, as for builds) it also
refreshes the remote with `prepareBase(…, { mode: 'watch' })`. `baseWatchVerdict` (`basewatch.mjs`)
decides: `merged` when the local base or its remote-tracking copy holds the branch tip; `moved` when the
local base's tip differs from the one seen at the last sync, or a refreshed remote differs from the commit
the last sync merged; otherwise nothing. The first refresh comes `watchMs` after the wait starts
(`watchDue`).

## The sessions

Held as planning sessions are ([planning-runs.md](planning-runs.md#the-two-sessions)): auto permission
mode, the person's input through `startPersonInbox`, the same "do not ask again" grants, the same
conversation log format, `workers.json` for reaping, and Remote Control on for the whole session
(`PARALLEL_REMOTE=0` turns it off). The sync helpers are held the same way. There is no coordinator
agent: the person answers every question and permission request. `c` on a single run opens the
finisher's conversation while it is on, and otherwise says `a single run has no coordinator agent.`

- **One at a time.** The reviewer starts only after the builder is closed, and the sync only after the
  reviewer is closed. The finisher is held apart from the holder, as in builds, and is not in
  `workers.json`.
- **`!` and handed commands** work here as in a build: a `!` line runs in the run's worktree, and the
  builder and reviewer can hand the person a command with `hand_command`, which their step reads as
  `asking you · run a command` ([human-flow.md](human-flow.md#running-a-command-yourself--)).
- **Names**: `{repo} / {id-or-name} / single / builder`, `{repo} / {name} / single / reviewer`, the
  helpers' `{repo} / {name} / single / resolve` and `{repo} / {name} / single / fix`, and the
  finisher's `{repo} / {name} / single / finisher`. No `T{nn}`, so no coordinator ever counts them.
- **Opening instructions** (`builderInstruction`, `reviewerInstruction`) name the `pir-single` skill and
  the role, say the session is run by `pir single`, and give the reports folder (it moves at the
  rename) and the starting point (`{base} at {sha}`). The builder's carries the prompt under `The
  change:`, after the failed-setup note when there is one; the reviewer's names `pir/{name}` and
  carries the prompt under `The change that was asked for:`.
- **What the skill binds**: work only in the run's worktree on its branch; keep the change to what the
  prompt asks, and ask rather than widen it; commit before reporting; after reporting, change nothing
  until pir's word arrives; never merge, rebase, push or touch the base branch (a helper only finishes
  the merge pir started, and never starts or aborts one); the builder checks its name is free before
  reporting; `dropped` only after the person agreed in the conversation, for a
  change too big for a single run (the builder recommends `/plan`) or one with nothing to change.

## Reports and checks

A session reports by dropping a file into the reports folder, in the planning report format
([planning-runs.md](planning-runs.md#reports-and-how-pir-checks-them)) with `single=`:

```
[pir:v1 kind=built single={name}]      the builder committed the change; {name} is the branch name
[pir:v1 kind=reviewed single={name}]   the reviewer is done, fixes committed
[pir:v1 kind=dropped single=-]         the person agreed to call it off; the body says why
[pir:v1 kind=resolved single={name}]   the resolve helper committed the merge
[pir:v1 kind=fixed single={name}]      the fix helper committed its fix (or nothing could be fixed; the body says why)
```

Only the header on the first line counts. A report of another step's kind is ignored; in the sync only
the live helper's own kind counts, and a helper may not report `dropped`. A report is a
claim, checked against git (`singleChecks` in `single-run.mjs`):

- **`built`**: the name is kebab-case and of neither form `single-{hex4}` nor `plan-{hex4}`; it is free
  (no branch `pir/{name}`, no `plans/{name}/PROGRESS.md` on the base, no index entry `{repo}__{name}`,
  and no folder `plans/{name}/.parallel/single` left by an earlier run); the branch has at least one
  commit beyond the starting commit; the worktree is clean.
- **`reviewed`** and **`fixed`**: `{name}` is the run's name, and the worktree is clean.
- **`resolved`**: as `reviewed`, and no merge is in progress (`syncPending`): `The merge is still in
  progress. Resolve every clashing file, commit the merge, then drop the `resolved` report again.`

A failed check is sent to the session as one message from pir, `pir did not accept your `{kind}`
report for pir/{name}:` then what failed and what to do: on the same line for one failure, one `- `
line each for several (for example `nothing is committed on the branch yet. Commit the change, then drop the `built` report again.`). The
same failure is sent once. pir never commits for a session. A session that exits without a report the
step can act on leaves the run crashed, and resumable.

## Red tests

Rounds are counted per step (build, review). The sync's tests have no rounds: see [The sync](#the-sync).

- **The first red of the run** starts the **baseline**: pir runs setup then test in a throwaway
  detached worktree `.claude/worktrees/pir-{id}-base` at the run's starting commit (`baseline.log`),
  then removes that worktree. The result is stored in `state.json` and reused for every later red of
  the run; the message to the session waits for it. It runs only on red because the tests can take
  minutes and a green change never needs the answer.
- **Rounds 1–3**: pir sends the session (`redMessage`):

  ```
  pir ran the tests on your commit {sha7} and they failed: {reason}. Round {n} of 3.
  {baseline line}
  Log: {logPath}
  {last lines of the log}
  Fix it, commit, and report again.
  ```

  The baseline line is one of `They pass on the untouched starting point ({base} {sha7}), so this change
  broke them.`, `They also fail on the untouched starting point ({base} {sha7}), so the failure may be
  older than this change.`, or `The untouched starting point could not be tested: {reason}.` (its setup
  failed, or its worktree could not be made). A setup line that fails inside a test run makes that run
  red with the setup line as the reason.
- **Round 4 and later**: the same message, its last line replaced by `This is round {n}, past the limit
  of 3: stop, tell the person what fails and what you tried, and ask how to go on. Report again only
  after they answer.` The session stops, and its row reads `asking you` by the ordinary stopped-session
  rule.

The person may answer in the conversation at any time; the round count does not stop that.

## Asking

A step reads asking as a planning step does (`sessionAsking` and `stoppedOnPerson`, in
`held-session.mjs`): a pending permission request or question set, or the session stopped with nothing
of its own running and no report of the step held. While pir holds a report (its checks pending, or
accepted) or runs the setup, the tests or the baseline, the session is waiting on pir, not on the
person, and the step reads `testing` or its working state, never asking. A pending request still reads
asking during a test run.

## On the screen

The dashboard ([detached-runs.md](detached-runs.md)) lists single runs beside plans and builds.

- **TYPE**: `single`.
- **SLUG**: the label in quotes, dimmed, before the rename; the name after.
- **STATE** (`runDisplayState` in `dashboard.mjs`, `stateCell` in `pir-tui.mjs`): `● building` (setup
  and build working), `● testing` (pir's tests or the baseline running), `● reviewing`, `● syncing` (the
  sync step, a re-sync under the finisher included), `● ready for your go` (amber, bold: the finisher in
  `awaiting-go` and nothing else asking), `● finishing` (the finisher preparing or finishing),
  `● asking you` (amber, bold) while a live session asks, the finisher stuck or holding a request
  included, `● ready to merge` (amber, bold: the fallback wait, or a legacy `ready` run whose branch is
  not yet in the base), `✗ not ready` (red: the red wait), `◌ merged` (ended `merged`, or a legacy
  `ready` run once merged), `◌ finished` (ended `finished`, or `dropped`), `◌ closed` (the finisher
  closed the run), and `◼ stopped` and `✕ crashed` as for any run. `asking you`, `ready for your go` and
  `ready to merge` count in `N waiting for you`.
- **PROGRESS** (`singleProgress`): `build …`, `build · tests …`, `build ✓ review …`, `build ✓ review ·
  tests …`, `build ✗` (dropped in build), `build ✓ review ✗` (dropped in review), then `build ✓ review ✓
  sync …` and `build ✓ review ✓ sync · tests …` in the sync, `build ✓ review ✓ sync ✓ merge …` in a
  green wait, `build ✓ review ✓ sync ✗` in a red wait, `build ✓ review ✓ sync ✓ merge ✓` once
  `finished` or `merged`, and `build ✓ review ✓ sync ✓ merge ✗` once `closed`. While a test or baseline
  run follows a red one in build or review, `tests` reads `tests (red {n})`. A legacy `ready` run reads
  `build ✓ review ✓`.
- **merged**: for a finished `ready` or `closed` row, the list asks git whether `pir/{name}` is in the
  local base (`refs/heads/{base}`) at most once every 30 s per row, and keeps the answer in memory; a yes
  is never asked again (`createMergedCheck` in `pir-tui.mjs`). A `closed` row keeps reading `◌ closed`;
  only its merge row turns `merged`.

**The steps view** (opening the row) has rows `build` (builder), `review` (reviewer), `sync` and `merge`,
painted as the planning steps view's: a working step spins with `building` or `reviewing`, a step whose
tests run reads `testing…` with the test run's clock, a step back at work after a red run reads `tests
red · round {n}`, an asking step is amber (`asking you · a question`, `asking you · allow a command?`),
a done step reads `built` or `reviewed` with how long it worked, and a dropped step reads `dropped`.
Before the program has written its first snapshot the build row reads `starting the builder…`.
Pending rows read `waits on build` (the review row, through the rename too) and `waits on review`, or
`not started` once the run has finished. A `dropped` run's footer says `Dropped: {first line of the
report body}`.

```
  build    built · 4m
  review   reviewed · 3m
  sync     main brought in · tests green
  merge    ◆ finisher  waiting for your go
```

The `sync` and `merge` rows carry their own words (`syncRow` and `mergeRow` in `single-run.mjs`):

| Row | Text | Style |
|---|---|---|
| sync | `waits on review` / `not started` | pending |
| sync | `bringing in {base}` | working |
| sync | `{holdText reason} · retrying` | amber |
| sync | `resolving a clash` (resolve helper working) | working |
| sync | `testing…` (with the test clock) | working |
| sync | `fixing tests` (fix helper working) | working |
| sync | `asking you · …` (a helper asking) | amber |
| sync | `up to date · tests green` / `{base} brought in · tests green` | done |
| sync | `not ready · tests red` / `not ready · clash unresolved` | red |
| merge | `waits on sync` / `not started` | pending |
| merge | `◆ finisher  preparing` / `waiting for your go` / `finishing` / `stuck · needs you` / `asking you` / `done` | the build finisher's row words and styles (`finisherEntry`, `finisherRow` in `display.mjs`) |
| merge | `git switch {base} && git merge pir/{name}` | the fallback wait, a `closed` run, a legacy `ready` run |
| merge | `not ready · tests red` / `not ready · clash unresolved` | red: a red wait offers no merge |
| merge | `merged` | ended `merged` or `finished`, or a `closed` run once merged |

`→`/`↵` opens a step's conversation, `←` goes back. On `sync` it opens the current or last helper's
conversation; on `merge` the finisher's, with the conversation header reading `agent` as in builds (the
row opens it as `FINISHER_ID`). A row with no session says why: `review has no session yet — the
reviewer starts when the change is built and its tests pass.`, `sync has no session — pir brought {base}
in itself.`, `merge has no conversation — the merge is yours to run by hand.` (or `… the branch is
already merged.`, or `… the run was dropped, so there is nothing to merge.`).

**Where the box lands**: the builder's conversation; `←` goes to the steps view. When the reviewer
starts while the person is in the builder's conversation, the view follows, headed `the builder
finished; the reviewer has started`. A person on the steps view or the list is not moved.

`PIR_DASHBOARD_STATE` ([detached-runs.md](detached-runs.md#following-the-dashboard-from-another-program--pir_dashboard_state))
publishes a single run with `run.kind` `single`, its builder with role `implement` and its reviewer
with role `review`. The snapshot's `runState` also carries `end`, `finisher` and `helper` (below).

## Phone alerts

A single run alerts like a build, through the same machinery ([human-flow.md](human-flow.md#phone-alerts--pir-notify)),
when `pir notify` is set up; otherwise nothing is sent.

- **Asking**: one alert each time a session starts reading asking, titled `{name-or-label} · builder`
  or `· reviewer`, worded as a worker's (`asks: …`, `wants to run …`), with the 15-minute reminder and
  the clear on answer. Because the alert follows the asking rule above, a session waiting on pir's tests
  never alerts. With alerts set up, the sessions start with the Claude app's own push silenced, as a
  build worker does.
- **A helper asking**: as the builder and reviewer, titled `{name} · resolve` or `{name} · fix`
  (`singleNotifyViews`, from the snapshot's `helper`).
- **The finisher**: the build finisher's alerts with `{name}` as the slug ([finisher.md](finisher.md#phone-alerts)):
  `{name} · ready for your go`, `{name} · finisher stuck` and a parked request (`finisherNotifyView`,
  id `finisher`), with their reminders and clears; `{name} · finished` (the done summary) and
  `{name} · finisher gave up` (with the merge line) once each (`finisherAlert`, sent as `finisherOneShot`
  sends them for builds).
- **The end sequence's one-shots** (`singleEndAlerts` in `single-run.mjs`):
  - a held sync: `holdAlert`'s `{name} · waiting` with `holdText`'s reason, once per reason, as
    `holdAlertPass` does for builds;
  - a sequence settling red: `endAlert`'s `{name} · not ready` (`Tests red on pir/{name}: {reason}` or
    `Merge with {base} unresolved on pir/{name}`), once per sequence;
  - the finisher failing to start: `{name} · ready to merge` with `git switch {base} && git merge
    pir/{name}` (`singleEndAlert`). It is no longer sent when the finisher takes over.

  A resumed program does not resend a red or fallback alert the program before it reached
  (`singleEndSeen`); a hold is tried again on resume, so its alert may come again. `merged`, `closed` and
  `dropped` send nothing: the person did it, or agreed to it in the conversation.

## Stop, remove, resume

As for a planning run ([planning-runs.md](planning-runs.md#stop-remove-resume)):

- **Stop** (`Ctrl+S Ctrl+S`) sends SIGTERM to the program, which records `stopped`, kills any
  setup, test or baseline run in flight, closes its session and the finisher, and exits; SIGKILL after
  4 s; then the sessions in `workers.json` are reaped. The finisher is not in `workers.json`, so a
  SIGKILLed program leaves it running: `ps -ax -o pid,command | grep '/ single / finisher'` finds it.
- **Remove** (`Ctrl+X Ctrl+X`) clears the index entry, the snapshot and `conversations/`. The branch,
  the worktree and the commits stay.
- **Resume** (`Ctrl+R Ctrl+R`) is offered on `stopped` and `crashed` rows only; a finished run
  (`finished`, `merged`, `closed`, `dropped`, or a legacy `ready`) is final. `resumeRun` spawns
  `single-run.mjs --resume`, which kills a command run a killed program left behind (recorded in
  `command.json`), removes a leftover baseline worktree, finishes a half-done rename, and then either
  reopens the current step's last session by its id, sending it the planning run's resume message, or,
  when the run was stopped during a setup, test or baseline run, starts that run again. In the end
  steps (`endStep` with `facts.resume`):
  - **sync**: a resolve or fix helper's session is reopened by id; a test run in flight is started again;
    anything else aborts a merge left in progress (`abortSync`) and starts the sequence again from the
    base, and a merge that may have landed unseen is tested again.
  - **wait with the finisher on**: `startFinisher` again; it finds its `state.json` and resumes by id, and
    `afterRestart` turns `finishing` into `stuck` ([finisher.md](finisher.md#when-it-fails)). A stored
    `finisher/state.json` with phase `done` ends the run `finished` at once. A resume whose last sync was
    `merged` or `resolved` tells the finisher `resynced(baseSha)`, so its old steps are void.
  - **a red or fallback wait**: the watch carries on.

**By hand**, if `pir` is unavailable: kill each pid in the control folder's `workers.json` whose `ps -p
<pid> -o lstart=` equals its `startTime`, the process group in `command.json` the same way, then the
program's pid from `~/.pir/runs/{repo}__{id|name}.json`; remove a leftover
`.claude/worktrees/pir-{id}-base` with `git worktree remove --force`. An unwanted run: `git worktree
remove --force .claude/worktrees/pir-{name}` and `git branch -D pir/{name}`. None of this touches the
base branch.

## The control folder

`plans/single-{hex4}/.parallel/single/` before the rename, `plans/{name}/.parallel/single/` after,
gitignored by the `plans/*/.parallel/` rule. It sits under `plans/` and not `.git` for the planning
run's reason: the sessions write their reports there, and Claude Code never auto-approves a write under
`.git`. A single run therefore leaves a `plans/{name}/` folder holding only `.parallel/` in the main
checkout; it is invisible to git and is not a plan.

| Entry | What it is |
|---|---|
| `prompt.md` | the prompt, as sent |
| `state.json` | `{ version, id, name, step, sessions: { build, review, resolve, fix }, commands: { setup, test }, base, baseSha, rounds: { build, review }, tested, baseline, outcome, renamed, live, accepted, rejected, running, pending, red, end }`, written temp-then-rename after every transition. `step` is `setup`, `build`, `rename`, `review`, `sync` or `wait`; a finished run keeps the step it ended in and carries `outcome` (`finished`, `merged`, `closed` or `dropped`; `ready` from an older pir). A dropped run's report body stays in `accepted.body`. `end` is `{ seq, phase, sync, tests, testsReason, fixUsed, hold, localSeen, remote, finisher, fallback }`: `phase` is `prepare`, `merge`, `testing`, `resolving`, `fixing` or null; `sync` the last merge's `{ state, baseSha, files }` (`up-to-date`, `merged`, `conflict`, `resolved`, `unresolved`); `tests` `green` or `red`; `finisher` null, `on` or `fallback`, and `fallback` `failed`, `gave-up` or `red`. A state written before the sync existed loads with `end` defaulted |
| `reports/`, `conversations/` (`build-{n}.ndjson`, `review-{n}.ndjson`, `resolve-{n}.ndjson`, `fix-{n}.ndjson`, `finisher-{n}.ndjson`), `inbox/`, `shells/`, `workers.json`, `status.json`, `run.log` | as for a planning run; the finisher's conversation as in a build |
| `finisher/` | the build finisher's `state.json`, `session.json`, `status/` and `ledger.jsonl` ([finisher.md](finisher.md#storage)) |
| `setup.log`, `tests-{n}.log`, `sync-tests-{n}.log`, `baseline.log` | the command logs; `tests-{n}` and `sync-tests-{n}` share one count that goes up across resumes |
| `command.json` | the command run in flight (`{ kind, pid, startTime }`), so a resumed program can kill one a killed program left |

The snapshot's `runState` is `{ kind: 'single', label, name, step, phase: 'working'|'testing', outcome,
base, rounds, steps, end, finisher, helper }`, one step entry each for `build`, `review`, `sync` and
`merge`, with planning's fields plus `round` and `testingSince` (`singleRunState` in `single-run.mjs`).
Build and review phases are `building`, `reviewing`, `testing`, `asking`, `done`, `failed`, `pending`.
The `sync` entry's phase is `pending`, `working`, `testing`, `held`, `asking`, `done` or `failed`, the
`merge` entry's `finisher`, `ready`, `done`, `failed` or `pending`; both carry their row's `text`.
`finisher` is the finisher's `view()` while it is on, else null; `helper` is the sync helper held now
(`{ id, asking, worker }`) or null. Whether the person has merged a `ready` or `closed` run is not in the
snapshot; the dashboard asks git.

## Known limitations

- **No `pir single` shell command.** The dashboard box is the only way to start one.
- **No base sync during build or review.** If the base branch moves while the builder or reviewer
  works, nothing happens until the sync after the review brings it in.
- **No time limit on a test run.** A test line that never ends leaves the row reading `testing` with its
  clock running; the person stops the run.
- **No coordinator agent.** The person answers every question and permission request, the finisher's
  included, and gives every `Go`. There is no setting to turn the finisher off; the person can still
  merge by hand before their `Go`.
- **The finisher is not in `workers.json`**, as in builds: a SIGKILLed program leaves it running (see
  Stop above).
- **A finisher that fell back is not handed over again in this run**, even if a later sequence settles
  green; the run waits for the person's hand merge.
- **A red-round message names its log under the run's first folder** (`plans/single-{hex4}/…`) when it
  is sent before the rename; after the rename that path no longer exists.
- **The merged check is remembered in memory only.** For a legacy `ready` run, or a `closed` run's
  merge row, a branch deleted after its merge reads unmerged again once `pir` restarts.
- **The `finished` alert is sent on the finish only.** A program killed between recording `finished`
  and sending it never sends it, since a finished run is not resumed.
- **A resumed session is told to check "the plan files"**, the planning run's resume message reused
  unchanged, though a single run has none.
- **Whether a real builder makes a good change** is the person's judgement in use; the test command
  proves the flow with a fake Claude, and one real run is the `single-run-live` harness fixture. That
  fixture still expects the old `ready` end, so its dry pass in `harness/run-single.test.mjs` is skipped
  until it is brought up to the finisher.
