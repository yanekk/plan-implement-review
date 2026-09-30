# The human decision flow

Parallel mode keeps the classic rule that a person owns every genuine decision. A worker never
guesses an underspecified requirement or a real choice — it escalates. The difference from classic
mode is only where the person answers: not at a `/pir-work` prompt, but in the blocked worker's own
conversation, opened inside the `pir` screen.

## Who answers first — the coordinator agent

A build run started from `pir` has a **coordinator agent** by default (`pir start {slug}
--no-coordinator` runs without one). It is the person's stand-in, and it sees every waiting item
before the person does: a question or decision report, a permission request, a question set. While it
holds one, the task's row reads `asking coordinator · …` in the working (cyan) style, the run does not
count it as asking the person, and the worker stays off Remote Control. The agent either answers the
worker on the person's behalf, through the same calls the person's answers use, or **passes it on**:
it says a pointer to the person in its own conversation (which worker, why it held back, what it would
pick), and only then does the row turn `asking you` and the worker's Remote Control come on. The person
answers the worker directly, exactly as below; the agent never relays the question or the answer.

Two kinds of request are always the person's, enforced by the command, not by the agent: an `ask`-bin
action (a permission request matching a `permissions.ask` rule in `.claude/settings.json`) and a
destructive command (`rm -rf`, a forced push, `git reset --hard` and the like). The agent may add a
note to one, never answer it. The person may answer any waiting item at any time, held by the agent or
not; the first answer wins. With the agent down, or with `--no-coordinator`, every item goes straight
to the person as described in the rest of this page. The whole behaviour is in
[coordinator-agent.md](coordinator-agent.md).

## Questions and decisions — the person answers the worker in `pir`

When a worker cannot continue on its own, it pauses its task and does two things, then waits, doing
nothing further:

1. It **drops a one-line report** into the control folder's `reports/` — a `question` (something
   unspecified) or a `decision` (a genuine choice, either answer defensible). This is a plain file
   drop the command's loop reads directly; no agent is in the path. See
   [control-folder.md](control-folder.md).
2. It **asks the person in its own conversation** and ends its turn, holding its worktree.

On its next pass the command uses that report for two things (with the coordinator agent on, it first
briefs the agent, and the steps below apply once the agent passes the item on): it keeps the parked worker's slot
counted under the ceiling (a parked worker is alive, not dead), and, once the worker has ended the
turn it asked in, it marks the task's row **asking you** in the live display, with the question (see
[When a row reads asking you](#when-a-row-reads-asking-you)), so the person can see who is asking and
correlate several at once. The footer reads `● Txx slug — asking you; open it (→) to answer`
(`render.mjs`), and the coordinator's start banner in `run.log` says the same. On `pir`'s runs list the
whole run reads `asking you` in amber bold while any of its workers waits on the person, so the question
is visible without opening the run (see [detached-runs.md](detached-runs.md)).

The person **selects the task's row in the run's live view, opens its worker (→ or Enter, or one
click on the row), and answers in the worker's conversation, in plain English** (see
[detached-runs.md](detached-runs.md) for the view and its keys, and
[The mouse](detached-runs.md#the-mouse) for what a click, hover and the wheel do on each screen). The
answer itself stays on the keyboard: a question picker and a permission prompt take no mouse action,
and the wheel only scrolls the conversation. The answer is dropped into the control folder's `inbox/` and forwarded
to the worker at once (see [control-folder.md](control-folder.md)); the worker un-parks and
continues. The command does not read or relay the answer: it only carries it. A worker is not a
`claude agents` session any more — it appears in that list, but cannot be attached to — so the places
to answer it are `pir` and, while it waits, claude.ai or the Claude app (below).

### When a row reads asking you

A task is **waiting on the person** — its row reads `asking you`, its clock is stopped, and Remote
Control is on (below) — when any of these holds, and the coordinator agent does not hold the item (a held
item reads `asking coordinator`; its clock is stopped too, and Remote Control stays off) (`waitingOn` in `src/core/asking.mjs`, the one predicate the
row, the clock and Remote Control all read, so they cannot disagree):

- its live worker has a permission request or a question set pending (the row reads `asking you ·
  allow a command?` or `asking you · a question`), or
- it is parked on its own `question` or `decision` report, and its worker is **not inside the asking
  turn** — the turn it dropped the report in. The report is only a real park once that turn has ended; or
- it is building or reviewing and its worker has **stopped**: its last turn has ended, nothing is
  pending, and no background job of its own is still running (`stoppedOnPerson` in `asking.mjs`). The
  row reads `asking you · a question` even when the worker dropped no report.

A worker in a run ends its turn only when it has finished (and then it has reported, which moved the
task on), when it waits on its own background job, or when it waits on the person; with the first two
ruled out, a stopped worker is waiting on the person. This catches a worker that asks in plain text
and forgets the report, and a follow-up question asked after an earlier one was answered, when the
earlier report no longer holds. A worker that stopped by mistake, with no question at all, reads
`asking you` too: pir does not read the worker's words to tell the two apart, since guessing could hide
a real question. The person opens it, finds nothing asked, and tells it to carry on. When the person
answers, the worker's next turn opens and the row reads `building` or `reviewing` again; there is no
park to lift.

**A background job still running means not asking**, unless the worker dropped a report. A worker
waiting on its own tests or build reads `building` or `reviewing` while the job runs, and when the job's
wake-up turn ends with nothing left running, it reads `asking you`. A job waited on with Monitor counts
the same way (measured 2026-09-27). The known miss: a worker that asks the person while a job of its
own is still running, without a report, reads `building` until that job's wake-up turn ends. The
worker contract closes it by telling workers to drop a fresh report every time they end a turn waiting
on the person (`skills/pir-worker`). A worker whose background jobs pir cannot see (a listing without
them, as in the test fakes) never reads stopped. Interrupting a worker ends its turn, so it then reads
`asking you`: it is waiting for the person.

A planner or plan reviewer in a `pir plan` run reads asking by the same stopped rule, until its report
is accepted (see [planning-runs.md](planning-runs.md#reports-and-how-pir-checks-them)).

A worker drops its report from inside a turn and then ends the turn with the question put to the
person. While that turn is still open the worker is working, whatever it reported: the row reads plain
`building` or `reviewing`, with no hint of the pending report, its clock runs and Remote Control stays
off. When the turn ends with the park still standing, the row turns `asking you` and the clock stops.
A worker that drops a report and works on to `implemented` in the same turn reads `building`
throughout. A later turn that is not an answer (a background job waking the worker, below) leaves the
row `asking you`: the question is still open, and flipping the row and Remote Control for the seconds
a wake-up lasts would switch the person's phone session off and on under them.

The task's own phase is unchanged by this: a report-parked task stays parked while its asking turn
runs, keeps its slot under the ceiling, and is never dispatched past. Only what the person is shown
changes. A worker pir cannot see in its listing keeps reading `asking you`, since guessing `building`
would hide a real question. A merge-conflict fix pir sent is not asking and reads `fixing conflict`.

### What un-parks a report park

The row stays **asking you** until the person answers. The worker's log shows the answer; no report is
needed for it. `resumeAnswered` in `loop.mjs` returns the task to `building` or `reviewing` on the first
pass that sees one of these:

| What happened | Answer? |
|---|---|
| A turn opened by a message typed in `pir` (sent `from: 'person'`) | yes |
| A message typed in `pir` delivered into a turn already open, the asking turn included | yes |
| A turn opened by a message typed on claude.ai or the phone over Remote Control | yes |
| A permission request or question set answered in `pir`, by a remembered grant, or over Remote Control (`answered-remotely`), with the turn still open | yes |
| A turn opened by a background job's wake-up (`task_notification`) | no |
| A message the coordinator agent sent on the person's behalf (`from: 'coordinator'`) | yes |
| A turn opened by a message pir itself sent (`from: 'pir'`) | no |
| A turn opened by anything else pir cannot recognise | no |

A turn that is not an answer moves the point answers are looked for from past it, so an answer after a
wake-up still counts. Input from the person counts wherever it lands: the first pass that sees the park
records how many messages the person has sent (in `pir` and over Remote Control), and any later one
un-parks, even one typed while the asking turn is still running. A reply sent in the seconds between
the report and that first pass is missed and waits for the next answer. How pir tells Remote Control
input from a wake-up: a message typed over Remote Control is announced in the worker's stream by a
`command_lifecycle` system message (`queued`, then `started`) before its turn opens; a pir send is
logged `out`, and a wake-up follows `task_notification` (`workerActivity` in `src/core/stream.mjs`,
measured against Claude Code 2.1.283).

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
  or just start typing, and the text appears next to "Other:" (never in the typing box), wrapped to as
  many lines as it needs; ←/→ move the cursor within it, and ← goes back to the live view only once it
  is empty. Enter answers with it. Option descriptions wrap too, never cut short. It replaces a pick-one choice and joins a pick-any question's ticks. To talk instead of
  answering, Esc interrupts the worker, which cancels the question.

These keys work only while the typing box is empty. A request left unanswered simply waits: nothing
times it out.

## Answering away from the terminal — Remote Control

While a worker waits on the person — a question or decision report whose asking turn has ended, a
stopped worker, a permission request, or a question set ([When a row reads asking you](#when-a-row-reads-asking-you)) — its session is switched to Claude's Remote Control, so the person
can answer from claude.ai or the phone as well as from `pir`. What tells the person's phone is pir's
own alert through ntfy, when it is set up ([Phone alerts](#phone-alerts--pir-notify), below); Remote
Control is only the way to reply. Each pass the command
works out which live workers are waiting (`remoteWanted` in `coordinate.mjs`) and switches each worker
on or off to match (`remoteControl` in `worker-proc.mjs`, which uses the SDK's undocumented
`enableRemoteControl`; the CLI's `--remote-control` flag and `/remote-control` are refused for a
headless worker). Once the answer is in and the worker is working again, it is switched off, which
ends the web session; a closing worker is switched off first. The session is named like the worker
(`{repo} / {plan} / {task} / {slug} / {role}`).

A `pir plan` session is the exception: the planner and the plan reviewer have Remote Control on for
their whole session, not only while they wait, because a planning session is a conversation with the
person from start to finish (see [planning-runs.md](planning-runs.md)). `PARALLEL_REMOTE=0` turns it
off there too.

- **An answer given there reaches the worker as if given in `pir`.** A permission request or question
  set answered on claude.ai is withdrawn from the worker's line and logged `answered-remotely`, so the
  row stops asking at once; the answer itself is in the tool result that follows. A reply typed there
  to a question report goes straight into the worker and its text is **not** in pir's log: the
  conversation view shows the worker's response, not what was typed. pir still sees that the person
  spoke, from the `command_lifecycle` message that announces it, and un-parks the task (above).
- **Notifications.** With phone alerts set up, pir sends the alert itself and the Claude app is kept
  silent for build workers and the agent (below). Without them, the Claude app's own push is the only
  one: all three kinds push, but for a permission request or a question report it was seen to arrive
  later than for a question set (2026-09-26), and pir cannot make it push or repeat.
- **Opt out** with `PARALLEL_REMOTE=0` when starting the run (`PARALLEL_REMOTE=0 pir start {slug}`): no
  session then appears in the person's claude.ai account, and phone alerts still come, without a link.
  A refusal — Remote Control disabled by
  managed settings, no claude.ai login — is logged `remote-control-failed` in that worker's
  conversation once, and the worker is still answered in `pir` as usual.

### Phone alerts — `pir notify`

pir tells the person's phone, through ntfy (a free push service with an iPhone and Android app, no
account; the topic name is the only secret), when a question in a build run becomes theirs and when
the run waits on their merge or their go. It is off until set up, per account, not per project.

**Setting up.** `pir notify` makes a random topic (`pir-` and 24 random characters), saves it in
`~/.pir/notify.json` (mode 0600), prints it with a QR code and the steps, and sends a test alert. In the
ntfy app, tap "Subscribe to topic" and type the topic: the iOS ntfy app has no QR scanner, and the phone
camera opens the code as a web link (seen 2026-09-28). If the test alert fails the topic stays saved,
and the command exits non-zero naming `pir notify test`. Running `pir notify` again shows the same topic
and QR and sends nothing, so the phone stays subscribed. `pir notify test` sends a test alert;
`pir notify off` deletes the settings and stops alerts at once, in runs already going too (the settings
are read at each send). A later `pir notify` makes a new topic. An unreadable settings file sends nothing,
and `pir notify` says to reset it with `pir notify off`.

**When a question alerts.** A worker's alert is driven by the same test as its `asking you` row and its
Remote Control (`waitingFor(...).holder === 'person'`), so the three always agree. A question the
coordinator agent answers never alerts. One alert goes out each time a worker becomes the person's,
for any reason: the agent passed it on, the agent held it past the hold limit, it is an `ask`-bin or
destructive request, the agent is down or failed, or the run has no agent. The same worker asking again
later is a new alert; two workers asking at once give two. End-of-run helper workers alert like any
other. Planning sessions (`pir plan`) never alert, and their Claude app push is left as it is.

- **Timing.** The alert is sent as soon as the worker's Remote Control link is known, so tapping it
  opens that worker's chat in the Claude app (seen on the iPhone, 2026-09-28). It goes without a link
  under `PARALLEL_REMOTE=0`, when Remote Control was refused, or after 20 s with no link. The loop wakes
  on the worker's question (5 s is only its backstop timer), so an alert follows the question within
  about a second; a question held by the agent alerts
  only when the hold limit (5 minutes) hands it over.
- **Wording.** Title `{plan} · {task} {role}` (a helper: `{plan} · main-sync resolve-main-merge`). The
  message opens with why it is the person's — `Agent passed it on: `, `Agent didn't answer in time: `,
  `Needs your yes: `, `Agent unavailable: `, or nothing when the run has no agent — then `asks: ` and
  the question (the first of a question set, with `(+N more)`), or `wants to run ` and the tool and its
  command for a permission request, cut to 150 characters. Those 150 characters pass through ntfy.sh.
- **Reminder.** One, 15 minutes after the alert if the question is still the person's, prefixed
  `Still waiting: `. It shares the first alert's sequence id, so a phone that supports updates replaces
  the first alert with it rather than stacking them. Never more than one.
- **Clear.** When the question is answered, or the worker stops waiting, or the run exits, pir clears
  the alert from the phone. ntfy documents this for Android and the web app; on the iPhone it was seen
  to work too (2026-09-28).
- **Icon.** Every alert carries pir's icon by URL. ntfy shows it on Android only; the iPhone shows its
  default (seen 2026-09-28).
- **The Claude app is silenced.** With alerts set up when a build worker, the agent or the finisher starts, pir sets
  `CLAUDE_CLIENT_PRESENCE_FILE` in its session to `~/.pir/presence` and makes that file exist, so the
  Claude app does not push a second time (seen silent on the iPhone, 2026-09-28). Remote Control is
  untouched. `pir notify off` deletes the file, so running sessions push through the Claude app again.
- **In `pir`.** A worker's conversation shows `alert sent to your phone` or `reminder sent to your
  phone` (note `notified`), or once per question `alert not sent: …` (note `notify-failed`) after ntfy
  failed. A send that cannot reach ntfy, or gets a 5xx or 429, is retried after 5 s and 30 s; another
  4xx fails at once. The run never waits for an alert, and `asking you` in `pir` is unaffected.
  `control.log` gets a `notify send|reminder|clear …` line per request, never the topic.
- **Restart.** Alerts are remembered only while the coordinator runs; after a restart a worker already
  asking gets a fresh alert.

**The end-of-run alert.** One alert when the run starts waiting on the person's merge: `{plan} · ready
to merge` with `All {n} tasks merged. git merge pir/{slug}`, or `{plan} · not ready` with `Tests red
on pir/{slug}: ` and the reason, or `Merge with main unresolved on pir/{slug}`. With the agent its tap
opens the agent's chat, where the report and the merge are presented (seen 2026-09-28), and it is noted
`notified` in the agent's conversation. Without the agent it is sent as the run ends, without a link.
It has no reminder and is not cleared; `main` moving and the branch re-synced does not send it again,
but restarting pir into `ready to merge` does. A green run the finisher takes over sends no `ready to
merge` alert; the finisher's own alerts below replace it. A red run, a run without the agent, and a run
whose finisher failed to start still send it.

**The finisher's alerts.** On a run the finisher takes over ([finisher.md](finisher.md#phone-alerts)),
the phone gets, keyed `finisher` in the same episode machine as a worker's question (so reminder, clear
and retry behave the same, and `control.log` reads `notify send finisher …`):

- `{slug} · ready for your go` when it enters `awaiting-go`: `{n} step(s) from project rules` (or `your
  rules`, `default rules`) and the first step. One reminder after 15 minutes; cleared when the phase
  leaves it.
- `{slug} · finisher stuck` when it enters `stuck`: its summary, cut to 150 characters. One reminder;
  cleared when it leaves `stuck`. `awaiting-go` to `stuck` is a new alert.
- `{slug} · finisher` when a request parks for the person in another phase (a reserved action after the
  go), worded as for a worker (`Needs your yes: wants to run …`).
- `{slug} · finished` with its done summary, once, as the run ends.
- `{slug} · finisher gave up` with `Merge by hand: git merge pir/{slug}`, once, when it gives up.

Each tap opens the finisher's chat through its Remote Control link, which is on for its whole session;
the gave-up alert carries no link, since that session is gone.

## A task that needs the person is an ordinary worker that asks

There is no separate hands-on task type and no `pir-verify` path. A surface is not such a task: the
worker drives it end to end and runs the drill itself (`skills/pir-e2e`), and the person is never asked
how a screen looks. When a task's real proof needs the person — a device, a login, a real person's
reaction — the worker handles it the way the classic flow always did: it builds and prepares up to the
point where the only missing thing is the person, then asks a specific question through the same escalation path as any other worker (above) — a
running thing and a list of what to look at, with the exact seatbelted command, not "can you check
this." The worker records the answer in `FINDINGS.md` on its task branch under its normal contract.
The bar for "genuinely cannot verify this itself" is written into the `pir-worker` contract, not
carried as a per-task marker.

## Live actions: the bins the plan review granted

A worker that deploys, calls a paid service or changes anything outside the repo follows the bin its
plan's `DESIGN.md §5.3` gives that action. `/pir-review-plan` turned the bins the person approved into
project permission rules in `.claude/settings.json`, which every worktree inherits because the file is
committed. A `worker` action is `allow`ed and runs without stopping. An `ask` action is under an `ask`
rule: the worker explains the action in its conversation and runs the command, and Claude stops on
the permission request, which reaches pir as above. The worker drops **no** report for it: the pending
request already reads `asking you · allow a command?`, and in auto mode the prompt may never come, so a
report dropped in advance would leave the row asking while the worker works (`skills/pir-worker`). The person opens the
worker in `pir` and presses Enter (allow) or `n` there, so one approval is the whole exchange. A `person` action
is only a login, a device or a judgement, raised like any other question. An action with no row is
treated as `ask`. The coordinator agent never answers an `ask` action: a request under an `ask` rule is always
the person's (see [Who answers first](#who-answers-first--the-coordinator-agent)).

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
  now-clean branch. The `merge-conflict` harness fixture drives this path live and unattended: the
  worker asks which greeting ships and the harness's stand-in for the person answers it. The merge and the worker's close are paired — a worker is closed only after its
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

With the coordinator agent on there is a third place: at the end of the run the command merges the
current `main` into the feature branch, so the person's merge goes through cleanly. If that conflicts,
a **main-sync worker** is spawned in the feature worktree to finish the merge, test and report `done`;
its questions go to the agent first like any worker's. Red tests at the end get the same treatment: one
**test-fix worker** in the feature worktree, one attempt, and the branch is handed over red only if the
tests still fail after it. While either runs it has a row of its own below the agent's row, `main-sync` or
`tests-fix`, which reads like a task's (`working`, `asking coordinator`, `asking you`) but is not counted
in `n/m done`. A question the agent passes on from it is answered as for any task: select its row, open
it (→ or Enter) and answer in its conversation, in `pir` or on the phone (see
[coordinator-agent.md](coordinator-agent.md#the-end-of-the-run)).

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
