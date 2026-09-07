# T12 — The `pir-coordinate` skill the user talks to

**Phase:** 3 · **Depends on:** T11 · **Weight:** heavy

## Goal

The face of the whole mode: the skill the user starts and then talks to. It checks the plan is
reviewed, then runs the T08 loop over the real shell (T09 + T11), surfacing every worker message
to the user in plain English, sending the user's answers back down to the right worker, honouring
the caps and the kill switch, serializing merges, and reporting progress as tasks reach `✅`. It
wraps everything built so far into one supervised, conversational coordinator.

## Design sections this implements

DESIGN §2.1 (the run and the reviewed-gate refusal), §2.2 (surfacing up-channel messages and
sending answers down), §2.4 (supervision, caps, kill switch), §2.5 (serialized merge, conflict
escalation).

## Files

- `skills/pir-coordinate/SKILL.md` — the coordinator procedure (new skill).
- `src/shell/coordinate.mjs` — the entry the skill drives (wires loop.mjs to the real shell,
  the mailbox and the control flag), plus a thin `pir coordinate {slug}` bin entry.
- `src/shell/coordinate.test.mjs` — against the fakes, proving the surfacing/answer routing.

## Interface

```
pir-coordinate SKILL.md:
  - refuse if PROGRESS.md's plan-reviewed gate says "not yet" (same rule as pir-work).
  - start the loop; each pass, after executing actions, read the mailbox and surface any
    question/decision/conflict to the user in plain English, one at a time.
  - take the user's answer and post it down as --kind answer to that worker (immediate).
  - honour the caps (log breaches) and the HALT flag (stop dispatch, close all workers).
  - report each task reaching ✅ and stop when the plan is fully ✅ or halted.

coordinate.mjs: startCoordinator({ slug, shell, limits }) → drives loop.mjs, exposes the
  mailbox surfacing and answer-routing the skill calls.
```

The skill is where "the user talks to the coordinator, not to workers" becomes real: the loop is
autonomous but pauses to surface messages and never merges or spawns while a decision is
outstanding that the user has not answered.

## Tests

- [ ] Refuses to start when the plan-reviewed gate says "not yet".
- [ ] A fake worker's question is surfaced and a user answer is routed down to that worker only.
- [ ] A conflict message is surfaced as a decision, not silently retried.
- [ ] Cap breaches are logged and surfaced; the HALT flag stops dispatch and closes workers.
- [ ] Reports each ✅ and terminates when the fake plan is fully ✅.

## Done when

- [ ] `pir-coordinate` refuses an unreviewed plan and otherwise drives the loop end to end.
- [ ] Worker messages are surfaced to the user and answers routed to the right worker.
- [ ] `npm test` is green (the surfacing/routing proven against fakes).

## Needs a person

The full conversational drive over real agents is verified in T13; here a person confirms the
skill starts, refuses an unreviewed plan, and surfaces a message. Seatbelt: the scratch plan
from T11, ceiling at 1.

```
# point it at an UNREVIEWED scratch plan first:
pir coordinate scratch          # expect: refusal, names the reviewed gate
# then at the reviewed scratch plan with one task, ceiling 1
```

Expect: refusal on the unreviewed plan; on the reviewed one, a worker spawned and its messages
surfaced to you in plain English.
Tell me: whether the refusal fired, and whether a worker question reached you readably.
