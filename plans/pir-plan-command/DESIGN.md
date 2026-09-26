---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# pir plan — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T16 carries the resulting behaviour into `/docs` and the README. It never edits a finished plan's
DESIGN.md.

## 1. Purpose

Today a person plans by hand: `/pir-plan` in one Claude session, `/pir-review-plan` in a fresh one,
the plan committed to `main`, and only then `pir {slug}` builds it in parallel. `pir plan` moves that
front half into `pir`. It runs the planner and then a fresh reviewer as sessions `pir` holds, answered
in `pir`'s own screen, on a side branch in its own worktree, and when the plan is reviewed it asks
whether to start the parallel build on that same branch. Starting a build becomes `pir start {slug}`.

The user is the person who owns what gets built. The planning conversation is theirs and does not
change; what changes is that nobody has to open sessions, carry a slug between them, or put an
unbuilt plan on `main`.

### Success criteria

- `pir plan "brief"` in a scratch repo, answered through the `pir` screen, ends with a reviewed plan on
  `pir/{slug}`, a build started from the go question on that branch, and a green `git merge
  pir/{slug}` hand-off, with `main` untouched throughout. Proven with fake sessions in `npm test`
  (T12, T14) and once with real Claude (T18).
- A planning run survives the terminal closing, and a stopped or crashed one resumes into the same
  conversation (T07, T11).
- `pir {slug}` fails with a pointer to `pir start {slug}`; a hand-made plan on `main` builds with
  `pir start {slug}` exactly as `pir {slug}` did (T03, T09).

### Stance

The planning conversation is the one in `/pir-plan` and `/pir-review-plan`, unchanged in substance;
`pir` only hosts it. A second planning procedure would drift from the first.

`main` is never written by `pir`, and no branch is ever deleted by it. The plan reaches `main` with
its code, through the person's own `git merge`.

---

## 2. Behaviour specification

### 2.1 The commands

| Invocation | Does |
|---|---|
| `pir` | the dashboard, unchanged |
| `pir plan` | opens the brief box (§2.13), then starts a planning run |
| `pir plan <words…>` | starts a planning run with the words joined by one space as the brief |
| `pir start {slug}` | starts or opens the build of a reviewed plan, exactly what `pir {slug}` did |
| `pir <anything else>` | stderr `pir: unknown command '<arg>'. To build a plan: pir start <arg>` plus the usage, exit 2 |

`pir start` with no slug or more than one is a usage error, exit 2. Exit codes stay as today: 0 a view
opened, 1 a refused start, 2 usage. Unquoted words are joined because a shell splits a brief typed
without quotes, and refusing it would punish the most natural typing. The bare slug form is removed
rather than kept as an alias because `plan` and `start` would otherwise be indistinguishable from
slugs, and a plan named `plan` would silently change meaning (user 2026-09-26).

### 2.2 Starting a planning run

Pre-flight, in order, each a clean stderr message and exit 1 with nothing created:

1. Inside a git work tree. The repo root is the main worktree (`mainWorktree`), so `pir plan` works
   from any folder or linked worktree of the repo.
2. A local `main` branch exists. Unlike the coordinator's `ensureMain`, a planning run never runs
   `git checkout -B main`, because that moves the person's own checkout.
3. The canonical-repo guard: refused in the `plan-implement-review` checkout unless
   `PARALLEL_ALLOW_HERE=1`, the same rule and variable as a live build (`canPromoteHere`), because a
   planning run creates branches exactly as a build does.
4. The brief is non-empty after trimming.

Then, in order:

- A run id `plan-{hex4}`: four random hex characters from the shell, retried while branch
  `pir/plan-{hex4}`, index entry `{repo}__plan-{hex4}` or folder `<main>/plans/plan-{hex4}/` exists.
- Branch `pir/plan-{hex4}` cut from local `main`, worktree `<main>/.claude/worktrees/pir-plan-{hex4}`
  (`openPlanBranch`, T04). Cut from `main` because that is what a build's feature branch is cut from
  today; the build later reuses this branch as its feature branch (§2.9).
- Control folder `<main>/plans/plan-{hex4}/.parallel/plan/`, the shape it has after the rename (§2.6) with
  the run id standing in for the slug, and already ignored by `plans/*/.parallel/`. Not inside `.git`:
  Claude Code never auto-approves a write under `.git` (a protected path; auto mode sends it to the
  classifier and allow rules cannot pre-approve it), so the planner's report could stall the run at its
  last step (FINDINGS 2026-09-26, user at plan review). `brief.md` is written there, and `state.json` (§3.5).
- The planning program (`src/shell/plan-run.mjs`) spawned detached exactly as `startRun` spawns the
  coordinator: new session and process group, stdout and stderr to `run.log` in the control folder,
  env `PIR_RUN=1`, `caffeinate -i -w {pid}`.
- Index entry `{repo}__plan-{hex4}.json` with `kind: 'plan'` and `label` = the brief's first line cut
  to 24 characters with `…` (§2.10).

### 2.3 Planning sessions

The planner and the reviewer are held exactly as build workers are: `startWorker` (worker-proc.mjs),
`permissionMode: 'auto'`, the person's input through `startPersonInbox`, the same grants, the same
conversation log format, the same `workers.json` for reaping. Reusing the worker line means answering
the planner in `pir` is the same act as answering a worker, and every fix to one is a fix to both.

- Names: `{repo} / {runId-or-slug} / plan / planner` and `{repo} / {slug} / plan / reviewer`. They
  deliberately fail `parseAgentName` (no `T{nn}`), so no coordinator ever counts or closes them.
- Logs: `conversations/plan-{n}.ndjson` and `conversations/review-{n}.ndjson` in the run's control
  folder, `n` counted from the folder as `nextLogPath` does. A resumed session appends to its own log, not
  the next `n`, so the person reads one conversation (§2.14; resume-dead-worker §2.3 does the same).
- Working directory: the plan branch's worktree.
- Remote Control is on for the planner's and the reviewer's whole session: `worker.remoteControl(true)` right
  after the spawn or resume, and off only at the close (`close()` already switches it off first). Unlike a build
  worker, which is remote-controlled only while it waits on the person, because a planning session is a
  conversation with the person from start to finish, and the person may follow it from claude.ai or the phone
  whatever it is doing (user, 2026-09-26, after plan review). Off under `PARALLEL_REMOTE=0`, the build's
  variable. The coordinator's `remoteWanted` is not used.
- One session at a time. The reviewer is never started while the planner is live, because
  `pir-review-plan` refuses to read back a plan whose author is still in the room.

Opening instructions (the first user message, from `pir`), exactly:

```
planner:  Load the pir-plan skill and run it. You are run by `pir plan`: follow its "Run by pir plan"
          section. Reports folder: {controlDir}/reports
          Brief:

          {brief}
reviewer: Load the pir-review-plan skill and run it on plan {slug}. You are run by `pir plan`: follow
          its "Run by pir plan" section. Reports folder: {controlDir}/reports
```

The folder is named in the message because a planning session cannot derive it: before the rename the
control folder is under the run id, and the reviewer runs after it moved.

### 2.4 Reports

A planning session reports by dropping a file into the reports folder named in its opening
instruction, in the worker report format (`pir-worker` § You report by dropping a file), with a
`plan=` field in place of `task=`:

```
[pir:v1 kind=planned plan={slug}]        the plan is committed on this branch
[pir:v1 kind=no-plan plan=-]             the person called it off; nothing to review
[pir:v1 kind=reviewed plan={slug}]       the plan is marked reviewed and committed
[pir:v1 kind=not-reviewed plan={slug}]   the review ended with the plan not marked reviewed
```

A report is a claim, not a fact: `pir` verifies each one against git before acting (§2.5, §2.7),
because a session that misreports would otherwise rename or hand off a branch with nothing on it.
Questions are not reported; a planning session asks in its own conversation and the screen shows it
(§2.10), because a planning run holds one session and has no slot accounting to keep.

### 2.5 End of the planner step

On `planned plan={slug}`, `pir` checks, on the plan branch's committed tree:

- `plans/{slug}/PROGRESS.md`, `PLAN.md` and `DESIGN.md` exist at the branch head.
- `{slug}` is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) and does not match `^plan-[0-9a-f]{4}$`.
- `{slug}` is free: no branch `pir/{slug}`, no `plans/{slug}/PROGRESS.md` on `main`, no index entry
  `{repo}__{slug}`.
- The worktree is clean (`git status --porcelain` empty).

Any failure sends the planner a message naming the failed check and what to do (for a taken name:
choose another with the person, rename the folder, commit, report again), and the step continues. When
every check passes and the planner is not `busy`, `pir` closes it and renames (§2.6). Waiting for
not-busy is the same idle-gate the coordinator uses, so a final commit is never cut off.

On `no-plan`, `pir` closes the planner and the run finishes with outcome `no-plan`. The temporary
branch and worktree are left, because `pir` never deletes a branch.

A planner process that exits without either report leaves the run with no way forward, so the planning
program exits without a final status: the run shows crashed and can be resumed (§2.14).

### 2.6 The rename

Between the planner and the reviewer, in this order, each step skipped when already done so a crash
halfway is finished by a resume:

1. `git branch -m pir/plan-{hex4} pir/{slug}`
2. `git worktree move .claude/worktrees/pir-plan-{hex4} .claude/worktrees/pir-{slug}`
3. Move the control folder from `plans/plan-{hex4}/.parallel/plan/` to `<main>/plans/{slug}/.parallel/plan/`,
   then remove the emptied `plans/plan-{hex4}/.parallel/` and `plans/plan-{hex4}/` (only if empty); the
   running program re-points every path it holds.
4. Rename the index entry to `{repo}__{slug}.json`, keeping `kind: 'plan'`, clearing `label`.

The rename happens between sessions because a live session's working directory must not move under
it. The new worktree path is exactly the build's feature worktree path, so the build later finds the
branch already checked out there (`openFeature` reuses it). The control folder goes to
`.parallel/plan/`, beside the build's `.parallel/control/`, so the plan's conversations stay with the
plan and the build's control-folder hygiene never touches them; `plans/*/.parallel/` is already
gitignored. Measured on git 2.50.1: renaming a branch checked out in a linked worktree and moving that
worktree both work, and the worktree reports the new branch.

### 2.7 The review step and its end

The reviewer is spawned in `.claude/worktrees/pir-{slug}` with the reviewer instruction (§2.3). On
`reviewed plan={slug}`, `pir` checks on the committed branch tree that the review gate reads reviewed
(`parseProgress(text).planReviewed` on `plans/{slug}/PROGRESS.md`, as `readReviewGate` reads it) and the setup/test block parses (`parseTestBlock`
on `DESIGN.md`), and that the worktree is clean. A failure is a message to the reviewer, as in §2.5.
On success, once not busy, the reviewer is closed and the run finishes: outcome `reviewed`, final
status `finished`.

On `not-reviewed`, the reviewer is closed and the run finishes with outcome `not-reviewed`. It is
resumable (§2.14), which reopens the reviewer's conversation, because the person usually stopped to
think, not to abandon the plan.

### 2.8 The go

A finished planning run with outcome `reviewed` and no go decision is waiting for the person's go. Its
row reads `your go` (§2.10) and its watch view asks "{slug} is reviewed. Start the parallel build
now?" with the plan's width line from `analyzeParallelism` (§2.11).

- Start: the screen calls `startRun(slug)`, the same call `pir start {slug}` makes. The build writes
  its own index record under the same key with `kind: 'work'`, so the row flips from plan to work and
  the view switches to the build's live view.
- Not now: the screen writes `go: 'declined'` into the index record. The row reads finished, and the
  watch view's stale note says `Build it with: pir start {slug}`.

The question is derived from files, not held by a waiting process, because a process waiting on a
person would have to survive a reboot, and a finished record already does. `pir start {slug}` works on
a waiting or declined plan too; it is the same call.

### 2.9 Where a build finds its plan

A build reads its plan (`PROGRESS.md` for the review gate, `DESIGN.md` for the setup/test block used
by the pre-flight, the worktree setup and the end gate) from the plan's home, resolved by
`planHome(slug)` (T03):

1. The main checkout's working tree, if `plans/{slug}/PROGRESS.md` exists there. This is today's
   behaviour, unchanged.
2. Else the committed tree of branch `pir/{slug}`, read with `git show pir/{slug}:plans/{slug}/{file}`.
3. Else no plan (`no-plan`).

Main comes first so a hand-made plan behaves byte-for-byte as before, including a narrow re-review
committed on `main` while its build runs, which is why `runFeatureTests` reads the main checkout today.
The branch is read committed, not from its worktree, because a worktree may hold uncommitted edits
that no build would see. Dispatch already reads `PROGRESS.md` from the feature worktree and is
unchanged. The control folder stays `<main>/plans/{slug}/.parallel/control/`; for a branch-home plan
that folder exists on `main` only as an ignored directory until the merge brings the plan.

### 2.10 The dashboard

- A `TYPE` column between SLUG and STATE: `plan` or `work` (user 2026-09-26). A record without `kind`
  is `work`, so every existing record reads as it does today.
- One row per slug. A planning run's row becomes the build's row at the go (§2.8), because two rows for
  one plan would ask the person which one is real.
- Before the rename the SLUG cell shows the `label` in quotes, dimmed, since there is no slug yet.
- A plan row's STATE: `planning` or `reviewing` while running (green, as `running`), `your go` for a
  finished reviewed run with no go (amber bold, the colour of asking), `finished` otherwise, `stopped`,
  `crashed`.
- A plan row's PROGRESS: the steps, `plan …`, `plan ✓ review …`, `plan ✓ review ✓`, `plan ✗` for
  no-plan, `plan ✓ review ✗` for not-reviewed.
- The counts line gains `· N waiting for you` when any row is `your go`.
- The list footer gains `Ctrl+R resume`.

### 2.11 A planning run's live view

Opening a plan row shows its steps as rows: `plan` (planner), `review` (reviewer), `build`. Each row
carries a glyph, its phase text and its clock, painted like task rows: a live step with the spinner, a
step asking the person amber with `asking you · a question` or `allow a command?` (the same kinds
`workerActivity` derives for workers), a done step green, a pending one dim. `↑↓` pick a step, `→` or
`↵` open its conversation (its latest session, read-only when not live), `←` back to the list. The
steps view is reached through the same watch view as a build, so a planning run needs no new
navigation, only a new frame.

When the run waits for the go, the frame ends with the go question and its keys: `↵` start, `n` not
now. Esc quits `pir` and leaves the question in place. The approved mock is `prototype/index.html`
(scenes 3 to 7); it is a reference for the feel, and this section is the spec where they differ.

### 2.12 Where `pir plan` lands

Both forms, once the run is started, open the planner's conversation directly, with `←` going to the
run's steps view. The person started the run to talk to the planner, and the planner's first message
arrives within seconds. Until the planning program has written its first snapshot naming the planner,
the view says `starting the planner…`.

When the reviewer starts while the person is in the planner's conversation, the view follows into the
reviewer's conversation, headed by one line `the planner finished; the reviewer has started`, and `←` goes to
the steps view. A person on the steps view or the list is not moved. The person is there to talk to whoever
is working on the plan, the same reason as the landing (user at plan review, 2026-09-26).

### 2.13 The brief box

Bare `pir plan` opens a full-screen box: a title `pir plan  new plan in {repo}`, one prompt line, the
pi-tui `Editor` the conversation view uses, and a hint line. `shift+enter` or `ctrl+j` (pi-tui's
`tui.input.newLine`) adds a line and `enter` sends. Sending an empty or whitespace-only brief does
nothing. `esc` cancels: nothing is created and `pir` exits 0. The pre-flight (§2.2) runs before the box
opens, so the person does not write a brief that is then refused.

### 2.14 Resume

`Ctrl+R Ctrl+R` on the selected row, chorded like stop and remove, resumes it. It is offered on a
`stopped` or `crashed` row of either type and on a finished plan row with outcome `not-reviewed`.

- A plan row: the planning program is spawned detached again with `--resume`, which reads `state.json`
  and resumes the current step's last session by its session id (the SDK's `resume` option), in the same
  worktree, appending to its log after a `resumed` note. A rename left half-done is finished first (§2.6).
  `pir` then sends the resumed session one fixed message as its first user message (below).
- A work row: `startRun(slug)`, exactly `pir start {slug}`.

Resuming the same conversation is the user's choice (2026-09-26): the planner remembers everything
discussed, and nothing typed is lost. Measured 2026-09-26 on Claude Code 2.1.283 and SDK 0.3.282 by
`plans/resume-dead-worker`: a session SIGKILLed mid-command and resumed with `query({ resume: id })`
in the same cwd kept its id, its transcript and its memory. It misremembered its killed command as
never started, and a resumed session takes no turn until a message arrives. So `pir` sends, exactly
(`resumeInstruction`, T01):

```
You were stopped and have been resumed in the same worktree. Whatever you were doing when you stopped
may not have finished: check `git status` and the plan files, tell the person where things stand, and
carry on. Any question you had open was lost, so ask it again.
```

Without it a session that died mid-work sits idle with nothing on screen asking the person, and a
question pending at the kill is gone with the process (user at plan review, 2026-09-26).

### 2.15 The planning skills under `pir`

`pir-plan` and `pir-review-plan` each gain a "Run by pir plan" section (T15), engaged when the opening
instruction says so:

- `CLAUDE.md § Where sessions run` does not bind them: they run on a `pir/…` branch in a worktree by
  design, as build workers do. `CLAUDE.md` gains the matching carve-out; the skills carry it themselves
  because a project installed earlier keeps its older `CLAUDE.md`.
- The planner checks a proposed slug is free before writing anything: no `plans/{slug}/` on `main`, no
  branch `pir/{slug}` (`git branch --list`), and not of the form `plan-{hex4}`.
- The prototype is written to `plans/{slug}/prototype/index.html` and opened with `open <path>`,
  because the Artifact tool is absent from a headless session (measured 2026-09-26, FINDINGS).
- Both commit everything they write and leave the worktree clean.
- The planner ends by dropping `planned` (or `no-plan`) and stopping; it does not tell the person to
  start a new session. The reviewer ends by dropping `reviewed` (or `not-reviewed`); it does not name
  `/pir-work` as the next command, since `pir` asks the go itself.
- The reviewer's permission rules for `.claude/settings.json` are committed on the plan branch, where
  the build will run.

### 2.16 The unhappy paths

- Quitting `pir` stops nothing; the session waits for its answer, as a worker does.
- Stop (`Ctrl+S Ctrl+S`) is the build's stop: SIGTERM to the planning program, which closes its
  session, records `stopped` and exits; SIGKILL after 4 s; then `reapRecorded` on its `workers.json`.
- Remove is the build's remove: index entry, snapshot and conversations; the branch, the worktree and
  the plan files stay.
- A planning program killed outright records nothing and shows crashed; resume picks it up.
- Two planning runs in one repo at once are independent; their ids differ, and a slug collision is
  caught at §2.5.
- `pir start {slug}` on a branch-home plan not yet reviewed is refused as today, with the message
  naming resume: `'{slug}' is not reviewed — resume its planning run in pir (Ctrl+R)`.
- `pir plan` outside a git repo, without `main`, in the canonical checkout, or with an empty brief is
  refused by the pre-flight (§2.2).
- A dirty worktree at a report is a message to the session, never a commit by `pir`, because `pir`
  does not write the person's plan.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: inputs as parameters, decisions out. No clock, no fs, no process, no network.
src/shell/  everything platform-shaped: git, processes, files, the screen.
```

`src/core/boundary.test.mjs` scans the core for forbidden imports. If it fails, move the code; never
relax the test. Everything that decides what a planning run does next is on the pure side, so the
whole flow, crash points included, is tested in milliseconds.

### 3.2 Modules

New or changed, by task:

| Module | Side | Owns | Task |
|---|---|---|---|
| `core/planflow.mjs` | pure | the planning run's state machine, report parsing, slug and id rules, session names | T01 |
| `core/runrecord.mjs` | pure | `kind`, `label`, `go` fields | T02 |
| `shell/index-store.mjs` | shell | `renameRecord`, `updateRecord` (the build's `updateIndexFinalState` delegates to it) | T02 |
| `shell/plan-home.mjs` | shell | `planHome(slug)` and the file reads the gates use | T03 |
| `shell/coordinate.mjs`, `shell/launch.mjs` | shell | read the plan through `planHome` | T03 |
| `shell/worktree.mjs` | shell | `openPlanBranch`, `renamePlanBranch` | T04 |
| `shell/fake/claude-stream.mjs` | shell | per-session scripts, a `sh` step, the PATH shim | T05 |
| `shell/plan-run.mjs` | shell | the detached planning program | T06, T07 |
| `shell/worker-proc.mjs` | shell | a `resume` option | T07 |
| `shell/launch.mjs` | shell | `startPlanRun`, `resumeRun` | T08 |
| `shell/pir.mjs`, `bin/pir`, `install.sh` | shell | the commands | T09 |
| `shell/plan-rig.mjs` | shell | the fake end-to-end rig | T10 |
| `core/dashboard.mjs`, `shell/pir-tui.mjs` | both | TYPE, plan rows, resume chord | T11 |
| `core/plandisplay.mjs`, `shell/pir-tui.mjs` | both | the steps frame and the go question | T12 |
| `shell/brief-box.mjs`, `shell/pir.mjs` | shell | the brief box, the landing | T13 |
| `skills/pir-plan`, `skills/pir-review-plan`, `CLAUDE.md` | docs | "Run by pir plan" | T15 |
| `docs/`, `README.md` | docs | the behaviour | T16 |
| `shell/harness/*` | shell | the `plan-command` fixture | T17 |

### 3.3 The decision function

`decidePlanStep(state, facts) → { state, actions }` in `core/planflow.mjs`. `state` is `state.json`
(§3.5). `facts` is what the shell observed since the last call: parsed reports, the session's activity
(`busy`, `idle`, `permission`, `questions`, `exited`), the git checks of §2.5 and §2.7 as booleans with
their failure reason, which rename sub-steps are already done, and whether this is a `--resume` start.
`actions` is a list the shell executes in order: `spawn {step, resumeSessionId?}`, `send {text}`,
`close`, `rename {substep}`, `finish {outcome}`, `exitCrashed`. It reads no clock; the shell stamps
times. Every transition of §2.5 to §2.7 and §2.14 is a row in its tests.

### 3.4 Data flow

```
pir plan ──startPlanRun──► plan-run.mjs (detached) ──startWorker──► claude (planner / reviewer)
   │                          │   ▲ reports/ (drop files)              │
   │                          │   └────────────────────────────────────┘
   │                          ├─► state.json, status.json, run.log, workers.json (control folder)
   │                          └─► ~/.pir/runs/{repo}__{id|slug}.json
   └─ pir screen ◄── reads status.json + index ── drops inbox/*.json ──► plan-run forwards to session
                 └─ go: startRun(slug) ──► coordinate.mjs on pir/{slug} (unchanged, plan via planHome)
```

### 3.5 Storage

- `state.json` in the control folder, written with `writeJsonAtomic` after every transition:
  `{ version: 1, id, slug, step: 'plan'|'rename'|'review'|'done', sessions: { plan: [sessionId…],
  review: [sessionId…] }, outcome: null|'no-plan'|'reviewed'|'not-reviewed', renamed: {branch, worktree,
  control, index} }`. Temp-then-rename, so a crash leaves the previous state, and every action is
  idempotent against it.
- `status.json`: the snapshot schema unchanged (`version: 1`); its `runState` for a planning run is
  `{ kind: 'plan', label, slug, step, outcome, steps: [{ id: 'plan'|'review'|'build', phase, since,
  stoppedAt, worker, workers, asking }] }`. `runState` is already opaque to the schema.
- Index record: `kind: 'plan'|'work'` (absent reads `work`), `label: string|null`, `go:
  null|'declined'`, alongside today's fields; `serializeRecord` writes them.

---

## 4. Testing

- Pure: `planflow`, `runrecord`, `dashboard`, `plandisplay`, argv parsing. Exhaustive, milliseconds.
- Shell against real git in scratch repos: `planHome`, `openPlanBranch`, `renamePlanBranch`,
  `startPlanRun` with an injected spawn.
- The planning program end to end with the fake Claude on `PATH` (T05): planner → rename → reviewer →
  reviewed; no-plan; failed checks; crash and resume. No model, in `npm test`.
- The screen end to end under a pseudo-terminal against the same fakes (T10 rig): brief box, landing,
  answering a question, the steps view, the go, a fake build to a green hand-off, resume. In `npm
  test`.
- Once with real Claude: the `plan-command` harness fixture (T17), run in T18. Not in `npm test`: it
  spends model time.

Nothing here can prove the real planner holds a good planning conversation; T18 shows it completes
one against a stand-in, and the person's own first real use is the rest.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon |
| Runtime | Node v24.2.0 (package `engines` `>=22.19`); git 2.50.1; python3 3.14.7 (the pty relay) |
| Claude | Claude Code 2.1.283 on the PATH; SDK `@anthropic-ai/claude-agent-sdk` 0.3.282 pinned |
| Deliberately absent | no `timeout` binary (use `perl -e 'alarm N; exec @ARGV'`); no Playwright, nothing here is a web page |

**The test command** is `npm test`: `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`. It prints dots and a failure's full detail. For a person debugging, run
`node --test --test-reporter=spec <file>`. This shell exports `FORCE_COLOR=3`, which is why the command
sets `FORCE_COLOR=0` itself. Measured 2026-09-26: 38 s, green; in a fresh `git worktree add --detach`
the setup line then the tests pass and `git status --porcelain` is empty.

**Setup** is `npm ci` of the committed lockfile, skipped when there is none.

**Dependencies.** No new package. Any addition is the user's decision (live-workers DESIGN §5 rule
carried forward).

**End to end.** The surface is `pir`'s terminal screen. The existing tooling carries it:
`openScreen`/`driveScreen` in `src/shell/conversation-rig.mjs` run the real `pir.mjs` under a python3
pty relay and read the screen through `createScreenModel`. The free backend is the fake Claude
(`src/shell/fake/claude-stream.mjs`) put first on `PATH` as `claude` (T05), since `resolveClaudePath`
is `command -v claude`. T10 extends that tooling into a rig for planning runs; its tests are in `npm
test`. Sizes: 80×24 and 120×40.

**After changing engine code or a skill, run `./install.sh`**, never while any parallel or planning
run is live, because a live run's sessions use the installed engine and skills. Until `pir/pir-plan-
command` is merged, a task installs only into a scratch HOME (`HOME=/tmp/pir-plan-command-home
./install.sh`) and runs the engine from its worktree. The one exception is T18 copying the two planning
skills into the real HOME after the person's yes (§5.3).

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| A real planner and reviewer completing a plan through `pir`, and the build it starts | Only real `claude` sessions do it, and they spend model time (T18, `ask`) |
| Whether the planning conversation is good | A person's judgement of their own planning session, at first real use |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| Scratch repo | every rig and harness run | Never the canonical checkout (`PARALLEL_ALLOW_HERE` unset) |
| Fake Claude on `PATH` | every `npm test` end-to-end | No model is ever called by the test command |
| Harness `timeoutMs` | `plan-command` fixture 90 min | A stuck live run is torn down (HALT, stop, reap) |
| `PARALLEL_MAX_WORKERS` | `plan-command` fixture 2 | At most two paid build workers at once |
| Answerer reply cap | 40 canned replies per run | A planner that never converges is stopped, not fed forever |
| `workers.json` reap | stop, restart, teardown | No orphaned session survives a killed planning program |

### 5.3 Outside the code — who acts

Placed by the user at plan review, 2026-09-26: kept as proposed. The rules are in `.claude/settings.json`
(`worker` rows and login checks under `allow`, `ask` rows under `ask`).

| Action | Command | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` in the repo or a worktree | `worker` | Exact locked versions only (live-workers §5.3, user 2026-09-25) | Delete `node_modules` | none | none |
| Scratch install | `HOME=/tmp/pir-plan-command-home ./install.sh` | `worker` | Writes only under that HOME | `rm -rf /tmp/pir-plan-command-home` | none | none |
| Live plan-command run (T18) | `node src/shell/harness/run.mjs plan-command --into <scratch>` | `ask` | A whole plan of paid sessions: planner, reviewer, build | HALT, or the harness timeout; scratch deleted | an hour or two of model time on the plan | `claude auth status` (`loggedIn: true`) |
| Planning skills live for T18 | `cp -R skills/pir-plan skills/pir-review-plan "$HOME/.claude/skills/"` from the T18 worktree | `ask` | Changes the person's installed skills before merge; a personal skill shadows the harness's project copy (FINDINGS 2026-09-26) | The same `cp` from the main checkout restores `main`'s copies | none | none |
| `./install.sh` | refresh the installed engine and skills, once, after `pir/pir-plan-command` is merged | `worker` | Local, idempotent; never while any run is live | Re-run from the previous commit | none | none |

Credentials: none beyond the Claude Code login this machine already uses for `claude` (measured: the
probe of 2026-09-26 ran). Headless sessions draw on the plan's usage (memory, checked 2026-09-25).

---

## 6. Recovery

A planning run that misbehaves: stop it in `pir` (`Ctrl+S Ctrl+S`). By hand: `kill` each pid in
`<control>/workers.json` whose `ps -p <pid> -o lstart=` equals its `startTime`, then the program's pid
from `~/.pir/runs/{repo}__{id|slug}.json`. The control folder is `<repo>/plans/plan-{hex4}/.parallel/plan/` before
the rename and `<repo>/plans/{slug}/.parallel/plan/` after. An unwanted plan branch: `git worktree
remove --force .claude/worktrees/pir-{name}` then `git branch -D pir/{name}`. None of this touches
`main`.

---

## 7. Decisions and rationale

All user decisions are 2026-09-26.

- **Planning is hosted in `pir`'s screen** (user), not by launching interactive `claude` one session
  after another. The latter was cheaper but not detached, invisible to the dashboard, and could only
  tell a step ended when the person exited Claude.
- **A temporary branch, renamed after the planner** (user), rather than asking for the slug up front,
  so the planner still proposes the name in conversation.
- **Resume reopens the same conversation** (user), from a dashboard chord, rather than restarting the
  step fresh or abandoning the run.
- **The playback of 2026-09-26 was accepted as listed**, including: landing in the planner's
  conversation, one row per plan, no `pir` branch deletion, resume on build rows too, and classic
  `/pir-work` on a branch-only plan out of scope.
- **A TYPE column, `plan` or `work`** (user, at the mock). One row per slug, flipping at the go.
- **The mock was approved** (user) with the TYPE column added; kept at `prototype/index.html`,
  published at https://claude.ai/artifact/UKJn6mPEqmMDZuzk1LVpMh.
- **`pir {slug}` removed, not aliased** (user brief): `pir start {slug}` replaces it.
- **Reuse the worker line for planning sessions.** `startWorker`, `startPersonInbox`, the conversation
  view and `workers.json` already hold any Claude session; a second holder would fix every bug twice.
- **A separate planning program, not a coordinator mode.** The coordinator's pass is shaped around
  dispatching tasks from `PROGRESS.md`; a planning run has one session and no task table. They share
  every module below the loop.
- **Extend `startRun`'s plan read with a plan home, not a second launcher.** `pir start` must build
  both hand-made and `pir plan` plans with one pre-flight.
- **Extend the conversation rig and the harness** rather than add a third end-to-end tool
  (`pir-e2e` § 1).
- **The go question is a file state, not a waiting process** (§2.8), so it survives a reboot.
- **No spike** (user). The planned T00 resume probe was dropped: `plans/resume-dead-worker` measured the
  same SDK resume on the same versions the same day (FINDINGS). A worker's `resume` option is planned
  there too with the same interface; whichever plan lands first builds it and the other reuses it.
- **The canonical-repo guard applies to planning runs** (§2.2): they create branches exactly as a
  build does, and the same variable lets the person plan in this repo on purpose.
- **Remote Control for the whole planning session**, not only while it waits (user, after plan review; §2.3).
  Same opt-out as workers.
- **The view follows the planner into the reviewer** (user, plan review), rather than returning to the steps
  view as the mock shows (§2.12).
- **T18 installs only the two planning skills into the real HOME, after a yes** (user, plan review): an
  installed personal skill shadows the harness's project copy, so the real planner would otherwise load the old
  skill. The full installer would also replace `pir` before merge (§5.3).
- **A resumed session is sent one fixed message and keeps its log** (user, plan review): real Claude takes no
  turn after a resume until spoken to, and a question pending at the kill is lost (§2.14).
- **The control folder starts under `plans/plan-{hex4}/`, not `.git`** (user, plan review): `.git` is a
  protected path the planner cannot reliably write its report into (§2.2).
- **Prototype as a local file** (§2.15): the Artifact tool is not available to a headless session.

---

## 8. Explicitly out of scope

- Classic `/pir-work` on a plan that lives only on `pir/{slug}`. Merge it to `main` first; teaching
  `pir-work` a plan home is a separate change nobody asked for.
- `pir` merging to `main` or deleting a branch. Both stay the person's, as in the build.
- Editing a reviewed plan from `pir` before the go. The person resumes a session or edits the branch
  by hand.
- A time limit on a planning run. A planner waits for its person as long as it takes, like a worker.
- Changing the coordinator's dispatch, reconcile, merges or end gate beyond where it reads the plan
  from (§2.9).
- Running several planning sessions at once for one plan.
