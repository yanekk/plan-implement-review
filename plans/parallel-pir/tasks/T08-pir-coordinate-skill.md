# T08 — The `pir-coordinate` skill the user talks to

**Phase:** 3 · **Depends on:** T07 · **Weight:** heavy

## Goal

The face of the whole mode: the skill the user starts and then talks to. It checks the plan is
reviewed, then runs the T04 loop over the real platform (T05 + T07), surfacing every worker
question and decision to the user in plain English, routing the user's answers back down to the
right worker, keeping every other task moving while one worker waits, honouring the ceiling and
the kill switch, serializing merges, and reporting progress as tasks reach `✅`. It wraps
everything built so far into one supervised, conversational coordinator.

## Design sections this implements

DESIGN §2.1 (the run and the reviewed-gate refusal), §2.2 (surfacing messages and sending answers
down), §2.4 (supervision, ceiling, kill switch), §2.5 (a worker blocked on a decision, serialized
merge, conflict escalation).

## Files

- `skills/pir-coordinate/SKILL.md` — the coordinator procedure (new skill).
- `src/shell/coordinate.mjs` — the entry the skill drives (wires loop.mjs to the real platform,
  the inbox and the control flag), plus a thin `pir coordinate {slug}` bin entry.
- `src/shell/coordinate.test.mjs` — against the fakes, proving the surfacing and answer routing.

## Interface

```
pir-coordinate SKILL.md:
  - refuse if PROGRESS.md's plan-reviewed gate says "not yet" (same rule as pir-work).
  - start the loop; each pass, after executing actions, read the inbox and surface any
    question / decision / conflict to the user in plain English, one at a time — the user owns
    every decision.
  - take the user's answer and send it down to that worker (kind: answer), immediately.
  - keep dispatching and merging other ready tasks while a worker waits on the user; a parked
    worker never blocks the rest.
  - a decision the user defers indefinitely: mark that task ⛔ in PROGRESS.md so a restart keeps it.
  - honour the ceiling (log when full) and the HALT flag (stop dispatch, stop all workers).
  - report each task reaching ✅, and stop when the plan is fully ✅ or halted.

coordinate.mjs: startCoordinator({ slug, platform, worktree, maxWorkers }) → drives loop.mjs and
  exposes the surfacing and answer-routing the skill calls.
```

The skill is where "the user talks to the coordinator, not to workers" becomes real: the loop is
autonomous but pauses to surface messages, and it never merges or closes a worker whose decision
the user has not answered.

## Tests

- [ ] Refuses to start when the plan-reviewed gate says "not yet".
- [ ] A fake worker's question is surfaced and a user answer is routed down to that worker only.
- [ ] Other ready tasks keep progressing while one fake worker is parked awaiting an answer.
- [ ] A conflict message is surfaced as a decision, not silently retried.
- [ ] A deferred decision marks its task ⛔ and the state survives a re-read of PROGRESS.md.
- [ ] The ceiling-full case is logged; the HALT flag stops dispatch and closes workers.
- [ ] Reports each ✅ and terminates when the fake plan is fully ✅.

## Done when

- [ ] `pir-coordinate` refuses an unreviewed plan and otherwise drives the loop end to end.
- [ ] Worker questions and decisions are surfaced to the user and answers routed to the right
      worker, without parking one worker stalling the others.
- [ ] `npm test` is green (surfacing and routing proven against fakes).

## Needs a person

The full conversational drive over real agents is verified in T09; here a person confirms the
skill starts, refuses an unreviewed plan, and surfaces a worker's question readably. Seatbelt: the
scratch plan from T07, ceiling 1.

```
pir coordinate scratch          # point it at an UNREVIEWED scratch plan first
# expect: refusal, names the reviewed gate
# then at a reviewed scratch plan with one task that asks a question mid-way
```

Expect: refusal on the unreviewed plan; on the reviewed one, a worker spawned and its question
surfaced to you in plain English, your answer taken and sent down.
Tell me: whether the refusal fired, and whether a worker's question reached you readably and your
answer got back to it.
