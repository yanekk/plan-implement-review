# Detached runs — `pir`

`pir start {slug}` is how parallel mode is run. It starts the **coordinator** detached from the
terminal, so the run outlives the pane, and `pir` on its own opens a full-screen dashboard of every run
on the machine, from which a run is watched, stopped, resumed or cleared, and a worker is read and
answered. `pir plan` starts a **planning run** the same way, and the dashboard lists it beside the
builds (see [planning-runs.md](planning-runs.md)).

`pir` does not change how a run works: `pir start {slug}` spawns `coordinate.mjs` detached, with two env
flags set (below). Everything in [run-lifecycle.md](run-lifecycle.md),
[branch-model.md](branch-model.md), [task-state.md](task-state.md) and
[restart-recovery.md](restart-recovery.md) describes the run itself. This page is the lifecycle `pir`
adds around it: detach, index, snapshot, watch, the conversation view, stop, remove, keep-awake. (The
deprecated foreground launcher `pir-coordinate` was removed in `plans/live-workers` §2.13.)

## The commands

| Invocation | Does |
|---|---|
| `pir` | open the dashboard: one row per run across every repo on the machine, and the new-plan box under it |
| `pir plan` | open the brief box, then start a planning run ([planning-runs.md](planning-runs.md)) |
| `pir plan <words…>` | start a planning run with the words, joined by one space, as the brief |
| `pir start {slug}` | start the build of a reviewed plan detached, with its coordinator agent, and drop straight into its live view |
| `pir start {slug} --no-coordinator` | the same, without a coordinator agent: every question goes to the person and the run ends at the plain hand-off ([coordinator-agent.md](coordinator-agent.md)) |
| `pir <anything else>` | `pir: unknown command '<arg>'. To build a plan: pir start <arg>` and the usage, exit 2 |

`pir start {slug}` is start-or-open: if the slug is already running, it opens that run's live view
instead of starting a second one (a live planning run of that slug included: its steps view opens). If
the slug is stopped, crashed or finished, it starts it, and the coordinator resumes from committed work
(recovery is re-running the slug — [restart-recovery.md](restart-recovery.md)). `pir start` with no slug
or more than one is a usage error, and so is any flag other than `--no-coordinator` (which may come
before or after the slug). The usage text itself does not list `--no-coordinator`.

Exit codes: 0 a view opened (or the brief box was cancelled), 1 a refused start, 2 a usage error, so a
script can tell a refused run from a running one.

The bare `pir {slug}` form of earlier versions is gone, not aliased: `plan` and `start` would otherwise
be indistinguishable from slugs, and a plan named `plan` would silently change meaning. `pir --help`
and `pir -h` are not special: they read as unknown commands.

Stop, remove, resume and watch are actions inside the dashboard, not separate verbs. `pir` is a reader
and a launcher: it starts a run, reads state files, and the only run it ever signals is one it stops.

## Run identity and the four states

A run is keyed by its slug within its repo (a planning run, until its plan is named, by its run id
`plan-{hex4}`) — at most one live run per slug, and the same slug in two
repos is two independent runs. A run is in exactly one of four states, decided by `classifyRun`
(`src/core/runstate.mjs`), a pure function of recorded facts plus a liveness answer:

- **running** — its recorded process is alive and is the one we started.
- **finished** — it ended cleanly and recorded a `finished` final status: a green hand-off, a red
  feature branch (all tasks built, the feature tests fail), or nothing left to do. With the coordinator
  agent on, the hand-off does not end the run: it waits in `ready to merge`, still `running`, and is
  `finished` once the person merges the feature branch or tells the agent to close the run. A red branch is
  still `finished` — the run did its job and the red code is the person's to fix and merge.
- **stopped** — the person stopped it (below), which records a `stopped` final status.
- **crashed** — its recorded process is gone and it recorded no final status. This covers a true
  crash (SIGKILL, power loss, reboot) *and* a run that died abnormally on its own — an uncaught
  error, the runaway circuit-breaker, or the by-hand `HALT` kill switch. Those paths
  deliberately record no final status, so a run that errored out or tripped a safety brake shows
  crashed (red), never dim `finished`.

A bare "is the process alive" check is not enough, because process numbers are reused. A run records
its process's exact launch time (`ps -p {pid} -o lstart=`) at start; a process that is alive but
whose launch time no longer matches is a different process on a reused number, so the run is crashed.
Liveness and launch time come from the shell (`src/shell/identity.mjs`); the classifier reads no
clock and no process, so the reused-number rule is tested exhaustively without a live process.

Task state is **not** here. It stays in `PROGRESS.md` on the feature branch, owned by the coordinator
([task-state.md](task-state.md)). The state files this front-end reads describe the process, never
the task table — the run already commits the authoritative one, and two sources of truth for task
state drift.

## The index — cross-repo visibility

The authoritative state of a run lives in its own repo's control folder. So `pir` from any directory
can list runs across every repo, a small per-run entry is also written under `~/.pir/runs/`, one JSON
file per run named `{repo}__{slug}.json` (the repo name in the filename is why the same slug in two
repos never collides). The entry is a pointer plus what is needed to classify the run without opening
the repo: the slug, the repo and its path, the control-folder path, the process number and launch
time, and the final status once set. It also carries `kind` — `plan` for a planning run, `work` for a
build, absent read as `work` — and, for a planning run, its `label` before the rename and `go`, the
person's answer to the go question ([planning-runs.md](planning-runs.md)). A build started with
`--no-coordinator` carries `coordinator: false`, so a resume from the dashboard (`Ctrl+R Ctrl+R`)
starts it without the agent again; the field is absent otherwise, and absent reads as on. `pir start
{slug}` typed again takes the flag as typed, not from the record. A build writes its record
under the same key as the planning run it came from, so one plan is one row. `~/.pir/` is outside any repo and is never committed.

`pir` reads every index entry to enumerate the runs, then reads each run's snapshot for live detail.
A malformed entry is dropped and the rest are listed — one corrupt pointer never blinds the dashboard
to every other run. An entry whose repo has moved or been deleted is shown as unreachable and is
removable, never a crash of `pir`. Removing a run deletes its index entry and its snapshot; the plan
files under `plans/{slug}/` are untouched.

## The status snapshot

A detached run has no terminal of its own, so the only thing to paint is what it writes to disk. When
the launcher starts the coordinator it sets `PIR_RUN=1` (alongside `PARALLEL_LIVE=1`) in the
coordinator's environment. Under `PIR_RUN`, and only then, the coordinator reports on itself:

- **Each pass** it writes the run state it already builds for the live display, plus its process
  facts, to `plans/{slug}/.parallel/control/status.json` — the same control folder as the log and
  the report inbox ([control-folder.md](control-folder.md)). The write is temp-then-rename, so a
  reader gets either the previous complete snapshot or the new one, never a half-written file. A red
  end carries the gate's reason and `tests.log` path as `runState.testsReason` (`{ reason, logPath }`,
  null otherwise). Run state is opaque to the snapshot schema, so this needed no version bump; a
  snapshot written before the field existed shows a red footer without the reason.
- **On exit** it records the final status. A clean end (a hand-off, a stall with nothing left to do)
  writes `finished`; a stop writes `stopped`. Every abnormal exit — the `HALT` kill switch, the
  runaway breaker, an uncaught error — writes **nothing**, leaving the last live
  snapshot and the index entry both without a final status, so the front-end classifies the gone
  process crashed, not `finished`.

This whole self-reporting half is gated on `PIR_RUN`. A coordinator run by hand (`node
src/shell/coordinate.mjs {slug}`, as the tests and harness do) without it writes no snapshot and
touches no index entry. Each task in the snapshot's run state also carries the worker its row opens
(id, whether live, conversation-log path), the ids, roles and log paths of this coordinator's workers
for the task, and what kind of answer it is asking for (`asking`: a question, a permission, a question
set) and, with a coordinator agent, who holds that item (`holder`: `coordinator` or `person`)
(`buildRunState` in `coordinate.mjs`). The run state also carries `coordinator` (`{ id, live,
logPath }`, the agent the `c` key opens; null without one) and, at the end, `handoff` (`{ state:
'preparing' | 'ready' | 'red', reportPath, mainSha }`).
The snapshot is gitignored with the rest of the control folder (below).

## The dashboard and the live view

`pir` paints a full-screen list, one row per run: slug, TYPE (`plan` or `work`), state, repo, progress
(done/total from the snapshot), and live-worker count. A planning row's state, progress and slug read
differently — `planning`, `reviewing`, `your go`; `plan ✓ review …`; the brief's label in quotes before
the plan has a name — and a `your go` row adds `· N waiting for you` to the counts line (see
[planning-runs.md](planning-runs.md)). A running build with any task waiting on the person — a question
or decision report, a permission request or a question set, by the same rule as the live view's `asking`
tally (`askingCount` in `display.mjs`) — reads `asking you` in amber bold instead of `running`, and counts
in that same `waiting for you` tally; it reads `running` again once every ask is answered. A task fixing a
merge conflict asks nothing and does not count, and neither does a task whose item the coordinator agent
holds (`asking coordinator`): the run turns amber only once the agent passes an item on or an item is
reserved for the person. A running planning run reads `asking you` the same way while its planner or
reviewer has a question set or permission request open ([planning-runs.md](planning-runs.md)). A build
waiting at its end with a green hand-off reads `● ready to merge` in amber and counts in `waiting for you`;
the STATE column widens to fit it only while such a row is listed. A red hand-off reads `running`. This is a display state only (`runDisplayState` in
`dashboard.mjs`): the run is still classified `running`, and every chord treats it so. There is no process-number column — the person does not act on it.
Colour carries state and is never the only signal (glyphs carry the same state, so `NO_COLOR` and a
colour-blind reader lose nothing): a running run is green, finished and stopped are dim, crashed is
red; the progress bar is blue for a running run and red for a crashed one; the selected row is a dark
grey band across the full width, its dim text brightened (with colour off it is marked `▎` instead); an armed stop/remove confirmation is amber and bold. With no runs at all, the list is
replaced by one line — `No runs yet — type after @ below to plan something new` — so a first open
does not read as broken.

Below the list sits the **new-plan box**, a typing box whose text starts as `@`: type `@repo`, a brief,
and `↵` starts a planning run in that repo and opens its planner's conversation, as `pir plan` does
(the rules, the repo list and the refusals are in [planning-runs.md](planning-runs.md#the-new-plan-box)).
While the box is bare the list's keys work as before. A list longer than the rows the box leaves
scrolls to keep the selected run visible, with `↑ n more` / `↓ n more` where rows are cut. On a non-TTY
the list is painted as before, without the box, and its empty line still points at `pir start {slug}`.

Opening a build shows the **same** live task display the coordinator paints in the foreground — the
summary line, one row per task with its glyph, phase and elapsed clock, and the "asking you" footer.
The front-end does not invent a second display: it reads the snapshot and paints it with the
coordinator's own model (`buildDisplay`) and renderer (`src/shell/render.mjs`), re-reading as the
snapshot changes. Finished, stopped and crashed runs are openable too — their last frame is exactly
what a person opens the dashboard to see — shown marked stale, with the note that re-starting the slug
resumes it. A finished run's stale note offers `Hand-off: git merge pir/{slug}` only when its last
frame was green. A run with the coordinator agent shows its end in the live frame's footer while it
waits: `✔ ready to merge · git merge pir/{slug}` with `report: plans/{slug}/REPORT.md`, or `✗ not
ready · tests red on pir/{slug} — no merge offered` (see [coordinator-agent.md](coordinator-agent.md#ready-to-merge)). A red one — complete but not ready to merge — shows the red footer (the reason and
the log path, from `runState.testsReason`) and a stale note saying it is not ready to merge and to fix
the branch, with no merge line; a finished run with no snapshot at all points at `run.log` rather than
guess (`buildWatchFrame` in `src/shell/pir-tui.mjs`). A crashed run that never wrote a snapshot shows
its `run.log` tail and the log's full path instead, so a run that failed to start says why.

Opening a planning run shows its **steps view** instead — one row each for `plan`, `review` and `build`
— and, when the plan is reviewed and waiting, the go question that starts the build (see
[planning-runs.md](planning-runs.md)).

### The conversation view

The run's live view has a selectable task row (the same grey band). ↑↓ move it, and → or Enter opens
that task's worker in a third view, the worker's **conversation** (`src/shell/conversation-view.mjs`,
drawn with `@earendil-works/pi-tui`; the rules for what each line says are in
`src/core/conversation.mjs`). A task with no worker yet says so in the footer instead. The view opens
the task's live worker; with none live, its latest one, read-only, with no typing box. In a build with a
coordinator agent, `c` opens the agent's conversation in the same view, and the person types to it as
to a worker; with no agent, `c` leaves a note in the footer
([coordinator-agent.md](coordinator-agent.md#the-agents-own-conversation)).

The view reads the worker's conversation log from the control folder (the last 256 KB, then every
append; `log-follow.mjs`), so a closed `pir` loses nothing and two open screens agree. By default each
tool step is one line: the tool name, its main argument and the last line of its result; Tab switches
to full detail. Messages from pir, from the person and from the worker are marked and coloured
differently. A pending permission request or question set is highlighted and pinned above the typing
box (see [human-flow.md](human-flow.md)). Text Claude injects itself (a loaded skill's body, marked
`isSynthetic`) is not drawn.

Background work gets a dim `↳` line when a command or a Monitor moves to the background and another
when it ends (`running in the background: …`, `finished in the background: …`, `monitor started`,
`monitor ended`; a failure or a stop reads as such), from Claude's `task_started` and
`task_notification` events. While any of it is still running, the line above the box reads
`◌ N running in the background`, or `● working… · N running in the background` during a turn, so a
worker waiting on it does not look idle. A Monitor's own events never reach pir (Claude hands them to
the model only); the person sees the worker's reply to each.

What the person types is sent to the worker as a message, taken into its turn even if it is busy. A
slash command is sent the same way and its reply comes back as worker text; the box autocompletes the
worker's own slash commands, minus the four that do not work over the line (`/doctor`, `/color`,
`/focus`, `/reload-plugins`). Every input is dropped into the control folder's `inbox/` and forwarded
by the coordinator (see [control-folder.md](control-folder.md)); if the run is not `running`, nothing
is sent, the view says so, and the typed text stays in the box.

### Key bindings

The keys, as built, are shown in the footer of each view:

| View | Keys |
|---|---|
| List, box bare (`@`) | `↑↓` move · `↵` or `→` open the selected run · `Ctrl+R Ctrl+R` resume · `Ctrl+S Ctrl+S` stop · `Ctrl+X Ctrl+X` remove · `esc` quit · any other key types into the box |
| List, box typed in | `↵` start planning · `shift+↵` or `ctrl+j` new line · `esc` or `Ctrl+C` reset the box to `@` · `Ctrl+R/S/X` twice as above · arrows move the cursor · while the repo pop-up is open, `↑↓` pick and `Tab`/`↵` choose |
| Watch | `↑↓` pick a task · `→` or `↵` open its worker · `c` open the coordinator agent (only in a run that has one) · `←` back to the list · `Ctrl+S Ctrl+S` stop this run · `esc` quit |
| Steps (a planning run) | `↑↓` pick a step · `→` or `↵` open its conversation · `←` back to the list · `Ctrl+S Ctrl+S` stop this run (while it runs) · `esc` quit |
| The go question | `↵` start the build · `n` not now · `←` back to the list · `esc` quit, leaving the question in place |
| Brief box (`pir plan`) | typing · `↵` start planning · `shift+↵` or `ctrl+j` new line · `esc` or `Ctrl+C` cancel |
| Conversation | typing, `↵` send · `esc` interrupt the worker · `Ctrl+C` clear the box, or interrupt when it is empty · `←` with an empty box back to the live view · `Tab` one line per step ⇄ full detail · `↵`/`n`/`a` answer a pending permission, and `↑↓` `space` `↵` drive a pending question set (one `↵` answers a pick-one question), both only while the box is empty, and typing while a question set is pending goes to its Other line, where `←`/`→` move the cursor and `←` goes back only once the line is empty · `PgUp`/`PgDn` scroll |

`←` steps back one view; `esc` quits `pir` outright from the list and the live view, but in the
conversation view it interrupts the worker, as in Claude's own screen: the open turn ends at once, and
the person then types a new instruction. A command the worker had moved to the background keeps
running. Quitting the dashboard stops nothing and loses nothing — every run keeps running — so there
is no confirm on quit. Stop and remove are the destructive actions, and they are the ones guarded
(below). The read-only conversation view takes only `←`, scrolling and `Tab`.

(This replaces an earlier "`esc` steps back one level, then quits" model. `plans/detached-runs/DESIGN.md`
§2.3, §2.4 and §2.11 still describe that older model; the footers and this table are the built truth.
The whole screen moved onto pi-tui in `plans/live-workers` T11; the list and live view look as they
did before.)

Two dashboards open at once are both readers of the same files; either can stop or remove a run, and
the other repaints from the changed state on its next read. The dashboard holds no authority a second
copy could contend for.

### Following the dashboard from another program — `PIR_DASHBOARD_STATE`

A program that shows the dashboard in a pane (the agentic-ide cockpit) can follow what the person has
open. When `PIR_DASHBOARD_STATE` holds an absolute file path, bare `pir` keeps that file current; unset,
it writes nothing. `pir plan` and `pir start` never write it, even though they land in the same screen.

```json
{
  "version": 1,
  "pid": 12345,
  "view": "list" | "run" | "worker",
  "run": null | { "key": "{repo}__{slug}", "kind": "plan" | "work", "slug": "…", "repo": "…",
                  "repoPath": "/abs", "branch": "pir/…", "cwd": "/abs" | null },
  "worker": null | { "id": "<worker uuid>", "task": "T03", "role": "implement" | "review", "cwd": "/abs" | null },
  "updatedAt": "<ISO timestamp>"
}
```

- `view` is `list` on the runs list, `run` in a run's live view or steps view (the go question included),
  `worker` in a conversation. `run` is set in `run` and `worker`, `worker` only in `worker`. An open run
  whose record has gone (removed from another dashboard) publishes its view with `run: null`.
- `run.cwd` is the run's shared worktree, `{main worktree}/.claude/worktrees/pir-{slug}` for a build and
  the planning worktree (`pir-{runId}`, then `pir-{slug}` after the rename) for a planning run; `null`
  until that folder exists. The main worktree is git's, not the checkout the run was started from.
- `worker.cwd` is the worktree the worker was spawned in, read from the status snapshot's worker entries
  (which carry `cwd` alongside `workers.json`), so a finished worker still names its folder. A planning
  run's sessions all name the planning worktree under its current name. `null` for a snapshot written
  before `cwd` was recorded. A planning run's worker has `task` `plan` or `review`; its planner publishes
  role `implement` and its reviewer `review`.
- The file is rewritten only when what it says changes — the view, the open run or worker, or a path
  in it (a planning worktree renamed, a worktree created) — never on a refresh tick or a cursor move,
  because the reader moves panes on every write. Each write is a temp file beside it, then a rename.
- A clean quit removes the file. A crash or a kill can leave it behind; `pid` lets a reader tell.
- A failed write never disturbs the screen: it is retried on the next change and reported once, on
  stderr, after `pir` has left the screen (as is a path that is not absolute, which publishes nothing).

Built in `src/core/dashboard-state.mjs` (the object) and `src/shell/dashboard-publish.mjs` (the write).

## Start

Before it spawns anything, `pir start {slug}` runs a pre-flight (`startRun` in `src/shell/launch.mjs`):
the plan exists, the plan is marked reviewed in `PROGRESS.md` (the same gate `pir-work` and the
coordinator enforce), its `DESIGN.md` opens with a valid setup/test block (the coordinator's own
`readTestBlockGate`), and no run for the slug is already live. Both gates read the plan from its
**home** (`planHome` in `src/shell/plan-home.mjs`): the main checkout's `plans/{slug}/` when it has a
`PROGRESS.md`, else the committed tree of branch `pir/{slug}`, where `pir plan` leaves a reviewed plan
(see [run-lifecycle.md](run-lifecycle.md)). No plan in either place is refused as `no plan '{slug}'`.
An unreviewed plan on `main` is refused with the same pointer to `/pir-review-plan`; one that lives
only on its branch is refused with `'{slug}' is not reviewed — resume its planning run in pir
(Ctrl+R)`; a plan without a valid block is refused as `no-test-block`, and `pir` prints the
coordinator's own message — the parser's reason, that the plan counts as not reviewed, and
`/pir-review-plan {slug}` as the fix. The review gate is checked first, so an unreviewed plan reports
that, not the block. Either way nothing is spawned — a pre-flight failure that only surfaced after
detaching would show a crashed run instead of a clean error.

On a clean pre-flight the spawn detaches the coordinator from the terminal — a new session and process
group, its stdout and stderr to `run.log` in the control folder, and the parent returns at once. A
detached, session-leading child is not sent the hang-up signal when its terminal closes, which is what
lets the run outlive WezTerm. The launcher then records the child's process number and launch time,
registers the run in the index, and starts keep-awake.

A split-second double-launch — two `pir start {slug}` fired in the same instant, both reading "no live run"
— is accepted, not locked out. It is a human-paced tool, and the coordinator's own feature-branch and
worktree guards make the second coordinator fail loudly rather than corrupt the run; the recovery is
the ordinary one, stop the misbehaving run and re-start the slug.

## Stop — immediate

Stopping a run ends it now; it does not wait for the current unit of work to reach a safe point.
`stopRun` (`src/shell/control-run.mjs`) signals the coordinator to stop (SIGTERM); on that signal the
coordinator closes its in-flight workers and its coordinator agent, records a `stopped` final status, releases keep-awake, and
exits, leaving the task worktrees in place for the next start to reconcile from git. In-flight work is
cheap to redo, and a fast, predictable stop is worth more than salvaging a half-built task.

Workers are children of the coordinator, and a clean stop closes them. But a worker in the middle of
a command can outlive a coordinator that is force-killed (measured 2026-09-24 and 2026-09-25), so
stopping cannot rely on the coordinator alone. If it does not exit within a short grace period (4 s),
the front-end escalates: it force-kills the process (SIGKILL). On every path, once the coordinator is
gone, `stopRun` then reaps the workers it recorded in the control folder's `workers.json`: each pid
still alive with its recorded start time is sent SIGTERM, then SIGKILL after 3 s (`reapRecorded` in
`src/shell/reap.mjs`). A wedged coordinator cannot strand a run half-stopped with its workers still
burning tokens. The grace period is what separates a stop from a crash — never force-kill a run
without it. A planning run stops the same way: its program closes its session and records `stopped`,
with the same grace, force-kill and reap.

## Remove

A finished, stopped or crashed run's record is cleared from the dashboard with remove. A running run
cannot be removed; it must be stopped first. Remove clears the index entry, the run's status
snapshot and its workers' conversation logs (`conversations/`, `removeRun` in `control-run.mjs`); the
plan files under `plans/{slug}/` are untouched — the record is process bookkeeping, not
the plan.

Stop and remove are chorded and double-confirmed: `Ctrl+S` twice to stop,
`Ctrl+X` twice to remove. The first press arms a confirmation line; the second identical press within
the same selection carries it out; any other key cancels the arm. Both are irreversible in the moment
(stop kills in-flight work, remove drops the record), so both are guarded.

## Resume

`Ctrl+R` twice on a `stopped` or `crashed` row resumes it, chorded and confirmed like stop and remove
(the armed line reads `⚠ Ctrl+R again to resume {name}`). On a build it is `startRun(slug)`, exactly
`pir start {slug}`, and the coordinator reconciles from committed work
([restart-recovery.md](restart-recovery.md)). On a planning run — also offered on a finished one whose
review ended not reviewed — it reopens the same planner or reviewer conversation
([planning-runs.md](planning-runs.md)). A refusal (the run came back to life meanwhile, or `startRun`
refused the plan) is shown under the list (`resumeRun` in `launch.mjs`).

## Keep-awake

A run holds the Mac awake while it works. The launcher starts `caffeinate -i -w {pid}` against the
coordinator's process number: `-i` blocks idle sleep, `-w` makes `caffeinate` wait on that process and
exit when it dies (for a planning run, against the planning program's). Tying the awake-hold to the coordinator's lifetime with `-w` means any death of the
run — clean exit, stop, crash or force-kill — releases the Mac, so no code path can strand it awake.
The hold is unconditional, not battery-aware. (A forced sleep — the lid closed on battery — can still
sleep the Mac; the run pauses and resumes on wake, and its snapshot is simply stale meanwhile, which
the dashboard already shows plainly.)

## Storage and gitignore

- **Status snapshot** — `plans/{slug}/.parallel/control/status.json`, in the existing per-run control
  folder, written temp-then-rename each pass by the coordinator (the single writer). Already
  gitignored via `plans/*/.parallel/` (see `.gitignore` and [control-folder.md](control-folder.md)),
  so it never rides a task branch or the feature branch. A planning run's snapshot is in its own
  `plans/{slug}/.parallel/plan/` ([planning-runs.md](planning-runs.md)).
- **Index entry** — `~/.pir/runs/{repo}__{slug}.json`, one small JSON file per run, written
  temp-then-rename. `~/.pir/` is outside any repo and is never committed, so nothing gitignores it.

## Recovery

Nothing this front-end does is irreversible. A run is recovered by resuming it (`Ctrl+R Ctrl+R`) or
re-running its slug: `pir start {slug}` on a crashed or stopped build resumes from committed work (git is ground truth; the coordinator
reconciles — [restart-recovery.md](restart-recovery.md)). Removing a run's record deletes only
bookkeeping; the plan and its git branches are untouched, so a removed run is re-listed the moment it
is started again. The one action that changes the world outside the code is stopping a run, and its
way back is the same resume: `pir start {slug}`, or `Ctrl+R Ctrl+R` on its row.

If `pir` itself is unavailable, the by-hand recovery is in [restart-recovery.md](restart-recovery.md):
worker pids from `plans/{slug}/.parallel/control/workers.json`, `kill`, `git worktree remove --force`,
`git branch -D`, and `touch plans/{slug}/.parallel/control/HALT` to halt.

## Install

`./install.sh` copies the engine (`src/`) to `~/.claude/pir-engine/` and puts a logic-free `pir`
wrapper on the PATH (preferring `~/.local/bin`, falling back to `~/.claude/bin` with the exact `export
PATH` step printed), baking the installed engine path into it. So `pir` runs against whatever repo it
is invoked from, driving a detached run in the current repo. See `bin/pir` and `install.sh`.

The engine has two npm packages, `@earendil-works/pi-tui` (the screen) and
`@anthropic-ai/claude-agent-sdk` (the line to workers), pinned in the committed `package-lock.json`.
The installer copies `package.json`, the lockfile and `.npmrc` beside the engine and runs `npm ci`
there with dev, peer and optional packages omitted, so neither the SDK's peers nor its bundled
`claude` binary is installed: workers run the `claude` already on the PATH. Every install re-fetches
them, so it needs npm and the network; if `npm ci` fails the installer says so last and exits
non-zero, because the installed `pir` cannot start without them. It also removes an installed
`pir-coordinate` launcher it finds.
