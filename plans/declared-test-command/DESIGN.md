---
setup: none
test:
  - npm test
---

# Declared test command — Design

## 1. Purpose

A parallel run ends by running the plan's test command on the finished feature branch, and hands the
branch over only if it passes. Since 031157d that command is guessed from DESIGN.md's prose: the first
fenced block after a line mentioning "test command". The guess fails silently on plans that name the
command inline. `real-screen-time/remote-e2e` (2026-09-24) finished red with "no test command found"
while both of its suites passed (537 Swift, 188 server); 6 of 30 plans across the user's projects have
no readable block, and the harness fixture is one of them. Behind that sat a second failure: the
feature worktree is fresh, so `make server-test` exited 127 (`vitest: command not found`) until
`npm ci` was run in it by hand.

This plan makes the command a declaration instead of a guess. Every DESIGN.md opens with a front-matter
block naming its `setup` commands and its `test` commands. The planner writes it, the plan review
verifies it in a fresh copy of the repo, the engine refuses to run a plan without it, runs setup in
every fresh worktree it creates, and a red result always says why, on the status screen too.

### Success criteria

- `pir {slug}` and `/pir-work {slug}` refuse, before any task starts, a plan whose DESIGN.md has no
  valid block, naming `/pir-review-plan {slug}` as the fix.
- The end-of-run gate runs exactly the declared setup then test lines; no prose is parsed.
- A worker's worktree has had setup run in it before the worker starts, or the worker's opening
  instruction says which setup line failed.
- A red finish shows its reason and log path in the `pir` viewer, and never offers `git merge`.
- A watched live run of the `single` fixture, with a setup line added, shows `preparing` and ends
  green through the new gate.

### Stance

- The block is a declaration the review verified, not a hint. The engine never falls back to prose
  (user, 2026-09-24): a guess that fails reads as "tests fail", which is the lie this plan removes.
- Setup is always stated, `none` included, so a missing setup is a decision someone made, not a line
  someone forgot.

---

## 2. Behaviour specification

### 2.1 The block

DESIGN.md starts with it. The first line of the file is `---`, the block ends at the next line that is
exactly `---`:

```
---
setup:
  - cd server && npm ci
test:
  - make test
  - make server-test
---
```

- `setup` and `test` are both required. `setup: none` is the explicit empty setup; `test` must list at
  least one line, and `test: none` is invalid. A plan with no tests has nothing for the gate to prove.
- A list item is `  - ` followed by one shell line, taken verbatim after the dash and trimmed. It is
  not YAML-unquoted: what is written is what `/bin/sh -c` receives, so quoting behaves as in a shell.
- Blank lines and whole-line `#` comments inside the block are ignored. A trailing `# note` stays on
  a command line, since the shell ignores it; a key line takes no comment.
- Any other key is ignored, so a later plan can add one without breaking this parser. A single-string
  form (`setup: npm ci`) is rejected with a message naming the list form, because accepting two shapes
  is how two plans end up disagreeing about which one works.
- Each line runs in its own shell with the folder's root as its working directory. A `cd` does not
  carry to the next line, which is why the example writes `cd server && npm ci`.
- Setup must leave the folder clean: no tracked file changed and no new file git does not ignore
  (user, 2026-09-24). Setup runs unattended in every worktree, so `npm install` rewriting a lock file,
  or an install folder missing from `.gitignore`, would reach task commits or dirty a reused worktree.
  `npm ci` over `npm install` is the usual fix.

A block that is missing or malformed is reported with the reason (`no front-matter block`, `no test
key`, `setup: expected none or a list`, `line 4: expected "  - <command>"`), never as failing tests.

### 2.2 Which copy is read

The engine reads `plans/{slug}/DESIGN.md` from the main checkout's working tree, at start and at the
end-of-run gate. That is the copy the start gate already reads PROGRESS from (`readReviewGate`), and it
is the copy a narrow review pass (§2.6) fixes. A feature branch cut before the fix would otherwise
still lack the block at the end of the run. Workers do not edit DESIGN.md, so the main copy is the
plan's copy.

### 2.3 Start refuses a plan without a valid block

Both entry points check the block right after the review gate and before anything is spawned or any
worktree is created: the coordinator bin (`coordinate.mjs` `main`, dry run included) and the detached
launcher (`launch.mjs` `startRun`, new reason `no-test-block`, printed by `pir.mjs`). A restart is a
re-run of the same command, so it is checked the same way. The message says the plan counts as not
reviewed, gives the parser's reason, and names `/pir-review-plan {slug}`. The user decided this
(2026-09-24): a plan whose tests cannot be run by the engine is not ready to be built by it.

`pir-work` applies the same rule in the classic flow (§2.7).

### 2.4 Setup in each worker's worktree

When runPass step 3b creates or reuses a task worktree to spawn an implementer, it first starts the
setup lines in that worktree as a background child process, then records the task in a new loop phase
`PREPARING`. A later pass sees the child has exited and spawns the worker. `setup: none` skips the
phase and spawns in the same pass, exactly as today.

- A preparing task holds a ceiling slot, since it is about to become a worker; it is not subject to
  the liveness or death checks, since it has no session yet. It counts as live work, so the run's
  quiet-run end ("nothing left to do") never fires while setup is running.
- Setup success spawns normally. Setup failure spawns anyway (user, 2026-09-24: best effort) with a
  note appended to the opening instruction: the failing line, its exit status, the last 20 lines of
  its output and the log path. The worker then gets its worktree ready itself. The tail goes inline
  because a worker reading a file in the main checkout's control folder may hit a permission prompt.
- Output goes to `plans/{slug}/.parallel/control/setup/T{nn}.log`, rewritten per attempt.
- The review hand-off reuses the implementer's worktree and runs no setup. A reviewer spawned on an
  adopted worktree at restart runs none either, because its implementer already ran in it.
- HALT and the stop chord kill running setup children before the run exits. A coordinator that dies
  mid-setup leaves the task with a worktree and no worker; the next start's 3b runs setup again.
- The row shows `preparing`, an active phase with the spinner, so the screen does not look stalled
  during an `npm ci`.

Setup runs asynchronously because runPass is synchronous: a blocking `npm ci` would freeze every other
worker's merge and the display for its whole duration.

### 2.5 The end-of-run gate

When every task is ✅, `runFeatureTests` runs the setup lines, then the test lines, in the feature
worktree, each via `/bin/sh -c`, stopping at the first failure, with `PARALLEL_*` and `PIR_RUN` removed
from the environment. All output goes to `control/tests.log` with a `$ <line>` header per line. The
result names which half failed: ``setup `cd server && npm ci` exited 1`` or ``test `make test` exited
2``. `testCommandFrom` and its prose-guessing are deleted.

### 2.6 The plan review verifies the block

`/pir-review-plan` Pass 3 runs the block in a fresh copy: `git worktree add --detach` of HEAD into the
session's temp directory, the setup lines, then the test lines, then `git worktree remove --force`,
always. After setup, `git status --porcelain` must print nothing (§2.1); output there counts as a
setup failure. A fresh copy is the point: the main checkout already has everything installed, which is exactly
how remote-e2e's missing `npm ci` stayed hidden. On a project with no code yet the tests may fail the
way an empty project fails (the existing Pass 3 rule); setup must succeed.

A missing block is written by the review, measured on this machine, and told afterwards, since it has
one right answer once measured.

**The narrow pass (user, 2026-09-24).** On a plan already reviewed or with any task started, the review
normally refuses. When that plan's block is missing or malformed, it instead does only this: measure,
write the block, verify it in a fresh copy, show the user the block and wait for their yes, commit as
`plan-review({slug}): setup/test block`. It changes nothing else in the plan, and leaves the
`Plan reviewed:` line as it was.

### 2.7 The classic flow

`pir-work`'s review gate treats a missing or malformed block as not reviewed and stops with the same
pointer to `/pir-review-plan`. `pir-implement`, `pir-review` and `pir-worker` name the block's `test`
lines as the test command. A session whose tests cannot start because something is not installed runs
the `setup` lines first.

### 2.8 A red finish says why

`runPass` returns the gate's reason and log path alongside `testsPassed`. `buildRunState` carries them
as `runState.testsReason`, so they reach `status.json` (runState is opaque to the snapshot schema, no
version bump). The display's red footer carries the reason and the render prints it as a second line.
The `pir` viewer's finished frame for a red run says it is not ready to merge and where the log is. It
stops printing `Hand-off: git merge …`, which it does for every finished run today.

### 2.9 The unhappy paths

- Block malformed at start: refused, with the parser's reason (§2.3).
- Block edited in the main checkout mid-run: the gate reads the edited copy. That is the person's edit
  and the gate honours it.
- Setup hangs: the task stays `preparing` until HALT or stop. No time limit (§8).
- Setup fails in a worker's worktree: the worker starts with the note (§2.4). Setup fails at the gate:
  red, reason names setup.
- Two setups at once in different worktrees (`npm ci` twice): independent folders; the shared npm
  cache is safe under concurrent use.
- An orphaned setup child from a dead coordinator running beside the restart's new one in the same
  worktree: possible, rare, and it fails loudly into the note; accepted rather than tracked across
  restarts.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure: text in, decision out. No fs, child_process, clock.
src/shell/  — reads files, runs commands, spawns sessions.
```

The parser (`src/core/testblock.mjs`) is pure; reading DESIGN.md and running its lines are shell.
`src/core/boundary.test.mjs` enforces it; if it fails, move the code, never relax the test.

### 3.2 Modules

- `src/core/testblock.mjs` (new, T01) — `parseTestBlock(text)`. Replaces `src/core/testcommand.mjs`
  (deleted in T04).
- `src/core/setupnote.mjs` (new, T06) — `formatSetupNote`, the text of the setup-failure note.
- `src/shell/commands.mjs` (new, T02) — runs a list of lines in a folder, synchronously for the gate,
  in the background for worker setup. Owns the env scrub and log format moved out of `runFeatureTests`.
- `src/shell/coordinate.mjs` — start refusal (T03), `runFeatureTests` on the block (T04),
  `testsReason` into `buildRunState` and `displayPhaseFor` → `preparing` (T05, T07).
- `src/shell/launch.mjs`, `src/shell/pir.mjs` — the `no-test-block` refusal (T03).
- `src/shell/loop.mjs` — `PREPARING` in step 3b (T07), `testsReason` on the pass result (T05).
- `src/shell/platform.mjs`, `src/shell/fake/platform.mjs` — `spawn({ …, note })` (T06).
- `src/core/display.mjs`, `src/shell/render.mjs`, `src/shell/pir-tui.mjs` — red reason (T05),
  `preparing` phase (T07).

### 3.3 Storage

Only logs: `control/tests.log` (existing) and `control/setup/T{nn}.log` (new). The PREPARING state is in
memory; a crash loses it and restart re-runs setup (§2.4).

---

## 4. Testing

`npm test` covers the parser exhaustively, the runner against a scratch folder of shell one-liners,
the loop's PREPARING transitions against the fake platform with an injected setup runner, the refusals,
and the display strings. What it cannot reach: a real worker receiving the note, and a real run's
screen (§5.1). T12 runs one fixture live.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| macOS | 26.5.1, Apple Silicon |
| Node | 24.2.0, zero npm dependencies |
| git | 2.50.1 |
| Deliberately absent | any YAML library: the block is a fixed shape and the project takes no dependencies |

**The test command.**

```
npm test
```

The same line is in this file's front-matter block. The fence is here because the engine installed
while this plan is built still reads it; T04 deletes that reader. `npm test` runs
`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot`; this shell sets `FORCE_COLOR=3`, hence the
override. For detail, run `node --test <file>`.

**Dependencies.** None added.

### 5.1 What the test command cannot reach

| Not proven by it | Why |
|---|---|
| A real worker acting on a setup-failure note | Needs a live session; T12's run exercises the success path only |
| The `pir` screen as painted | Tests check the lines as text; T12 has a person look once |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Harness scratch repo | Live runs touch only a throwaway repo under the job temp dir |
| `PARALLEL_MAX_WORKERS=1` | One worker at a time in the live run |
| `touch plans/{slug}/.parallel/control/HALT` | Stops the run and, after T07, its setup children |
| 10-minute limit on the live run | T12's worker touches HALT if the run has not finished by then |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Fresh-copy verification | `git worktree add --detach <tmp> HEAD` … `git worktree remove --force` | `worker` | Local, temp dir, always removed | `git worktree prune` | none |
| Watched live run | `PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs single` in a trusted fixture scratch | `worker` | Spends real model time; moved down from `ask` by the user at plan review, 2026-09-24, as for resume-dead-worker: bounded by ceiling 1, scratch only, HALT at 10 minutes | HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine and skills | `worker` | Local copy, idempotent. Never while a parallel run of this plan is live: its workers use the installed engine | Re-run from the previous commit | none |

---

## 6. Recovery

Once installed, every plan without the block refuses to start, including plans already running in
other repos. The fix per plan is `/pir-review-plan {slug}`, which does the narrow pass (§2.6). To undo
the whole change: `git worktree add --detach <tmp> <commit before this plan>`, run that copy's
`install.sh`, then remove the worktree.

---

## 7. Decisions and rationale

- **Front matter in DESIGN.md, not a separate file** (user's proposal, 2026-09-24). DESIGN.md is read
  by every session already, so the declaration sits where the rules about it are.
- **Required, no fallback to prose** (user, 2026-09-24). Recommended was a fallback; the user chose to
  treat a plan without the block as not reviewed and stop.
- **Setup included** (user, 2026-09-24). The remote-e2e gate would have failed on `vitest: command not
  found` even with its command found. Alternatives were folding installs into each test line (slower
  for every run) or copying the main checkout's installs (stale when the branch adds a package).
- **Narrow review pass for plans already reviewed or started** (user, 2026-09-24), so an in-flight plan
  can be unblocked without a full re-review that could rewrite ground under finished tasks.
- **Worker setup is best effort** (user, 2026-09-24): a failure is handed to the worker in its opening
  instruction rather than blocking the task. The person sees nothing on screen for it (plan
  review, user, 2026-09-24): the worker handles it, the log has it, and the screen stays for what needs
  the person.
- **Setup leaves the copy clean, checked at plan review** (user, 2026-09-24, §2.1). One extra command in
  the fresh copy the review already makes, against stray files in task commits later.
- **Read from the main checkout** (§2.2). A restart's feature branch may predate the block.
- **The prose reader is deleted, not kept as a fallback.** Required means required; a second path
  would be the guess this plan removes.
- **Survey (Stage 4).** Extended: `runFeatureTests`, the review gate at both entry points, the display
  phase table, `openingInstruction`. Replaced: `testCommandFrom`. New: the parser and the background
  runner. Nothing in `src` parsed front matter before.

---

## 8. Out of scope

- Time limits on setup or tests. A hung suite hangs the gate as it does today; a limit is a separate
  decision about what "too long" means per project.
- Adding the block to finished plans. They never run again; `/pir-review-plan` adds it on demand.
- Setup on the review hand-off, which reuses a prepared worktree.
- Changing how any project's tests are written.
