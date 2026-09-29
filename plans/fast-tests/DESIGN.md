---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Fast tests — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T01 and T02 carry the changed wake-up behaviour into `/docs`. It never edits a finished plan's DESIGN.md.

## 1. Purpose

`npm test` takes about 4:50 on this machine (2,098 tests, all green), and every task session runs it at
least twice, so the suite's wall time is paid on every build and every review. The computer sits mostly
idle during a run: three pty test files set the finish time because their tests run one after another
(`plan-rig.test.mjs` 274 s, `coordinator-drill.test.mjs` 228 s, `conversation-rig.test.mjs` 73 s; the
other 81 files each take under 40 s). Inside those files the coordinator also misses its wake-up and waits
out its 5 s backstop timer several times per drill, which is the same lag a person sees in a real run when
a worker's question reaches the screen up to 5 s late.

This plan makes the suite fast by running the slow files' tests side by side and by making the
coordinator react to events instead of its timer. The second half is a product fix, not a test trick.

### Success criteria

- `npm test` finishes under 1:30 on this machine, quiet (no other session's tests running), and is green.
- 10 full `npm test` runs back to back, on a quiet machine, are all green and each under 1:30 (user
  2026-09-29).
- Every test still runs: the sorted list of test names after the plan equals the list before it.
- The coordinator drills pass with `PARALLEL_POLL_MS=60000`, which proves no step of a drilled run depends
  on the backstop timer.

### Stance

- Every test is kept. Speed comes from running tests at once and from removing waits the product should
  never have had, never from deleting, skipping or weakening a test.
- One test command. There is no quick variant that skips the drills (user 2026-09-29): a second command
  invites a session to present a partial pass as evidence.
- The backstop timer stays at 5 s. It exists for a missed filesystem event, and with the wake-ups wired it
  should almost never be what ends a wait. Shortening it would hide a missing wake-up instead of fixing it.

## 2. Behaviour specification

### 2.1 What wakes the coordinator loop

Today the loop in `coordinate.mjs main()` ends every pass in `waitForReport([reportsDir, inboxDir],
POLL_MS)`, which returns on a drop in either folder or after `POLL_MS` (5 s). Measured on 2026-09-29 with
timestamped tracing, the drops wake it correctly; what is late is everything that is not a drop:

| Event | Where it happens today | Measured lag |
|---|---|---|
| A worker's permission request or question | `worker.onEvent` in `createPlatform` (`platform.mjs` ~278) wakes nothing | request at +450 ms, pass at +5355 ms |
| A worker's turn ending after its report | the pass saw the report mid-turn and recorded `await-idle` (`loop.mjs` ~596, ~633); the `result` entry wakes nothing | 5002 ms, every drill |
| A worker exiting | `worker.onExit` in `createPlatform` | exit +23197, pass +28209 |
| The coordinator agent's decision | written to `control/coordinator/decisions/` (`coordinator-agent.mjs` ~296), not a watched folder | decisions +5404..5505, read +10360 |
| The agent's own worker events (its report, its turn end) | the agent's worker `onEvent`/`onExit` | report +41316, read +43260 |
| A setup child settling | `startLines` exit (`commands.mjs` ~135), seen only by `t.setup.poll()` at the next pass | not traced (drills use `setup: none`) |

The rule: any of these wakes the loop at once. The loop owns one waker, the pattern `plan-run.mjs`
`createWaker` already uses for the planning session: `wake()` resolves a pending `wait()`, and a `wake()`
that arrives while no `wait()` is pending (during a pass) sets a flag so the next `wait()` returns at once.
That flag is what closes the race between a pass draining a folder and the next watch being armed, so a
wake is never lost, whichever order the event and the wait come in. The waker is moved out of `plan-run.mjs`
into `drop-folder.mjs` and exported, and both loops use the one implementation, so there are not two.

Worker log entries with `dir === 'note'` do not wake. Notes are written by the coordinator's own pass
(`remote-control`, `delivered-by-grant`, `undelivered`), and waking on them would make a pass schedule the
next one. Every other entry wakes, including a worker's streaming output, because the snapshot the `pir`
screen reads is written by the pass, and a pass on output is what keeps a live row's activity current.

### 2.2 Passes are spaced

A pass never starts less than `PASS_MIN_GAP_MS` (250 ms) after the previous pass started. Wakes inside the
gap coalesce into the one pass at its end. Reason: with wakes on every non-note entry, nine streaming
workers would otherwise drive passes back to back, and a pass reads every worker's log fold and git state.
250 ms keeps the screen's worst-case lag at a quarter of a second, below the `pir` screen's own 500 ms
refresh, so the spacing is never what a person sees. The gap is a constant, not an env knob: no person has
a reason to tune it, and the backstop env (`PARALLEL_POLL_MS`) already exists for tests.

### 2.3 The end of a run does not wait between steps

`endPass` (`coordinate.mjs` ~727) advances `handoff.step` one case per pass (sync, syncing, tests, footer,
brief, report, waiting). A step whose successor can act at once (the sync finished, the brief is ready to
send) today still waits for the next pass, which with nothing else happening is the 5 s backstop: traced as
gate → main-sync → brief → report, each 5002 ms apart. Rule: a pass that changed `handoff.step` or
`handoff.state` wakes the loop, so the next step runs after the pass gap rather than the timer. The same
applies to the `--no-coordinator` path's one extra pass after the last merge (4995 ms traced): a pass that
merged, spawned or closed something wakes the loop once, since the pass that follows it may have work.
A pass that changed nothing does not wake, so an idle run still sleeps on the backstop and the stall count
(`STALL_GRACE`) still means three quiet backstop periods.

### 2.4 The slow test files run as several files

`node --test` runs files in parallel processes (default `availableParallelism() - 1` = 9 on this machine)
and a file's top-level tests one after another. The three slow files are split into several files each,
not given in-file concurrency. Every rig test already builds its own scratch root, repo, HOME, PIR_HOME,
fake Claude shim and clipboard (`plan-rig.mjs` ~162, `conversation-rig.mjs` ~225), so shared state does not
decide it; robustness does. In one process a busy event loop can run the 25 ms `waitFor` tick before
pending pty data is handled, so the 250 ms settle check passes on a stale screen and fails at random;
separate files give each rig its own event loop. In-file concurrency would also need every top-level test
wrapped in a `describe` with `concurrency`, a larger edit to the same files.

Shared helpers the split files need move into non-test modules (a `.mjs` without `.test`), one per original
file, so the three split tasks never write the same file. A new helper must not print `pir {slug}` or
`pir-coordinate` in user-facing text (`launcher.test.mjs` ~115, ~135 scan every `.mjs`).

The split keeps every test. Each split task records the sorted test names of its original file (from
`node --test --test-reporter=spec`) before the split and proves the union over the new files is identical.

### 2.5 Reliability under load

The suite must stay green when nine pty files run at once. The known sources of timing flakiness are the
fixed `pause(300/800)` calls in `plan-rig.test.mjs` (~1115, ~1185, ~1197, ~1213) and the 15 s `waitFor`
defaults. Rule: a fixed pause that waits for the screen to change is replaced by a wait on the screen
condition itself, and a limit is raised only with the measured reason in the commit. If the suite is
still flaky at nine files, `--test-concurrency` in `npm test` is lowered to the largest value that is
reliable, and the number and its measurement go in § Environment.

### 2.6 The unhappy paths

- A filesystem event is missed or `fs.watch` fails: the 5 s backstop still ends the wait (`waitForDrop`,
  unchanged). Correctness never depends on a wake-up; only speed does.
- A wake arrives during a pass, including during a synchronous merge or end-gate test run: the waker's flag
  makes the next wait return at once.
- A worker floods its log: passes run at most every 250 ms (§2.2).
- The coordinator is signalled while waiting: unchanged. The signal handler parks the loop; a wake after
  that runs no pass because the loop checks `signalled` first.
- 1:30 is missed after T06's hardening: T06 stops and brings the person a trim task as a decision (§8), it
  does not trim on its own.

## 3. Architecture

### 3.1 The boundary

`src/core/` is pure and `boundary.test.mjs` scans it for forbidden imports; if that test fails, move the
code, never relax the test. This plan adds one pure function, `wakesLoop(entry)` in `src/core/stream.mjs`
(which entries wake the loop, §2.1), and a pure `endProgressed(before, after)` if T02 needs one. Everything
else here is shell: the waker, the platform hooks, the loop wiring and the test files.

### 3.2 Modules touched

| Module | Change | Task |
|---|---|---|
| `shell/drop-folder.mjs` | exports `createWaker` (moved from `plan-run.mjs`), gains the pass gap | T01 |
| `shell/plan-run.mjs` | imports `createWaker` instead of defining it | T01 |
| `shell/platform.mjs` | `createPlatform({ onActivity })` called from every worker's `onEvent` and `onExit` | T01 |
| `shell/coordinator-agent.mjs` | `startCoordinatorAgent({ onActivity })` on its worker's events and on a decision file landing | T01 |
| `shell/person-inbox.mjs` | `startPersonInbox({ onActivity })` after a drain that forwarded something | T01 |
| `shell/coordinate.mjs` | `main()` owns one waker; `makePrepare` passes a settle hook to `startLines` | T01, T02 |
| `shell/commands.mjs` | `startLines(…, { onSettled })` | T01 |
| `core/stream.mjs` | `wakesLoop(entry)` | T01 |
| the three slow test files | split into several files plus one helper module each | T03, T04, T05 |
| `package.json` | `--test-concurrency=N` only if §2.5 needs it | T06 |

## 4. Testing

Unit tests cover the waker (wake before wait, wake during wait, gap coalescing, backstop still fires), the
entry filter, and each hook calling `onActivity` (fake workers from `fake/claude-stream.mjs`, fake watch).
The drills are the end-to-end proof: they run the real `coordinate.mjs` against the fake Claude, and with
`PARALLEL_POLL_MS=60000` a missed wake-up turns into a 60 s stall and a timed-out test, so a green drill
under that setting proves the wake-up is wired for everything the drill exercises. Nothing here has a new
surface; the screens are unchanged and are already driven by the existing rigs.

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5), Apple Silicon, 10 CPUs (`os.availableParallelism()` = 10) |
| Runtime | Node v24.2.0 (`--test-concurrency` supported; default file concurrency 9); python3 (the pty relay) |
| Deliberately absent | no Playwright; no `timeout` binary |

**The test command** is `npm test` (`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`): dots on green, a failure in full, colour forced off inside the command because
`FORCE_COLOR=3` is set in this machine's environment. For detail, `node --test --test-reporter=spec <file>`.
The glob picks up new test files, so a split needs no change to the command. **Setup** is `npm ci` of the
committed lockfile, measured 2026-09-29 in a fresh detached worktree: it leaves `git status --porcelain`
empty.

**Measuring time.** Other sessions on this machine often run their own suites, which slows every
measurement. A timing claim in this plan is made on a quiet machine: before and after each timed run,
`ps -eo command | grep -c '[n]ode --test'` shows no `node --test` process but the run's own. A run that
overlapped a foreign one does not count, in either direction.

**Dependencies.** No new package.

**End to end.** The existing rigs carry everything: `plan-rig.mjs` (`startPlanRig`, the real `pir.mjs`
under a pty with a detached `coordinate.mjs` and the fake Claude) and `conversation-rig.mjs`. No new rig.

**After changing engine code, run `./install.sh`**, once the plan's code is on `main` and never while a run
is live, because live runs use the installed engine. Built in parallel, the last task ends on a task
branch, so it does not install: it writes under PROGRESS "Blocked on the user" that the install follows
the person's merge.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Nothing new | The wake-up change is proven by the drills against the fake Claude; a real run behaves the same because the platform hooks are the ones real workers drive |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Rig scratch HOME/PIR_HOME, fake Claude and `pbcopy` shim first on `PATH` | no test touches the person's `~/.pir`, `~/.claude` or clipboard, no model is called |
| The 5 s backstop (`PARALLEL_POLL_MS`) | a missing wake-up costs latency, never a hang |
| `PASS_MIN_GAP_MS` | an event flood cannot spin the coordinator |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | exact locked versions only | delete `node_modules` | none |
| Refresh the installed engine | `./install.sh`, once the code is on `main`, no run live | `worker` | local and idempotent | re-run from the previous commit | none |

## 6. Decisions and rationale

- User, 2026-09-29: no quick test command that skips the drills. `npm test` stays the one command.
- User, 2026-09-29: done means 10 back-to-back full runs on a quiet machine, all green, each under 1:30.
- User, 2026-09-29: the per-step waits (the `pir` screen's 500 ms redraw, `pir-tui.mjs` ~1015; the rigs'
  250 ms settle; the fake agent's `DRILL_REPORT_DELAY_MS` 3 s, `fake/sessions.mjs` ~159) are left alone.
  If T06 misses 1:30, a trim task comes to the user as a decision.
- Planner, from the code survey: reuse `plan-run.mjs`'s `createWaker` (it already wakes on worker
  `onEvent`/`onExit`) rather than write a second waker; move it to `drop-folder.mjs` beside `waitForDrop`,
  which it wraps.
- Planner: split files rather than in-file concurrency (§2.4).
- Planner: keep the 5 s backstop default (§1 Stance).
- Planner: coalesce wakes with a 250 ms pass gap rather than waking only on a hand-picked set of entry
  kinds. A hand-picked set is the same bug waiting for the next entry kind; the gap bounds the cost of
  waking on all of them.

## 7. Explicitly out of scope

- A quick test command (user decision, §6).
- Trimming the per-step waits, including the product's 500 ms screen redraw (user decision, §6).
- The planning session's own loop timer (`plan-run.mjs` `POLL_MS` 5000): it already wakes on its worker's
  events, and the traces show no missed wake-up there.
- Deleting, skipping or shortening any test's assertions to save time.
