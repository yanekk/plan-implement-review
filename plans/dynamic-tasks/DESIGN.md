# dynamic-tasks — Design

> Written by `/pir-plan`. Read by every session that touches worker-introduced tasks or the
> merge path. Flat prose; every rule carries its reason.
>
> This plan changes how parallel mode behaves, so the canonical account of the new behaviour
> lands in `/docs`, not here (CLAUDE.md). This `DESIGN.md` is the build-time rationale: why the
> mechanism is shaped the way it is, and what was decided and rejected.

## 1. Purpose

A parallel run today builds a fixed task set: the coordinator dispatches from the task table in
`plans/{slug}/PROGRESS.md` on the feature branch, and that table only ever changes when a person
stops the run, edits it by hand, and re-runs (non-agentic-coordinator DESIGN §2.8). But a worker
building one task sometimes discovers that another task is needed — work the plan should have
had. This plan lets that discovery become a real task without stopping the run: the worker asks
the person, and once the person approves, the coordinator picks the new task up and dispatches it
by its dependencies exactly like a task that was in the plan from the start.

### Success criteria

- A worker that adds a task to `PLAN.md`, `PROGRESS.md` and `tasks/` on its own task branch has
  that task appear on the feature branch's task table when its branch merges, and dispatched on a
  later pass once the new task's dependencies are all `✅`.
- Scenario 1: T01 (depends on T00) introduces T03 (depends on T01). T03 is dispatched after T01 is
  reviewed and merged.
- Scenario 2: T00 introduces T03 (depends on T00 only). When T00 merges, T01, T02 and T03 all
  become dispatchable and start together, up to the ceiling.
- A worker can only **add** tasks. An attempt to edit, re-scope or re-depend an existing task is
  rejected at merge and surfaced, never silently applied.
- A malformed addition (a dependency on a task that does not exist, a duplicate task number) is
  surfaced to the person, never silently dropped and never silently landed.

### Stance

The person owns what gets built. A worker never changes the plan on its own; it proposes, the
person approves in the worker's own session, and only then does the worker write the task down.
This is the whole method's rule (`CLAUDE.md § Who decides what`) held intact under parallelism,
not relaxed for it. The coordinator's job is mechanical: adopt what an approved, reviewed branch
carries, and refuse anything that is not a clean addition.

---

## 2. Behaviour specification

### 2.1 The model

The lifecycle of a worker-introduced task, end to end:

1. A worker building task T{x} decides a new task is needed.
2. It escalates like any other decision (pir-worker contract): it drops a `decision` report into
   the control folder and asks the person **in its own session**, then waits. Nothing is routed;
   the person answers that worker directly (non-agentic DESIGN §2.2).
3. On approval, the worker writes the new task **on its own task branch**: a `⬜` row in
   `PROGRESS.md`, a row in `PLAN.md`'s task table, and a full `tasks/T{nn}-{slug}.md` doc. It logs
   the addition in `FINDINGS.md`. Then it finishes T{x} normally.
4. T{x} is reviewed and merged like any task. **At the merge**, the coordinator adopts the new
   task's row into the feature branch's `PROGRESS.md` (§2.2). `PLAN.md`, `FINDINGS.md` and the new
   task doc merge through git as ordinary files — only `PROGRESS.md` is fold-protected, so two
   additions landing close together can conflict on `PLAN.md` or `FINDINGS.md` and park the
   introducing worker on the existing conflict path (§2.5, known limitation §8).
5. On a later pass the coordinator re-parses `PROGRESS.md` (it already does this every pass), sees
   the new task, and dispatches it once its dependencies are `✅` — with no change to the dispatch
   logic (§3.3).

The reason approval is in-session and not a coordinator step: the coordinator is a plain process
with no channel to the person and no way to ask (non-agentic DESIGN §2.2). The person is already
the one who answers a parked worker, so a plan change is answered the same way, through machinery
that already exists.

### 2.2 What counts as a new task, and how add-only is enforced

The coordinator is the single writer of `PROGRESS.md` on the feature branch: at merge, a task
branch's whole `PROGRESS.md` is normally discarded and the feature's kept, so many branches fold
into one file without colliding on its cross-cutting single-line fields (branch-model.md,
task-state.md). This plan refines that one step. Instead of discarding the branch's `PROGRESS.md`
wholesale, the merge keeps the feature's version of everything that already exists and **adopts
only genuinely new task rows** from the branch.

The rule, per task row on the merging branch (`adoptNewTaskRows`, §3.3):

- **Id not on the feature branch** — a new task. It is adopted: appended to the feature table with
  its state forced to `⬜` (the coordinator owns state; a worker must not land a task pre-marked
  built or done), keeping its slug and its `Depends on`. Its dependencies must every one name a
  task that already exists (on the feature branch or among the same change's other new rows); a
  dependency on an unknown task is an error (§2.5), because such a task could never be dispatched —
  its dependency would never go `✅`.
- **Id on the feature branch, slug and dependencies identical** — the ordinary pre-existing row
  (including the merging task's own row, whose only difference is its glyph, which is compared out).
  It is ignored; the feature's version stands.
- **Id on the feature branch, slug or dependencies differ** — a forbidden edit of an existing
  task, or a duplicate number colliding with one. It is an error (§2.5). This is where add-only is
  enforced at the machine boundary: a worker cannot reshape an existing task even by accident,
  because the coordinator refuses any branch row that changes an existing task's identity.

State is never compared, so a worker advancing its own row's glyph is not mistaken for an edit.

### 2.3 When a new task becomes visible

A new task becomes visible to the coordinator at the moment the task that introduced it **merges**,
because that is when the branch carrying the new row and the new task doc reaches the feature
branch. Not the instant the worker decides it, and not the instant the person approves it — the
definition rides on the branch and lands atomically with the rest of the branch's reviewed work.

This is the right moment, not a limitation to work around, for both scenarios:

- Scenario 1 (T03 depends on T01, the task that introduced it): T03 could not start before T01 was
  done regardless, so merge-time visibility costs nothing.
- Scenario 2 (T03 depends on T00, the task that introduced it): T03 appears exactly when T00
  merges, which is the same pass on which T01 and T02 have their dependency satisfied, so the three
  start together.

The general shape: a task introduced by T{x} is dispatched no earlier than T{x}'s merge, and then
as soon as its own declared dependencies are `✅`. A new task whose declared dependencies were
already satisfied before T{x} merged still waits for T{x}'s merge to be discovered — acceptable,
because the coordinator cannot dispatch from a definition it has not yet seen.

### 2.4 Approval

A worker proposes a new task through the existing escalation path (pir-worker contract, non-agentic
DESIGN §2.2): a `decision` report drop plus asking the person in-session, then waiting. The report
kind is the existing `decision`; no new report kind is introduced, because the coordinator does not
act on the proposal — it acts on what the reviewed branch carries at merge. The person's approval
lives in the worker's session, and its durable trace is the committed addition on the branch and
the `FINDINGS.md` line the worker writes.

A worker-introduced task does not go through `/pir-review-plan`; the person's in-session approval is
its gate, and the fresh reviewer of the introducing task validates the addition in the diff (deps
name existing tasks, the doc has all five parts, the slug matches the filename and the row). That
is a lighter check than a full plan review, which is the deliberate trade for not stopping the run.

### 2.5 The unhappy paths

- **A dependency on a task that does not exist.** The new task could never be dispatched. The
  adoption rejects the whole change (adopt nothing) and returns an error naming the bad dependency;
  the loop surfaces it as a `bad-plan-change` and the merge otherwise lands (the introducing task's
  reviewed code is good). The person adds the task properly by hand if they still want it.
- **A duplicate task number.** Two workers each proposed a task and picked the same next-free
  number, or a worker reused an existing number. The second one to merge sees its number already on
  the feature branch with a different slug or deps, which is an error (§2.2). It is surfaced, not
  auto-renumbered — renumbering would have to rewrite the task-doc filename, the branch name and
  every dependency that references it, which is more likely to corrupt than to fix. The person
  renumbers and re-adds.
- **A forbidden edit.** A worker changed an existing task's slug or dependencies. Rejected and
  surfaced by the same rule as a collision (§2.2). The run continues; the edit does not land.
- **The introducing task is rebuilt.** If T{x} fails and its branch is discarded and rebuilt from
  scratch (the reconcile `rebuild` path), any task it had proposed but not yet merged is discarded
  with it — it never reached the feature branch. The rebuilt T{x} would have to propose it again.
  This is correct: a task whose author never landed does not exist. Recorded so nobody treats a
  vanished proposal as a bug.
- **Restart mid-flight.** The new task's definition is committed on the introducing task's branch,
  so git is the ground truth. If the coordinator restarts before the introducing task merged,
  reconciliation adopts the branch (merge if `✅`, review if `🔍`, rebuild if half-built) through the
  same `mergeTask`, so the new task lands on merge exactly as in a live run. No separate
  restart handling is needed; adoption lives in `mergeTask`, which both the live path and the
  reconcile path call.
- **Adoption is atomic per branch.** If any row in a branch's change is an error, nothing from that
  branch is adopted (§3.3), so a bad change never half-lands. All the errors are surfaced together.
- **Two additions collide on `PLAN.md` or `FINDINGS.md`.** `PROGRESS.md` is fold-protected (§2.2), but
  the addition also writes `PLAN.md` and `FINDINGS.md`, which merge through git. If two workers add a
  task close together (or one adds a task while another appends a finding), git cannot combine the two
  edits to the same file and the merge conflicts. This is not special-cased: it takes the existing
  merge-conflict path — the introducing worker is parked with `buildConflictPrompt`, the person fills
  the `KEEP:` blank to order the two additions, the worker re-signals done and the run merges it next
  pass (§6). Nothing is lost or corrupted; the run pauses one worker, not the whole run. This is a
  known limitation, accepted rather than engineered away (§7, §8): the two scenarios above each add a
  single task and never hit it, and the conflict path already exists and is safe.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/progress.mjs   adoptNewTaskRows — pure text → { text, added, errors }. No I/O, no clock.
src/core/dispatch.mjs   decideDispatch — UNCHANGED. Already a pure function of the parsed table.
src/shell/worktree.mjs        mergeTask — reads the branch's PROGRESS.md, calls adoptNewTaskRows,
src/shell/fake/worktree.mjs   writes the result. git and fs live here.
src/shell/loop.mjs      surfaces adoption errors, narrates adopted tasks. fs lives here.
```

`boundary.test.mjs` guards `src/core/` against platform imports; `adoptNewTaskRows` is pure text
work and belongs there. If that test fails on this code the fix is to move the code, never to relax
the test.

The load-bearing fact: **the dispatch logic does not change.** `decideDispatch` is already a pure
function of the parsed task table (dispatch.mjs), and the loop already re-reads and re-parses
`PROGRESS.md` every pass (loop.mjs). A larger table on a later pass is dispatched with no new code.
The entire feature is getting the new row onto the feature branch's `PROGRESS.md` at the one safe
moment, which is a change to the merge, not to the brain.

### 3.2 Modules

- `progress.mjs` — gains `adoptNewTaskRows(featureText, branchText)`. Owns the rule for what is a
  new task and what is a forbidden edit. Depends on the existing `parseProgress`.
- `worktree.mjs` / `fake/worktree.mjs` — `mergeTask` calls `adoptNewTaskRows` in place of the
  verbatim restore, and returns `{ ok, added, errors }`. The fake is a real scratch git repo, so
  the behaviour is proven for real, not mocked.
- `loop.mjs` — reads `added`/`errors` from `mergeTask` at both merge sites (live merge in `runPass`
  3d, restart merge in `reconcile`), records an `adopt` action per adopted task and surfaces a
  `bad-plan-change` per error. Dispatch of the adopted tasks happens on the next pass through the
  unchanged path.

### 3.3 The decision function

```
adoptNewTaskRows(featureText, branchText) → { text, added, errors }

  featureText  the feature branch's PROGRESS.md — the authoritative, protected copy
  branchText   the merging task branch's PROGRESS.md, read committed from the branch

  text     featureText with every new task row appended to the table as ⬜; byte-identical to
           featureText when there is nothing to adopt, and when there is any error (atomic)
  added    the task numbers adopted, in table order, e.g. ['T03']  (empty when errors is non-empty)
  errors   human-readable strings for: a branch row that edits an existing task's slug or deps,
           a new row whose deps name a task that does not exist, a malformed new row, or a
           duplicate number. Never empty-and-silent: a rejected change always names why.
```

A function of its two text arguments and nothing else. It forces every adopted row to `⬜`,
compares slug and deps (never state) to tell a new task from a pre-existing one, validates
dependencies against the tasks that exist, and preserves the feature table's column layout so
`reconcileTaskRow` can still find and fold rows afterward.

### 3.4 Data flow

Per pass, unchanged except at merge:

```
drain reports  →  parse feature PROGRESS.md  →  decideDispatch  →  execute
                                                                     ├─ spawn ready tasks
                                                                     ├─ hand off review
                                                                     └─ merge one done branch:
                                                                          mergeTask → adoptNewTaskRows
                                                                          → feature PROGRESS.md gains new rows
                                                                          → reconcile the merged task's row → ✅
next pass: parse feature PROGRESS.md (now larger) → decideDispatch spawns the adopted task when ready
```

### 3.5 Storage

The new task's definition is three committed files on the introducing task's branch: its
`PROGRESS.md` row, its `PLAN.md` row, and its `tasks/T{nn}-{slug}.md` doc. They land together when
the branch merges. Nothing transient holds a proposed task; a crash before merge loses only what
was never landed, and git is the single source of truth for what exists (branch-model.md).

---

## 4. Testing

- **Pure core** (`progress.test.mjs`): `adoptNewTaskRows` exhaustively — a new row adopted as `⬜`;
  existing rows and single-line fields untouched; a pre-existing row ignored; a row whose branch
  glyph is `✅`/`🔍` still adopted as `⬜`; a dep on an unknown task rejected; a slug/dep edit of an
  existing task rejected; a duplicate number rejected; multiple new rows in one change; atomic
  rejection (one bad row adopts none); column layout preserved so `reconcileTaskRow` still works.
- **Merge** (`worktree.test.mjs`, real and fake over a scratch repo): merging a branch that added a
  row lands the row on the feature branch as `⬜`; the single-line fields keep the feature's
  version; a branch with a forbidden edit lands the code but adopts nothing and returns the error.
- **Loop** (`loop.test.mjs`, fake platform + scratch git): scenario 1 and scenario 2 end to end —
  the fake worker commits a new row on its branch, and the drive dispatches the adopted task at the
  right pass; a bad-plan-change is surfaced and the run continues.
- **What no automated layer proves**: that a real worker, on hitting a genuine need, escalates
  correctly and — after the person approves — writes a well-formed addition. That is a person's
  judgement of a real worker's behaviour, verified in the live drill (T05, §5.1).

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (darwin) |
| Language / runtime | Node.js v24 (`node --test`) |
| Toolchain | git; no external test framework — the Node built-in test runner |
| **Deliberately absent** | no bundler, no TypeScript, no third-party test/assertion library — plain `.mjs` and `node --test` |

**The test command.**

```
npm test        # FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'
```

The only evidence a session may produce on its own. It is quiet (dot reporter, one dot per test,
a summary on green), colour is forced off inside the command (the shell here sets `FORCE_COLOR=3`,
which the command overrides), and a failure prints in full with a non-zero exit. To see detail
while debugging, drop `--test-reporter=dot`.

**Dependencies.** None added. This plan is pure `.mjs` over the existing modules.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real worker proposing a task, the person approving in-session, and the coordinator adopting and dispatching it | Only a person can judge whether a real worker escalates on the right trigger, writes a well-formed addition after approval, and whether the live run behaves; the automated layers prove the merge and dispatch mechanics, not a real agent's judgement |

### 5.2 Seatbelts

This plan adds no new dangerous capability; it inherits the parallel-run seatbelts unchanged.

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_LIVE` | unset (dry run) | without it the coordinator confirms the gate and prints what it would do, spawning no worker and touching no branch |
| `PARALLEL_ALLOW_HERE` | unset | a live run refuses to run inside the canonical checkout unless set, so it cannot mangle the real repo's branches |
| `HALT` flag file | absent | present, it closes every worker and merges nothing |
| ceiling / wall-clock timeout | low in the harness | a live scenario spawns real paid agents; the ceiling is the smallest the scenario needs and a timeout auto-touches `HALT` |

The live drill (T05) runs under these; never run a live worker unbounded to find something out.

---

## 6. Recovery

Nothing here is irreversible. A wrongly-adopted or malformed task is a row and a doc on the feature
branch: the person stops the run, edits `PROGRESS.md`/`PLAN.md`/`tasks/` by hand, and re-runs — the
existing mid-run plan-change path (non-agentic DESIGN §2.8), which this plan makes the exception
rather than the only route. `main` is never touched by the run.

---

## 7. Decisions and rationale

- **Merge-adoption over a report channel** (2026-09-21). The alternative was a new `new-task`
  report the worker drops and the coordinator acts on immediately. Rejected: the new task's doc
  must reach the feature branch to be buildable, and that only happens at merge, so a report would
  declare a task before its doc existed; and a report is transient (the control folder is cleared
  on restart), while a branch commit is durable and reconciles for free. Adopting at merge keeps
  git the single source of truth and reuses the reconcile path, so restart needs no special case.
- **Add-only** (user decision, 2026-09-21). A worker may only add tasks, never edit, split,
  re-order or re-depend an existing one. Editing a task another worker may be building right now is
  the dangerous case; adding is safe. Enforced at the machine boundary by rejecting any branch row
  that changes an existing task's slug or deps (§2.2).
- **Approval first, in-session** (user decision, 2026-09-21). The worker asks the person and waits
  before adding; the coordinator never approves. Keeps "the person decides what gets built" intact
  and reuses the existing escalation, at the cost of a run pausing while the person is away.
- **Adopted rows forced to `⬜`** — the coordinator owns task state; a worker must not land a task
  pre-marked built or done, which would skip its build.
- **Atomic per branch** — any error adopts nothing from that branch, so a bad change never
  half-lands and the person sees the whole problem at once.
- **Collisions surfaced, not auto-renumbered** — renumbering rewrites a filename, a branch name and
  every referencing dependency, more likely to corrupt than fix; the person renumbers.
- **The reviewer validates the addition** — the fresh reviewer of the introducing task already sees
  the new doc and rows in the diff, giving a worker-introduced task a fresh-eyes check without a
  full plan review.
- **`PLAN.md`/`FINDINGS.md` conflicts on concurrent additions are accepted, not prevented** (user
  decision, 2026-09-21, at plan review). Only `PROGRESS.md` is fold-protected; the addition also
  writes `PLAN.md` and `FINDINGS.md`, so two additions close together can conflict there and park one
  worker on the existing conflict path (§2.5). The alternatives — fold-protecting those two files the
  way `PROGRESS.md` is (their richer structure makes that one or two extra tasks), or having the worker
  write only the two files dispatch needs and leaving `PLAN.md`/`FINDINGS.md` out of sync until a
  person catches up — were both weighed and declined: the two target scenarios add a single task and
  never hit it, the pause is safe and reuses machinery that already exists, and the collision is rare.

---

## 8. Explicitly out of scope

- **Mid-task visibility.** A new task appears at the introducing task's merge, not the instant it is
  proposed. Making a proposed-but-unbuilt task visible earlier would need a second writer of the
  feature `PROGRESS.md` racing the coordinator, which the single-writer rule exists to prevent, and
  it buys nothing for the two scenarios (§2.3).
- **Editing, splitting, re-ordering or re-depending existing tasks.** Add-only (user decision). A
  future plan can revisit this; it needs a way to keep an in-flight worker from being reshaped
  under it, which this plan deliberately does not build.
- **Auto-renumbering a colliding task.** Surfaced to the person instead (§2.5, §7).
- **Fold-protecting `PLAN.md` and `FINDINGS.md` against concurrent-addition conflicts.** Only
  `PROGRESS.md` is fold-protected; a concurrent addition that conflicts on `PLAN.md` or `FINDINGS.md`
  takes the existing merge-conflict path and parks one worker (§2.5, §7 — user decision to accept it).
  Extending the fold to those files, or dropping them from the atomic addition, is a future plan's call.
- **Re-running `/pir-review-plan` on an added task.** The person's in-session approval plus the
  introducing task's reviewer are the gate (§2.4); a full plan review would mean stopping the run,
  which is the thing this plan avoids.
