# Single runs — `@repo/single`

A single run makes one small change without a plan: a bug fix, a typo, a small modification. The
person types `@repo/single <what to change>` in the dashboard box. `pir` cuts a branch in its own
worktree, runs the repo's setup lines, holds a **builder** session that makes and commits the change,
runs the repo's tests itself, renames the run to the name the builder chose, holds a fresh **reviewer**
session that reads the change and fixes what it finds, runs the tests again, and hands the person
`git switch {base} && git merge pir/{name}` to run by hand, as a build without the finisher does. No
plan is written and no plan review runs.

Three things hold as for every other run:

- **Nobody reviews their own work.** The reviewer is a new session started only after the builder is
  closed, even for a typo.
- **Green is pir's word, not a session's.** pir runs the setup and test lines itself, from the repo's
  settings, never from a session's claim that the tests pass.
- **pir never merges, pushes or deletes a branch.** The person merges by hand.

The pure rules (run ids, the name rule, session names, opening instructions, the report parser, the
step machine `decideSingleStep`, the red-round message and the PROGRESS cell) are in
`src/core/singleflow.mjs`. The detached program that executes them is `src/shell/single-run.mjs`; the
launch and resume are `startSingleRun` and `resumeRun` in `src/shell/launch.mjs`; the sessions are held
through `src/shell/held-session.mjs`, the holder the planning program uses. The sessions follow the
`pir-single` skill (`skills/pir-single/SKILL.md`), one skill with a builder and a reviewer section.

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
6. **done.** Green after review: the reviewer is closed and the run finishes with outcome `ready`. The
   row reads `ready to merge`, the steps view shows `git switch {base} && git merge pir/{name}`, and the
   end alert is sent.

Either session may instead report `dropped`: the session is closed and the run finishes with outcome
`dropped`. The branch and anything committed on it stay. A drop takes precedence over anything else
in the same pass, a test result included.

## The sessions

Held as planning sessions are ([planning-runs.md](planning-runs.md#the-two-sessions)): auto permission
mode, the person's input through `startPersonInbox`, the same "do not ask again" grants, the same
conversation log format, `workers.json` for reaping, and Remote Control on for the whole session
(`PARALLEL_REMOTE=0` turns it off). There is no coordinator agent: the person answers every question
and permission request. `c` on a single run says `a single run has no coordinator agent.`

- **One at a time.** The reviewer starts only after the builder is closed.
- **`!` and handed commands** work here as in a build: a `!` line runs in the run's worktree, and the
  builder and reviewer can hand the person a command with `hand_command`, which their step reads as
  `asking you · run a command` ([human-flow.md](human-flow.md#running-a-command-yourself--)).
- **Names**: `{repo} / {id-or-name} / single / builder` and `{repo} / {name} / single / reviewer`. No
  `T{nn}`, so no coordinator ever counts them.
- **Opening instructions** (`builderInstruction`, `reviewerInstruction`) name the `pir-single` skill and
  the role, say the session is run by `pir single`, and give the reports folder (it moves at the
  rename) and the starting point (`{base} at {sha}`). The builder's carries the prompt under `The
  change:`, after the failed-setup note when there is one; the reviewer's names `pir/{name}` and
  carries the prompt under `The change that was asked for:`.
- **What the skill binds**: work only in the run's worktree on its branch; keep the change to what the
  prompt asks, and ask rather than widen it; commit before reporting; after reporting, change nothing
  until pir's word arrives; never merge, rebase, push or touch the base branch; the builder checks its
  name is free before reporting; `dropped` only after the person agreed in the conversation, for a
  change too big for a single run (the builder recommends `/plan`) or one with nothing to change.

## Reports and checks

A session reports by dropping a file into the reports folder, in the planning report format
([planning-runs.md](planning-runs.md#reports-and-how-pir-checks-them)) with `single=`:

```
[pir:v1 kind=built single={name}]      the builder committed the change; {name} is the branch name
[pir:v1 kind=reviewed single={name}]   the reviewer is done, fixes committed
[pir:v1 kind=dropped single=-]         the person agreed to call it off; the body says why
```

Only the header on the first line counts. A report of the other step's kind is ignored. A report is a
claim, checked against git (`singleChecks` in `single-run.mjs`):

- **`built`**: the name is kebab-case and of neither form `single-{hex4}` nor `plan-{hex4}`; it is free
  (no branch `pir/{name}`, no `plans/{name}/PROGRESS.md` on the base, no index entry `{repo}__{name}`,
  and no folder `plans/{name}/.parallel/single` left by an earlier run); the branch has at least one
  commit beyond the starting commit; the worktree is clean.
- **`reviewed`**: `{name}` is the run's name, and the worktree is clean.

A failed check is sent to the session as one message from pir, `pir did not accept your `{kind}`
report for pir/{name}:` then what failed and what to do: on the same line for one failure, one `- `
line each for several (for example `nothing is committed on the branch yet. Commit the change, then drop the `built` report again.`). The
same failure is sent once. pir never commits for a session. A session that exits without a report the
step can act on leaves the run crashed, and resumable.

## Red tests

Rounds are counted per step (build, review).

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
- **STATE**: `● building` (setup and build working), `● testing` (pir's tests or the baseline
  running), `● reviewing`, `● asking you` (amber, bold) while a step's live session asks,
  `● ready to merge` (amber, bold) for a finished `ready` run whose branch is not yet in the base,
  `◌ merged` once it is, `◌ finished` for a `dropped` run, and `◼ stopped` and `✕ crashed` as for any
  run. `asking you` and `ready to merge` count in `N waiting for you`.
- **PROGRESS**: `build …`, `build · tests …`, `build ✓ review …`, `build ✓ review · tests …`,
  `build ✓ review ✓`, `build ✗` (dropped in build), `build ✓ review ✗` (dropped in review). While a
  test or baseline run follows a red one, `tests` reads `tests (red {n})`.
- **merged**: for a finished `ready` row, the list asks git whether `pir/{name}` is in the local base
  (`refs/heads/{base}`) at most once every 30 s per row, and keeps the answer in memory; a yes is never
  asked again (`createMergedCheck` in `pir-tui.mjs`). No process stays alive to watch.

**The steps view** (opening the row) has rows `build` (builder), `review` (reviewer) and `merge`,
painted as the planning steps view's: a working step spins with `building` or `reviewing`, a step whose
tests run reads `testing…` with the test run's clock, a step back at work after a red run reads `tests
red · round {n}`, an asking step is amber (`asking you · a question`, `asking you · allow a command?`),
a done step reads `built` or `reviewed` with how long it worked, and a dropped step reads `dropped`.
Before the program has written its first snapshot the build row reads `starting the builder…`.
Pending rows read `waits on build` (the review row, through the rename too) and `waits on review`, or
`not started` once the run has finished. The `merge` row shows the hand-off line once the run is `ready`, and `merged`
once the merge has landed. A `dropped` run's footer says `Dropped: {first line of the report body}`.
`→`/`↵` opens a step's conversation, `←` goes back. A row with no session says why: `review has no
session yet — the reviewer starts when the change is built and its tests pass.`, `merge has no
conversation — the merge is yours to run by hand.` (or `… the branch is already merged.`, or `… the run
was dropped, so there is nothing to merge.`).

**Where the box lands**: the builder's conversation; `←` goes to the steps view. When the reviewer
starts while the person is in the builder's conversation, the view follows, headed `the builder
finished; the reviewer has started`. A person on the steps view or the list is not moved.

`PIR_DASHBOARD_STATE` ([detached-runs.md](detached-runs.md#following-the-dashboard-from-another-program--pir_dashboard_state))
publishes a single run with `run.kind` `single`, its builder with role `implement` and its reviewer
with role `review`.

## Phone alerts

A single run alerts like a build, through the same machinery ([human-flow.md](human-flow.md#phone-alerts--pir-notify)),
when `pir notify` is set up; otherwise nothing is sent.

- **Asking**: one alert each time a session starts reading asking, titled `{name-or-label} · builder`
  or `· reviewer`, worded as a worker's (`asks: …`, `wants to run …`), with the 15-minute reminder and
  the clear on answer. Because the alert follows the asking rule above, a session waiting on pir's tests
  never alerts. With alerts set up, the sessions start with the Claude app's own push silenced, as a
  build worker does.
- **End**: once, when the run finishes `ready`: `{name} · ready to merge` with `git switch {base} &&
  git merge pir/{name}`. A `dropped` run sends nothing: dropping needs the person's agreement in the
  conversation, so they already know.

## Stop, remove, resume

As for a planning run ([planning-runs.md](planning-runs.md#stop-remove-resume)):

- **Stop** (`Ctrl+S Ctrl+S`) sends SIGTERM to the program, which records `stopped`, kills any
  setup, test or baseline run in flight, closes its session and exits; SIGKILL after 4 s; then the
  sessions in `workers.json` are reaped.
- **Remove** (`Ctrl+X Ctrl+X`) clears the index entry, the snapshot and `conversations/`. The branch,
  the worktree and the commits stay.
- **Resume** (`Ctrl+R Ctrl+R`) is offered on `stopped` and `crashed` rows only; a finished run (`ready`
  or `dropped`) is final. `resumeRun` spawns `single-run.mjs --resume`, which kills a command run a
  killed program left behind (recorded in `command.json`), removes a leftover baseline worktree,
  finishes a half-done rename, and then either reopens the current step's last session by its id, sending
  it the planning run's resume message, or, when the run was stopped during a setup, test or baseline run,
  starts that run again.

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
| `state.json` | `{ version, id, name, step, sessions: { build, review }, commands: { setup, test }, base, baseSha, rounds: { build, review }, tested, baseline, outcome, renamed, live, accepted, rejected, running, pending, red }`, written temp-then-rename after every transition. `step` is `setup`, `build`, `rename` or `review`; a finished run keeps the step it ended in and carries `outcome` (`ready` or `dropped`). A dropped run's report body stays in `accepted.body` |
| `reports/`, `conversations/` (`build-{n}.ndjson`, `review-{n}.ndjson`), `inbox/`, `shells/`, `workers.json`, `status.json`, `run.log` | as for a planning run |
| `setup.log`, `tests-{n}.log`, `baseline.log` | the command logs; `tests-{n}` counts up across resumes |
| `command.json` | the command run in flight (`{ kind, pid, startTime }`), so a resumed program can kill one a killed program left |

The snapshot's `runState` is `{ kind: 'single', label, name, step, phase: 'working'|'testing', outcome,
base, rounds, steps }`, one step entry each for `build`, `review` and `merge`, with planning's fields
plus `round` and `testingSince`. Step phases are `building`, `reviewing`, `testing`, `asking`, `done`,
`failed`, `pending`; the `merge` entry is `ready` or `pending`. Whether the person has merged is not in
the snapshot; the dashboard asks git.

## Known limitations

- **No `pir single` shell command.** The dashboard box is the only way to start one.
- **No base sync.** If the base branch moves on while the run works, nothing happens: the person's own
  merge meets the change, and a conflict shows there. pir never merges the base into a single run's
  branch.
- **No time limit on a test run.** A test line that never ends leaves the row reading `testing` with its
  clock running; the person stops the run.
- **No finisher and no coordinator agent.** The person answers every question and merges by hand.
- **A red-round message names its log under the run's first folder** (`plans/single-{hex4}/…`) when it
  is sent before the rename; after the rename that path no longer exists.
- **The merged check is remembered in memory only.** A branch deleted after its merge reads `ready to
  merge` again once `pir` restarts.
- **The end alert is sent on the finish only.** A program killed between recording `ready` and sending
  it never sends it, since a finished run is not resumed.
- **A resumed session is told to check "the plan files"**, the planning run's resume message reused
  unchanged, though a single run has none.
- **Whether a real builder makes a good change** is the person's judgement in use; the test command
  proves the flow with a fake Claude, and one real run is the `single-run-live` harness fixture.
