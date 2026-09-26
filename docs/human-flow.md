# The human decision flow

Parallel mode keeps the classic rule that a person owns every genuine decision. A worker never
guesses an underspecified requirement or a real choice — it escalates. The difference from classic
mode is only where the person answers: not at a `/pir-work` prompt, but in the blocked worker's own
conversation, opened inside the `pir` screen.

## Questions and decisions — the person answers the worker in `pir`

When a worker cannot continue on its own, it pauses its task and does two things, then waits, doing
nothing further:

1. It **drops a one-line report** into the control folder's `reports/` — a `question` (something
   unspecified) or a `decision` (a genuine choice, either answer defensible). This is a plain file
   drop the command's loop reads directly; no agent is in the path. See
   [control-folder.md](control-folder.md).
2. It **asks the person in its own conversation** and ends its turn, holding its worktree.

On its next pass the command uses that report for two things: it keeps the parked worker's slot
counted under the ceiling (a parked worker is alive, not dead), and it marks the task's row
**asking you** in the live display, with the question, so the person can see who is asking and
correlate several at once. The footer reads `● Txx slug — asking you; open it (→) to answer`
(`render.mjs`), and the coordinator's start banner in `run.log` says the same.

The person **selects the task's row in the run's live view, opens its worker (→ or Enter), and
answers in the worker's conversation, in plain English** (see [detached-runs.md](detached-runs.md)
for the view and its keys). The answer is dropped into the control folder's `inbox/` and forwarded
to the worker at once (see [control-folder.md](control-folder.md)); the worker un-parks and
continues. The command does not read or relay the answer: it only carries it. A worker is not a
`claude agents` session any more — it appears in that list, but cannot be attached to — so `pir` is
the only place to answer it.

One parked worker does not stall the others: every other independent task keeps moving while it
waits, so the person is the bottleneck for that one decision only. A parked worker still holds a
slot under the ceiling, so if several stack up the run correctly throttles down to human speed. The
worker's side of escalating is in `skills/pir-worker`, `pir-implement`, and `pir-review`.

## Permission requests and question sets

A worker can also stop on Claude's own prompts, which reach pir over the worker's line rather than as
reports (`canUseTool` in `worker-proc.mjs`, logged as a `request` entry):

- **A permission request** — Claude asks before running a tool its permission rules do not already
  allow. The row reads `asking you · allow a command?`. In the conversation the request is pinned
  above the typing box with the tool, the command or input, and the worker's description. Enter on the
  empty box allows it once, `n` refuses, `a` allows it and does not ask this worker again for the same thing. Typing a
  reply instead refuses and sends the text, so the worker sees why. "Do not ask again" is kept by pir
  in memory for that worker's life and never written to any settings file (`createGrants`,
  `person-inbox.mjs`); a later request it covers is allowed by pir at once and logged
  `delivered-by-grant`, so it still shows in the conversation. `a` is offered only when Claude
  suggested a rule for the request and did not flag the rule as granting more than the request. A
  request Claude flags as risky needs the approving key twice, Enter or `a` ("press ↵ again to allow"); `n` still refuses in one press and any other key disarms it (`gateReducer` in `src/core/conversation.mjs`).
- **A question set** — the worker's AskUserQuestion tool. The row reads `asking you · a question`. The
  questions are pinned one at a time as a picker: ↑↓ move. On a pick-one question Enter chooses the
  highlighted line and goes on; on a pick-any question space ticks and Enter goes on. The last
  question's Enter sends. Every question ends with an "Other" line that is a text field: move onto it,
  or just start typing, and the text appears next to "Other:" (never in the typing box); Enter answers
  with it. It replaces a pick-one choice and joins a pick-any question's ticks. To talk instead of
  answering, Esc interrupts the worker, which cancels the question.

These keys work only while the typing box is empty. A request left unanswered simply waits: nothing
times it out.

## A task that needs the person's eyes is an ordinary worker that asks

There is no separate hands-on task type and no `pir-verify` path. When a task's real proof is a
person's judgement — a spike, a look at a running thing — the worker handles it the way the classic
flow always did: it builds and prepares up to the point where the only missing thing is the person's
eyes, then asks a specific question through the same escalation path as any other worker (above) — a
running thing and a list of what to look at, with the exact seatbelted command, not "can you check
this." The worker records the answer in `FINDINGS.md` on its task branch under its normal contract.
The bar for "genuinely cannot verify this itself" is written into the `pir-worker` contract, not
carried as a per-task marker.

## Live actions: the bins the plan review granted

A worker that deploys, calls a paid service or changes anything outside the repo follows the bin its
plan's `DESIGN.md §5.3` gives that action. `/pir-review-plan` turned the bins the person approved into
project permission rules in `.claude/settings.json`, which every worktree inherits because the file is
committed. A `worker` action is `allow`ed and runs without stopping. An `ask` action is under an `ask`
rule: the worker drops a `question` report, explains the action in its conversation and runs the
command, and Claude stops on the permission request, which reaches pir as above. The person opens the
worker in `pir` and presses Enter (allow) or `n` there, so one approval is the whole exchange. A `person` action
is only a login, a device or a judgement, raised like any other question. An action with no row is
treated as `ask`.

## Merge conflicts

There are two places a conflict can arise:

- **At a worker's own integrate.** Before signalling done, a worker merges the current feature
  branch into its task branch. If that conflicts in code, the worker attempts the resolution — it
  holds the task's context. If it cannot resolve cleanly, it drops a `conflict` report and waits, as
  above, for the person to open its conversation in `pir` and decide.
- **At the coordinator's own merge.** A worker's integrate was clean when it signalled done, but
  another task changed the same lines before the command merged this one, so `mergeTask` conflicts.
  The command **keeps that worker alive** — it does not close it, remove its worktree, delete its
  task, or respawn it — and, because the worker finished clean and has no idea a clash happened, the
  command **sends it the fix over its line** (`loop.mjs`; the text is `buildConflictPrompt` with
  `audience: 'worker'` in `src/core/conflict.mjs`). The message names the `git merge` that folds the
  feature branch into the task branch and the conflicting files, and tells the worker to resolve,
  run the test command (the `test` lines of the plan's `DESIGN.md` setup/test block), commit and
  re-signal done. It names no side: the worker resolves where both sides' work makes the result
  clear, and asks the person in its conversation when choosing a side is a judgement, which turns the
  row `asking you` like any other question. Nothing is asked of the person otherwise: the row reads
  `fixing conflict` in the working (cyan) style, with no paste block and no conflict footer. The
  worker resolves on its branch and re-signals done, and only then does the command merge the
  now-clean branch. The merge and the worker's close are paired — a worker is closed only after its
  branch has actually merged — so a conflict can never destroy the worker that must resolve it.

  **With no live worker to send it to**, the command falls back to a printed prompt: a ready-to-paste
  resolution for the person, which names the task branch to check out and land by hand
  (`buildConflictPrompt` with `workerName: null`). That happens on a restart, where reconciliation
  finds a reviewed branch that no longer merges, and when the send fails because the worker exited
  between the listing and the merge (`loop.mjs` 3d). Either way the task is marked `⛔` on the feature
  branch, so it is not rebuilt and its dependents wait, the branch is kept, and the prompt is printed
  once on the coordinator's screen, which for a detached run is `run.log`.

The command never merges a dirty branch into the feature branch. At the end it runs the plan's
declared `setup` then `test` lines on the feature branch first and, if they fail, prints the failure
and does not offer the `git merge` hand-off — it never tells the person a red branch is ready. The
red hand-off says which half failed and how (``test `make test` exited 2``), and names `tests.log`;
the same reason and path show in the live display's footer and in the `pir` viewer's frame of the
finished run, which says the branch is not ready to merge instead of offering `git merge` (see
[run-lifecycle.md](run-lifecycle.md), [detached-runs.md](detached-runs.md)). The person fixes the
feature branch and merges it themselves.

## The test command is the block

In both flows a plan's test command is the `test` lines of the setup/test block its `DESIGN.md` opens
with — not a command named in prose. A worker runs them as its test command, and runs the `setup`
lines first when its tests cannot start because something is not installed. When the plan's setup
failed in a worker's fresh worktree, the worker's opening instruction says which line failed, shows
the last lines of its output and the log path, and the worker gets the worktree ready itself; the
person is not asked about it. See [run-lifecycle.md](run-lifecycle.md).

## The worker ceiling

At most **4 workers run at once** (configurable via `PARALLEL_MAX_WORKERS`; default 4). This is the
one hard cap kept, because the command spawning its own workers is the real runaway vector, and it
also bounds paid agents and merge complexity. `decideDispatch` never spawns past it. Hitting the
ceiling is logged (`ceiling full`) and shown as a queued task waiting for a slot; nothing is dropped.
The command also carries a runaway breaker that aborts and tears the run down if this run's
live-worker count stays over the ceiling.

## Known limitation: a leaked background process outlives its worker

The idle-gate and its `force-idle` timeout (see [control-folder.md](control-folder.md)) only unblock
the command when a finished worker stays `busy`. They do **not** clean up a background
process the worker left running. A daemon that double-forks detaches from the session's process
group and reparents to init, so it survives the worker's SIGTERM entirely (a real run left
`cockpitd` daemons running 8+ hours later as pid-1 orphans). The reliable cleanup is the worker's own
discipline — run test suites in the foreground so their `trap … EXIT` fires, and leave nothing
running before going idle (`pir-worker`). Killing the worker cannot undo a leak the worker left
behind. This is worker-side hygiene the code cannot enforce, not a coordinator bug to fix here.
