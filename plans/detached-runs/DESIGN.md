# detached-runs — Design

> Written by `/pir-plan`. Read by every session that touches the `pir` front-end, the run
> index, the status snapshot, or the coordinator's self-reporting. Flat prose; every rule
> carries its reason.
>
> This plan adds a new way to launch and observe a parallel run, so the canonical account of
> the detached lifecycle lands in `/docs` (CLAUDE.md), updated in T13. This `DESIGN.md` is the
> build-time rationale: why the mechanism is shaped this way and what was decided and rejected.

## 1. Purpose

A parallel run today is `pir-coordinate {slug}`, a foreground program run in a terminal pane
inside the user's WezTerm setup. It is a child of that terminal, so restarting WezTerm or
my-agentic-ide kills the run and whatever it was mid-way through. The user wants a run to
outlive the terminal it was started from, and a small set of commands to see and steer any run
from any terminal without babysitting a pane.

This plan adds `pir`: `pir {slug}` starts a run detached from the terminal, and `pir` on its
own opens a full-screen dashboard of every run on the machine, from which a run can be watched,
stopped, or cleared. The coordinator gains the ability to report on itself — a live status
snapshot it rewrites each pass and a final status it records on exit — so a detached run that
nobody is attached to still has a truthful, readable state on disk.

### Success criteria

- A run started with `pir {slug}` keeps running after the terminal that launched it is closed
  or restarted (hand-verified, §5.1).
- `pir` lists every run on the machine across repos, each with a state that is checked against
  reality: a run whose recorded process is gone shows as crashed, not running.
- Opening a running run shows the same live task display `pir-coordinate` paints today, updating
  as the run progresses.
- `pir {slug}` on a stopped or crashed run resumes it from committed work; on a running run it
  opens its live view rather than starting a second run.
- Stopping a run ends it and its in-flight workers immediately; a killed run never leaves the
  Mac held awake.

### Stance

One run per plan, keyed by slug, with the task table in `PROGRESS.md` still the single owner of
task state (§2.2). The run state this plan adds covers the process, never the tasks — it points
at where the plan stands, it does not duplicate it. The front-end is a reader: it launches a run
and reads state files, and the only run it ever signals is one it stops. The coordinator stays
the single writer of its own run state, because two writers of one status is the bug this design
exists to avoid.

---

## 2. Behaviour specification

### 2.1 The two invocations

`pir {slug}` starts a run and drops straight into its live view. `pir` with no argument opens
the dashboard. There are no subcommands: stop, remove and watch are actions inside the
dashboard, not separate verbs. Reason: the product is a dashboard a person lives in while a run
works, not a set of scripts; the mock confirmed this direction with the user (§7).

`pir-coordinate {slug}` stays exactly as it is — the foreground engine `pir` drives. `pir` is a
new front-end, not a replacement. Reason: the detached launcher's whole job is to spawn the
existing coordinator detached; keeping the engine a separate, runnable program keeps a run
debuggable in the foreground and keeps this plan from touching the run's logic.

### 2.2 Run identity and state

A run is keyed by its slug within its repo. At most one run per slug is live at a time. A run is
in exactly one of four states:

- **running** — its recorded process is alive and is the one we started.
- **finished** — it ended cleanly and recorded a `finished` final status: a green hand-off, a red
  branch (all tasks built but the feature tests fail), or nothing left to do (every remaining task
  handed off or blocked on the user). A red branch is still `finished` — the run did its job and the
  code is red, which is the person's to fix and merge (§2.4); the run itself ended cleanly.
- **stopped** — it was stopped by the user (§2.6), which records a `stopped` final status.
- **crashed** — its recorded process is gone and it recorded no final status. This covers a true
  crash (SIGKILL, power loss, reboot) *and* a run that died abnormally on its own — an uncaught
  error, the runaway circuit-breaker, the safety-cap, or the by-hand HALT kill switch. Those paths
  deliberately record no `finished` status, so the dashboard shows them crashed (red), not dim
  `finished` (user decision, §7). Reason: a run that errored out or tripped a safety-brake must not
  look identical to a clean success; red is the signal that something went wrong and wants a look.

State is decided by `classifyRun` (§3.3), a pure function of the recorded facts plus a liveness
answer. A bare "is the process alive" check is not enough, because process numbers are reused: a
run records its process's exact launch time at start, and a process that is alive but whose
launch time no longer matches is a different process on a reused number, so the run is crashed.
Reason: a dashboard that reports a reused number as "running" would point the user at a live view
that never updates, which is worse than saying crashed.

Task state stays in `PROGRESS.md` on the feature branch, owned by the coordinator (docs/task-state).
This plan's state files describe the process, never the task table. Reason: two sources of truth
for task state drift, and the run already commits the authoritative one.

### 2.3 The dashboard

`pir` paints a full-screen list: one row per run, columns slug, state, repo, progress
(done/total from its snapshot), and live-worker count. A run is selectable with the arrow keys
or a click; the selected run opens with Enter or a click. There is no process-number column —
the user does not act on it. Reason: the list is scanned and operated, so it carries what a
person decides from and nothing they do not.

With no runs to list — a fresh machine, or after every record has been removed — the dashboard
shows a short get-started line in place of the empty list: "No runs yet — start one with
`pir {slug}`" (user decision, §7). Reason: a blank screen reads as broken to someone opening the
dashboard for the first time; one line tells them the list is genuinely empty and how to fill it.

Esc from the list quits `pir` outright, with no confirm. Reason: quitting the dashboard stops
nothing and loses nothing — every run keeps running — so a confirm would be friction guarding
an action with no cost.

Finished, stopped and crashed runs are openable too, not only running ones. Reason: the last
frame of a crashed run and the hand-off line of a finished one are exactly what a person opens
the dashboard to see.

### 2.4 The live view

Opening a run shows the same task display `pir-coordinate` paints today — the summary line, one
row per task with its glyph, slug, phase and elapsed clock, and the asking-you footer
(docs/run-lifecycle, `src/core/display.mjs`). The front-end does not invent a display: it reads
the run's snapshot, which carries the run state a pass produced, and paints it with the existing
`buildDisplay` model and renderer. Reason: the display is already designed, built and
hand-verified; watch must be that exact thing, not a second rendering that drifts from it.

The view repaints as the snapshot changes. Esc returns to the list. A crashed or finished run
shows its last snapshot, marked stale, with the note that re-starting resumes it. Reason: a
detached run has no terminal of its own, so the snapshot on disk is the only thing to paint, and
painting a stale one plainly is more honest than a blank screen.

### 2.5 Start

`pir {slug}` runs a pre-flight before it spawns anything: the plan folder exists, the plan is
marked reviewed in `PROGRESS.md` (the same gate `pir-work` and the coordinator enforce), and no
run for the slug is already live. An unreviewed plan is refused with the same pointer to
`/pir-review-plan`, and nothing is spawned. Reason: a pre-flight failure that only surfaces after
detaching would show the user a crashed run instead of a clean error.

If the slug is already running, `pir {slug}` opens its live view instead of starting a second
run. If it is stopped, crashed or finished, `pir {slug}` starts it, and the coordinator resumes
from committed work (docs/restart-recovery — recovery is re-running the same slug). Reason: one
run per slug, and re-running is already how a run resumes, so start and resume are one command.

The spawn detaches the coordinator from the terminal: a new session and process group, its
stdout and stderr to a file in the control folder, and the parent returns at once. The launcher
records the child's process number and launch time, registers the run in the index (§2.8), and
starts keep-awake (§2.9). Reason: a detached, session-leading child is not sent the hang-up
signal when its terminal closes, which is what lets a run outlive WezTerm (verified, FINDINGS).

### 2.6 Stop — immediate

Stopping a run ends it now. It does not wait for the current unit of work to reach a safe point.
The coordinator is signalled to stop; on that signal it closes its in-flight workers, records a
`stopped` final status, releases keep-awake, and exits, leaving the task worktrees in place. The
next `pir {slug}` reconciles them from git. Reason (user decision, §7): the user chose immediate
over graceful; in-flight work is cheap to redo and a fast, predictable stop is worth more than
salvaging a half-built task.

Workers are not children of the coordinator — they are `claude --bg` sessions owned by Claude
Code's background service and tracked by name (docs/branch-model, `src/shell/platform.mjs`). So
stopping cannot be "kill one process": the coordinator, which knows its workers, closes them as
part of its stop. If the coordinator does not exit within a short grace period, the front-end
escalates — force-kills the process and closes the run's workers itself by the same
name-matching the coordinator uses. Reason: a wedged coordinator must not be able to strand a
run half-stopped with its workers still burning tokens.

Worktrees are left rather than removed on stop. Reason: the next start reconciles from the git
branches, which are the durable state, and removing worktrees is teardown work that an immediate
stop should not wait on; a leftover worktree is reused or rebuilt on resume (docs/restart-recovery).

### 2.7 Remove

A finished, stopped or crashed run's record is cleared from the dashboard with a remove action.
A running run cannot be removed; it must be stopped first. Removing clears the index entry and
the run's status snapshot; the plan files under `plans/{slug}/` are untouched. Reason: the record
is process bookkeeping, not the plan, so clearing it must never touch the work.

Stop and remove are chorded and double-confirmed, matching `claude agents`: Ctrl+S twice to
stop, Ctrl+X twice to remove. The first press arms a confirmation line; the second within the
same selection carries it out; any other key cancels. Reason: both are destructive and
irreversible in the moment (stop kills in-flight work, remove drops the record), and the user
asked for the same guard `claude agents` uses so the muscle memory carries over.

### 2.8 The index — cross-repo visibility

The authoritative state of a run lives in its repo's control folder (§3.5). A small per-run
entry under `~/.pir/runs/` indexes every run on the machine so `pir` from any directory can list
runs across every repo. The entry is a pointer plus what is needed to classify the run without
opening the repo: the slug, the repo and its path, the control-folder path, the process number
and launch time, and the final status once set. `pir` reads the index to enumerate, then reads
each run's snapshot for live detail. Reason (user decision, §7): the user wanted to see runs from
anywhere on the machine, which a repo-local list cannot give; keeping the heavy state repo-local
and only a pointer global keeps one owner per fact.

One entry per run per repo, so the same slug in two different repos is two runs and never
collides. A stale entry whose repo has moved or been deleted is shown as unreachable and is
removable, never a crash of `pir`.

### 2.9 Naming and keep-awake

The command is `pir`, launched by `bin/pir` (a logic-free wrapper that execs
`node src/shell/pir.mjs "$@"`, like `bin/pir-coordinate`). Task-doc slugs follow the house rule:
the kebab name in `PROGRESS.md` matches the `tasks/T{nn}-{slug}.md` filename.

A run holds the Mac awake while it works (user decision, §7). Keep-awake is `caffeinate -i -w
{pid}` started by the launcher against the coordinator's process number: `-i` blocks idle sleep,
`-w` makes caffeinate wait on that process and exit when it dies. Reason: tying the awake-hold to
the coordinator's lifetime with `-w` means any death of the run — clean exit, stop, crash or
force-kill — releases the Mac, so no code path can strand it awake. The hold is unconditional,
not battery-aware.

### 2.10 The unhappy paths

- **Crash mid-write of the snapshot.** The snapshot is written temp-then-rename, so a reader
  never sees a half-written file; a crash leaves the last complete snapshot, which the dashboard
  shows marked stale once the process reads as gone. Reason: an atomic rename is the cheapest way
  to make a single-writer file safe for a concurrent reader.
- **A malformed or partial index entry.** Parsing an entry that fails validation drops that one
  entry and lists the rest; it never crashes `pir`. Reason: one corrupt pointer must not blind
  the dashboard to every other run.
- **The machine reboots.** Every recorded process is gone after a reboot, so every previously
  running run classifies as crashed (its launch time cannot match a process that no longer
  exists). Reason: this is correct — a reboot does end a run — and it needs no special handling.
- **`pir {slug}` for a slug already running.** Opens the live view, starts nothing (§2.5).
- **Two `pir {slug}` launched in the same instant.** The already-running check (§2.5) catches the
  normal case, but two starts fired within the same moment can both read "no live run" and both
  spawn a coordinator on the one plan. This is accepted, not locked out (user decision, §7): it is a
  human-paced tool, and the coordinator's own feature-branch and worktree guards make the second
  coordinator fail loudly on the branch it cannot cut cleanly rather than silently corrupt the run.
  The recovery is the ordinary one — stop the misbehaving run from the dashboard and re-start the
  slug. Reason: an on-disk start-lock is more machinery (and its own stale-lock cleanup) than a
  split-second double-launch on a single-user tool is worth.
- **`pir {slug}` for an unreviewed plan.** Refused at pre-flight, nothing spawned (§2.5).
- **Two dashboards open at once.** Both are readers of the same files; either can stop or remove
  a run, and the other repaints from the changed state on its next read. Reason: the dashboard
  holds no authority a second copy could contend for.
- **The Mac sleeps despite keep-awake** (lid closed on battery can still sleep). The run pauses
  and resumes on wake; the snapshot is simply stale meanwhile, which the dashboard already
  handles. Reason: keep-awake blocks idle sleep, not a forced sleep, and a paused run is not a
  broken one.

### 2.11 Appearance and key bindings (binding)

The prototype's semantic colours and interaction model are binding on the front-end (user
decision, §7): the T12 session implements them, it does not redesign them. What is not binding is
exact terminal spacing and column widths, which a real terminal sets, not a browser mock.

Colour carries state, and semantic colour is separate from any accent:

- **List:** running green, finished dim, stopped dim, crashed red. The progress bar is blue for a
  running run, red for a crashed one, dim otherwise. The selected row is highlighted with a blue
  left edge. The counts line colours the running count green and the crashed count red. The
  key-hint footer is faint; an armed stop/remove confirmation is amber and bold.
- **Live view:** the colours are the coordinator's existing renderer (`src/shell/render.mjs`)
  unchanged — active phases (building/reviewing/merging) cyan, done green, a parked "asking you"
  worker amber and bold, idle (waiting/queued) dim, a failed or interrupted run red, the summary
  line neutral. The view reuses that renderer, so this is consistency, not a second palette.
- **Colour is never the only signal:** the glyphs (`render.mjs` owns them — the braille spinner for
  active, ✔ done, ● asking, · idle) carry the same state, so a `NO_COLOR` terminal or a
  colour-blind reader loses nothing.

Behaviour is binding as specified in §2.1–2.7: start-or-open on `pir {slug}`, the cross-repo list,
opening a run into the live block, Esc to step back then quit, finished and crashed runs openable,
and the double-confirm Ctrl+S (stop) / Ctrl+X (remove) chords with a first-press armed line. Reason
this is pinned rather than left to the builder: the user owns what the product looks like and does,
played the mock until it was right, and wants that settled shape built, not reinterpreted — the
usual fresh-eyes pass on the UI is deliberately traded away here at the user's direction.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/     takes inputs as parameters, returns decisions. No clock, no fs, no process.
src/shell/    everything platform-shaped: spawn, signals, ps/kill, fs, raw-mode TUI, caffeinate.
```

The classification of a run, the shape of the index entry and the snapshot, the dashboard's list
model and its keyboard reducer are all pure and live in `src/core/`. Detached spawn, process
liveness by `ps`/`kill`, the index and snapshot file stores, keep-awake, and the raw-mode
terminal painting are `src/shell/`. The existing boundary test (`src/core/boundary.test.mjs`)
scans the pure side for forbidden imports; a new core module is covered automatically. If it
fails, the fix is to move the code, never to relax the test — because everything on the pure side
is tested exhaustively in milliseconds, and every rule that leaks across becomes a rule only a
person can check.

### 3.2 Modules

Pure (`src/core/`):
- `runstate.mjs` — `classifyRun` (§3.3); the four-state decision.
- `runrecord.mjs` — parse/serialize/validate an index entry.
- `snapshot.mjs` — parse/serialize/validate a status snapshot (process facts + a pass's run state).
- `dashboard.mjs` — `buildDashboard` (rows + counts) and `dashboardReducer` (list/watch nav,
  Esc semantics, the two-press stop/remove confirm) as pure logic over key events.
- Reuses `display.mjs` (`buildDisplay`) for the live view and `progress.mjs` (`parseProgress`)
  for the review gate.

Shell (`src/shell/`):
- `identity.mjs` — process liveness and launch time (`kill(pid,0)`, `ps -p pid -o lstart=`).
- `index-store.mjs` — list/write/remove entries under `~/.pir/runs/`, writes atomic.
- `snapshot-store.mjs` — atomic write and read of `status.json` in a control folder.
- `launch.mjs` — pre-flight, detached spawn of `coordinate.mjs`, register, keep-awake.
- `control-run.mjs` — stop (signal, wait, escalate, reap) and remove.
- `pir.mjs` — argv dispatch and the raw-mode TUI loop; reuses `render.mjs` to paint the live view.
- `coordinate.mjs` (extended, T10) — writes the snapshot each pass, records final status on every
  exit, and handles the stop signal.

### 3.3 The decision function

`classifyRun` is where the whole run-state vocabulary comes together, and it is a function of its
arguments and nothing else:

```
classifyRun({ recordedStartTime, finalState, alive, liveStartTime }) →
  'running' | 'finished' | 'stopped' | 'crashed'

  finalState === 'finished' | 'stopped'        → finalState        (a clean record wins)
  !alive                                        → 'crashed'
  liveStartTime !== recordedStartTime           → 'crashed'         (process number reused)
  otherwise                                     → 'running'
```

`alive` and `liveStartTime` are supplied by the shell (`identity.mjs`); the function reads no
clock and no process. Reason: this keeps the reused-number rule — the one subtle thing in the
whole design — testable exhaustively without a live process.

### 3.4 Data flow

`pir {slug}`: pre-flight (read plan + index) → spawn `coordinate.mjs` detached → write index
entry → start `caffeinate -w {pid}` → enter the TUI on that run.

The coordinator, each pass: build the run state it already builds for the live display → write it
plus process facts to `status.json` (atomic). On exit: write the final status into `status.json`
and the index entry.

`pir` dashboard: read all index entries → for each, `identity` for liveness → `classifyRun` →
read each snapshot for progress and workers → `buildDashboard` → paint. Opening a run reads its
snapshot and paints with `buildDisplay`, re-reading as it changes. Stop signals the coordinator;
remove deletes the entry and snapshot.

### 3.5 Storage

- **Status snapshot:** `plans/{slug}/.parallel/control/status.json`, in the existing control
  folder, already gitignored via `plans/*/.parallel/` (docs/control-folder). One writer (the
  coordinator), written temp-then-rename each pass; readers get a whole file or the previous one.
  It carries a schema version, the process facts, an optional final status, and the run state a
  pass produced (branch, ceiling, flags, tasks with their phase and `since`), so the reader paints
  it with `buildDisplay` and its own clock.
- **Index entry:** `~/.pir/runs/{repo}__{slug}.json`, one small JSON file per run, written
  temp-then-rename. `~/.pir/` is outside any repo and is never committed. Removing a run deletes
  its file.
- **Detached run marker:** the launcher sets `PIR_RUN=1` (alongside `PARALLEL_LIVE=1`) in the
  coordinator's environment; the coordinator writes snapshots, records final status, and uses the
  stop semantics only when `PIR_RUN` is set, so a foreground `pir-coordinate` behaves exactly as
  today. Reason: one env flag keeps the new self-reporting entirely out of the classic path.

---

## 4. Testing

Three layers. The pure core (`runstate`, `runrecord`, `snapshot`, `dashboard`) is tested
exhaustively with `node --test`: every branch of `classifyRun`, malformed entries and snapshots,
the reducer's two-press confirm and its cancel-on-other-key, stop-only-on-running,
remove-only-on-non-running. The shell modules are tested with the process and filesystem calls
injected (a fake `exec`, `spawn`, and `fs`): pre-flight refusals, atomic write and read, stale
and malformed files, the escalation path of stop. What none of them can prove is that a run
survives a real terminal restart and that the live TUI reads right to a person watching it — those
are hand-verified with the user (§5.1, T08 and T12).

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0). Primary and only target this plan builds for. |
| Language / runtime | Node v24.2.0 (`/opt/homebrew/bin/node`), ES modules. |
| Toolchain | `claude` CLI (`~/.local/bin/claude`), `caffeinate` (`/usr/bin/caffeinate`), `ps`, `kill`. All present (FINDINGS). |
| **Deliberately absent** | No systemd, `/proc`, pidfd or cgroups — this is not Linux, so run identity uses `ps -o lstart` and `kill(pid,0)`, not `/proc`. No launchd job — the design is daemonless (§8). |

**The test command.**

```
npm test
```

Which is `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`. It is the
only evidence a session may produce on its own. It is already quiet (the `dot` reporter, one line
per file on green), colour-free (`FORCE_COLOR=0 NO_COLOR=1` baked in), and loud on failure (Node's
runner prints the failing assertion, file and line). To debug a failure verbosely, run the one
file with `--test-reporter=spec`.

**Dependencies.** No new runtime dependencies. The platform pieces use Node built-ins
(`child_process`, `fs`, `os`, `process`) and the system `ps`/`kill`/`caffeinate`. Reason: the repo
has a pure-core/thin-shell design with no runtime deps, and a detached-launch feature needs
nothing a built-in does not provide.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A run survives closing/restarting WezTerm and my-agentic-ide | Only a person can close the terminal and confirm the run kept going (T08). |
| The live dashboard reads right — the list, opening a run, the ticking display, Esc navigation, the confirm chords | In-place terminal painting and feel can only be judged by a person watching a real terminal (T12). |
| Keep-awake actually holds the Mac and releases on exit | Whether the display slept is a physical observation over time (T08). |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_LIVE` | unset | The coordinator spawns nothing without it (existing). `pir start` sets it; a dry pre-flight can be exercised without it. |
| `PARALLEL_ALLOW_HERE` | unset | A live run refuses to open the feature branch inside the canonical checkout without it (existing). `pir` inherits this guard. |
| `caffeinate -w {pid}` | tied to the run | Keep-awake self-releases when the run's process dies, so no path strands the Mac awake. |
| Stop grace + escalation | short timeout | Stop signals first and force-kills only after a grace period, then reaps workers, so a stop cannot half-finish. |

Never ask the user to run an unbounded run to find something out, and never force-kill a run to
save them the trouble — the grace period is what separates a stop from a crash.

---

## 6. Recovery

A run is recovered by re-running its slug: `pir {slug}` on a crashed or stopped run resumes from
committed work (docs/restart-recovery — git is ground truth; the coordinator reconciles). Nothing
in this plan is irreversible. Removing a run's record (§2.7) deletes only bookkeeping; the plan
and its git branches are untouched, so a removed run is re-listed the moment it is started again.
The one thing that changes the world outside the code is stopping a run, and its way back is the
same resume: `pir {slug}`.

By-hand recovery, if `pir` itself is unavailable, is unchanged from docs/restart-recovery:
`claude agents --json` for worker pids, `kill`, `claude rm`, `git worktree remove --force`,
`git branch -D`, and `touch plans/{slug}/.parallel/control/HALT` to halt.

---

## 7. Decisions and rationale

- **Prototype approved 2026-09-22, and made binding for colours and behaviour (user).** The `pir`
  dashboard direction was confirmed against `prototype/index.html`: `pir {slug}` starts and drops
  into the live view, `pir` opens a cross-repo list, a run opens into the live task block, Esc steps
  back then quits, stop/remove are double-confirmed chords, no process-number column. The user then
  asked that the prototype's semantic colours and interaction model bind the build rather than serve
  as a loose reference (§2.11); the T12 session follows them and does not redesign the look or the
  keys. Exact terminal spacing stays the builder's. This trades away the method's default fresh-eyes
  pass on the UI, at the user's direction, because the user owns what the product looks like and has
  already settled it.
- **Cross-repo index over repo-local (user).** The user chose to see runs from anywhere on the
  machine, so a `~/.pir/` pointer indexes runs across repos while the heavy state stays repo-local.
  Alternative (repo-local only) was simpler but could not list another repo's runs.
- **Immediate stop over graceful (user).** Cut in-flight workers now and leave worktrees for the
  next start to reconcile. Alternative (finish or park the current unit) was rejected: in-flight
  work is cheap to redo and a fast, predictable stop is worth more.
- **One record per slug (user).** The dashboard shows the current or last state per slug; starting
  again replaces it; remove clears a finished one. Alternative (keep timestamped past attempts) was
  more to store with no asked-for use.
- **Keep the Mac awake while running (user).** Unconditional `caffeinate -i -w {pid}`; released on
  any death via `-w`. Alternatives (let it sleep; awake only on AC) were rejected for unattended
  long runs.
- **A run that dies badly shows crashed, not finished (user, plan-review 2026-09-22).** Only a
  clean end records a `finished` status (green hand-off, red branch, nothing-left-to-do); an uncaught
  error, the runaway breaker, the safety-cap and the by-hand HALT record no final status, so they
  classify crashed (red) like a true crash (§2.2, T10). Alternative (file every self-exit as
  `finished`) was rejected: an errored or runaway run would look identical to a clean success.
- **The empty dashboard shows a get-started line (user, plan-review 2026-09-22).** With no runs,
  "No runs yet — start one with `pir {slug}`" rather than a blank list (§2.3). Alternative (a bare
  empty list) reads as broken on a first open.
- **A split-second double-launch is accepted, not locked (user, plan-review 2026-09-22).** The
  already-running check covers the normal case; a simultaneous double-start is left to fail loudly on
  the coordinator's branch guards rather than defended with a start-lock (§2.10). Alternative (an
  on-disk lock) was rejected as more machinery than the race is worth on a single-user tool.
- **`pir` alongside `pir-coordinate`, not replacing it.** `pir` is a front-end that spawns the
  existing engine detached; the engine stays a runnable foreground program. Keeps the run's logic
  untouched by this plan and keeps a run debuggable in the foreground.
- **Machine-readable JSON event log deferred (user).** This plan builds the live snapshot the
  dashboard repaints and keeps the coordinator's existing plain-text action log; the structured
  JSON feed for my-agentic-ide waits for a later plan, designed against a real consumer.
- **Detached-spawn mechanism verified, not spiked.** `spawn(detached, stdio→file)` + `unref` was
  proven on this machine to outlive its parent (reparented to launchd, kept running); process
  identity by `ps -o lstart` was confirmed (FINDINGS). So no throwaway spike; the launcher (T08) is
  a real task with a hand-verified survival check.

---

## 8. Explicitly out of scope

- **A long-running background service, restart-on-crash, launchd integration.** The design is
  daemonless: nobody watches a run but the run itself and the files it writes. Reason: a supervising
  daemon is a much larger thing than the user asked for, and the file-based snapshot already gives
  the dashboard everything it needs to read; restart is a person re-running the slug.
- **Remote or multi-machine runs.** The index is one machine's runs. Reason: the problem is a run
  outliving one terminal on one Mac, not coordinating across machines.
- **Any change to how the coordinator schedules or relays work.** This plan is the run's lifecycle,
  not its logic. Reason: the scheduling is settled in earlier plans and `/docs`; reopening it here
  would risk the thing that already works to serve a feature about starting and watching it.
- **The machine-readable JSON event log.** Deferred to a later plan (§7).
