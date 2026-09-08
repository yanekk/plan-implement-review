# T09 — The `pir-coordinate` skill: dispatch, surface, supervise

**Phase:** 3 · **Depends on:** T08 · **Weight:** heavy · **Runs:** auto

## Goal

The face of the whole mode: the skill the user starts and then talks to. It checks the plan is
reviewed, then runs the T05 loop over the real platform (T06 + T08). It is the dispatcher — it
decides which task each worker builds and reviews, sending `pir-implement Txx` and `pir-review Txx`
rather than letting a worker self-select. It surfaces every worker question and decision to the
user in plain English, routes answers back down to the right worker, keeps every other task moving
while one worker waits, spawns a hands-on worker for each ready `you` task and points the user at
it, honours the ceiling and the kill switch, serializes merges, and reports progress as tasks reach
`✅`.

## Design sections this implements

DESIGN §2.1 (the run, the reviewed-gate refusal, coordinator names task and phase), §2.2 (surfacing
messages and sending answers down), §2.4 (supervision, ceiling, kill switch), §2.5 (a worker
blocked on a decision, serialized merge, conflict escalation), §2.6 (`you` tasks spawn a hands-on
worker, folded back without review), §2.8 (agent naming and finding workers by prefix), §2.9
(feature branch, task branches, promotion).

## Files

- `skills/pir-coordinate/SKILL.md` — the coordinator procedure (new skill).
- `src/shell/coordinate.mjs` — the entry the skill drives (wires loop.mjs to the real platform, the
  inbox and the control flag), plus a thin `pir coordinate {slug}` bin entry.
- `src/shell/coordinate.test.mjs` — against the fakes, proving dispatch, surfacing and routing.

## Interface

```
pir-coordinate SKILL.md:
  - refuse if PROGRESS.md's plan-reviewed gate says "not yet" (same rule as pir-work).
  - at start, open the feature branch `pir/{plan}` off main in its own worktree and work there; the
    user's main checkout stays on main and is not touched until promotion (§2.9).
  - the coordinator names itself `{repo} · {plan}` and each worker `{repo} · {plan} · T{nn}`
    (§2.8), and finds its own workers by that prefix in `claude agents --json`.
  - the coordinator chooses each worker's task (decideDispatch) and sends it `pir-implement Txx` on
    a task branch cut from the feature branch, then closes that implement session and spawns a fresh
    session `pir-review Txx` on the same worktree (§2.1) — workers never run pir-work or choose their
    own task. Finished task branches merge into the feature branch.
  - when every task is ✅ and no worker is live (decideDispatch `promoteToMain`), run the test
    command on the feature branch and, if green, merge it to main and report completion. A red
    feature branch is surfaced to the user, not promoted.
  - each pass, after executing actions, read the inbox and surface any question / decision /
    conflict to the user in plain English, one at a time — the user owns every decision.
  - take the user's answer and send it down to that worker (kind: answer), immediately.
  - for a ready `you` task (the spike, hand-verified drills), spawn a hands-on worker `pir-verify
    Txx` on its own task branch and tell the user which worker to go and drive; the user runs the
    live commands and the worker records the findings on that branch. When the worker reports done,
    merge its branch and reconcile the row to ✅ (reconcileTaskRow) — reading the file, not the
    worker's conversation, so the coordinator's context stays clean — and mark a deferred one ⛔ (§2.6).
  - keep dispatching and merging other ready tasks while a worker waits; a parked worker never
    blocks the rest. A decision the user defers indefinitely marks that task ⛔ in PROGRESS.md.
  - honour the ceiling (log when full) and the HALT flag (stop dispatch, stop all workers).
  - report each task reaching ✅, and stop when the plan is fully ✅ or halted.

coordinate.mjs: startCoordinator({ slug, platform, worktree, maxWorkers }) → drives loop.mjs and
  exposes the dispatch, surfacing and answer-routing the skill calls.
```

## Tests

- [ ] Refuses to start when the plan-reviewed gate says "not yet".
- [ ] A dispatched worker is told `pir-implement Txx` for the coordinator's chosen task; the review
      is a fresh worker told `pir-review Txx` (distinct id), not the implementer.
- [ ] The coordinator names itself and its workers per §2.8 and finds its workers by the
      `{repo} · {plan} ·` prefix, ignoring agents from other repos or plans.
- [ ] A fake worker's question is surfaced and a user answer is routed down to that worker only.
- [ ] Other ready tasks keep progressing while one fake worker is parked awaiting an answer.
- [ ] A ready `you` task spawns a hands-on `pir-verify` worker (not an autonomous builder); when it
      reports done its branch is merged and the row reconciled to ✅, and its dependents unblock.
- [ ] The implement session is closed when its fresh reviewer spawns (a task in review uses one slot).
- [ ] A conflict message is surfaced as a decision; a deferred decision marks its task ⛔.
- [ ] The ceiling-full case is logged; the HALT flag stops dispatch and closes workers.
- [ ] Task branches merge into the feature branch; main is untouched until a single promotion.
- [ ] On all-✅ the coordinator promotes only when the feature-branch tests pass; a red feature
      branch is surfaced, not promoted.
- [ ] Reports each ✅ and terminates when the fake plan is fully ✅ and promoted.

## Done when

- [ ] `pir-coordinate` refuses an unreviewed plan and otherwise drives the loop end to end,
      dispatching specific `pir-implement Txx` / `pir-review Txx` and surfacing `you` tasks.
- [ ] Worker questions and decisions are surfaced and answers routed to the right worker, without
      one parked worker stalling the others.
- [ ] `npm test` is green (dispatch, surfacing and routing proven against fakes).

## Needs a person

The full conversational drive over real agents is verified in T10; here a person confirms the
skill starts, refuses an unreviewed plan, dispatches a named task, and surfaces a question.
Seatbelt: the scratch plan from T08, ceiling 1.

```
pir coordinate scratch          # point it at an UNREVIEWED scratch plan first
# expect: refusal, names the reviewed gate
# then at a reviewed scratch plan with one task that asks a question mid-way
```

Expect: refusal on the unreviewed plan; on the reviewed one, a worker told `pir-implement Txx` and
its question surfaced to you, your answer sent down.
Tell me: whether the refusal fired, whether the worker built the task the coordinator named, and
whether a worker's question reached you readably and your answer got back to it.
