# T12 — worker-knows-no-coordinator

**Phase:** 3 · **Runs:** auto · **Depends on:** T07 · **Weight:** light

## Goal

Take the word and the concept "coordinator" out of everything a worker reads, so a worker's world is
its one task, the report files it drops, and the person it asks when stuck — and nothing else. T07
removed the *agentic* framing (SendMessage, the down-channel, "the coordinator surfaces/answers"), but
left the coordinator standing as a program the worker "reports up to", "is spawned and driven by", and
"waits on". On the first live `human-decision` run (T09) a parked worker narrated *"I'll act on the
coordinator's reply when it arrives"* and *"I asked the coordinator … write the file once they answer"*
— exactly the misdirection §2.2 forbids: it tells a watching person to expect a relay that never comes,
instead of attaching to the worker and answering it directly. The worker had been told "coordinator"
from its very first turn (the spawn prompt), so no amount of skill wording downstream undid it.

The worker does not need to know how the run is orchestrated behind it. It is given a task, it records
progress by dropping a file, and when it needs a decision it asks **the person** and they answer in its
own session. This task makes every worker-facing string say exactly that and never name a coordinator.

## Design sections this implements

DESIGN §2.1 (the run is a plain program, invisible to the worker) and §2.2 (the person answers a
blocked worker directly; the report is an up-signal only, routed to no one). No mechanism changes —
the run still coordinates exactly as before; only what the worker is *told* changes.

## Files

- `src/shell/platform.mjs` — `openingInstruction`: the worker's first-turn prompt no longer says it is
  "spawned and driven by a coordinator — not by a person" (which was also wrong: a person *does* answer
  it). It says the worker was given one task, must not run `pir-work` or self-select, and must invoke
  the `pir-worker` contract. The comment above it records that "coordinator" is a word the worker never
  needs.
- `skills/pir-worker/SKILL.md` — the worker contract: every "coordinator" replaced by passive/impersonal
  framing ("you are given a task", "the run", "your branch is merged", "a fresh session reviews it") or,
  where it is about answers, by "the person". The escalation section states plainly that the person is
  the only one who answers, and that nothing in the run has an inbox or will reply. (The plan slug
  `non-agentic-coordinator`, where it appears as an example worker name, is not a reference to a
  coordinator and stays.)
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` — the two/three "a parallel-mode
  coordinator dispatches" mentions reframed to "a parallel-mode run dispatches" / "the named task IS the
  deliberate choice".

`pir-coordinate` (the coordinator's own skill) and the coordinator-side code, comments and tests
(`coordinate.mjs`, `loop.mjs`, `dispatch.mjs`, `naming.mjs`, their `*.test.mjs`) are **out of scope**:
they are not worker-facing, and it is correct for the coordinator's own code to name itself.

## Interface

No code interface changes. `openingInstruction(phase, task)` keeps its signature and still contains
`pir-implement Txx` / `pir-review Txx` (the existing test asserts only that). Grep-checkable contract:
no worker-facing file (`skills/pir-worker`, `skills/pir-implement`, `skills/pir-review`, and the
`openingInstruction` prompt string) contains the word `coordinator`, except the plan slug
`non-agentic-coordinator` used as an example name.

## Acceptance criteria

- [ ] `grep -ri coordinator skills/pir-worker skills/pir-implement skills/pir-review` returns only the
      example name containing the slug `non-agentic-coordinator`; the `openingInstruction` prompt string
      in `src/shell/platform.mjs` contains no `coordinator`.
- [ ] The worker's opening prompt no longer claims it is driven "not by a person"; it names the person
      as the one it asks.
- [ ] `npm test` is green (392+), and `openingInstruction` still names `pir-implement`/`pir-review`
      with the task.
- [ ] **Live (T09, with the person):** on a re-run of the `human-decision` fixture, the parked worker's
      own words name the person as the one who answers, and never say it is waiting on a coordinator/
      reply. This is the hand-verified half and cannot be asserted by the test command (DESIGN §5.1).
