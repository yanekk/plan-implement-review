# T39 — The worker owns the hands-on environment: bring it up, hand off, tear it down

**Phase:** 11 · **Depends on:** T38 · **Weight:** medium · **Runs:** auto

## Goal

Move the setup and teardown of a hands-on check off the person and onto the worker. Today a `you`
task hands the person a "Needs a person" block whose first and last steps are chores — start Docker,
`docker compose up --build`, and `docker compose down` when done. The person is there to *judge* the
work, not to stand up and tear down an execution environment. This task makes the hands-on worker do
that part: it brings the environment up and seeds it, presents a clean "ready — please look" hand-off,
waits, and after the person is done it tears the environment down and confirms it is down before it
marks the task done.

This is where the wasted wait in the T37 capstone came from (RETRO Q10): the run sat idle for ~4.5
minutes at the second check-in because the person had not run `docker compose down`, so the worker's
session stayed busy and the coordinator's idle-gate never cleared. When teardown is the worker's job,
that stall cannot happen — and the coordinator surfaces what it is waiting for instead of looking hung.

## The change to the design

This **revises DESIGN §2.6**. Today §2.6 says a `you` worker is a pure scribe and "the person runs the
live commands themselves." That is too broad: bringing up and tearing down a stack is mechanical, not a
judgement, so it belongs to the worker. Update §2.6 to draw the line at *judgement*: the hands-on worker
owns everything mechanical around the check — standing the environment up, seeding it, and guaranteeing
teardown — and the person is handed a running thing to look at and approve. Keep the existing safety
principle intact and name it as the reason the worker is now *allowed* to stand the stack up: the worker
must tear it down and confirm it is down before finishing, and that guaranteed cleanup is the seatbelt
(§5.2) that bounds a worker bringing up a live environment. A worker that cannot confirm teardown does
not mark the task done — it escalates (the environment is left for the person only as a last resort,
said out loud).

## Files

- `plans/parallel-pir/DESIGN.md` — §2.6: the worker owns setup + teardown; the person judges; teardown-
  before-done is the seatbelt. State the rationale.
- `skills/pir-verify/SKILL.md` (the hands-on worker contract) — the worker brings the environment up and
  seeds it *before* presenting the hand-off; the "Needs a person" block it presents is judgement steps
  only (no `up`, no `down`); after the person reports, the worker tears down, confirms down (e.g. no
  compose services running), and only then reports done. If teardown cannot be confirmed, escalate.
- `skills/pir-coordinate/SKILL.md` — while a hands-on worker is in its person-facing window, the
  coordinator surfaces what it is waiting for ("waiting for you to approve worker … / for the worker to
  finish teardown"), rather than a silent `await-idle`. Confirm the idle-gate clears normally once the
  worker tears down and goes idle (the T37 stall must not recur).
- The **blog-app fixture** task docs T05 and T07 (find the fixture in the harness fixtures; T16/T36 built
  it) — rewrite their "Needs a person" blocks so the worker does `up`/seed and `down`, and the person's
  steps are only the look-and-approve. Do **not** change what the person judges, only who runs the chores.
- The planner templates and any golden fixtures that encode the `you` / hands-on shape, so a generated
  hands-on task carries the new division of labour.

## Tests

Golden/template tests over the changed prose where they exist (as T31/T11 did): a generated or fixture
hands-on task's person-facing block contains no environment `up`/`down` command, and the worker contract
requires a confirmed teardown before done. Any harness change to the coordinator's waiting-signal or the
idle-gate carries a regression test the way T35 did. `npm test` stays install-free and green.

## Done when

- [ ] DESIGN §2.6 states the worker owns setup + teardown and the person judges, with teardown-before-done
      named as the seatbelt.
- [ ] `pir-verify` makes the worker bring the environment up + seed before the hand-off and tear it down +
      confirm-down before done; the person-facing block is judgement steps only.
- [ ] `pir-coordinate` surfaces what it is waiting for during the hands-on window, and the idle-gate clears
      once the worker tears down (no T37-style silent stall).
- [ ] The blog-app fixture's hands-on tasks reflect the new split; goldens/templates updated; `npm test`
      green.

## Live proof (a separate `you` follow-up, not this task)

That a real background worker can actually stand up Docker + seed it and tear it down cleanly is a
live-only fact — the automated suite cannot reach it, and in the T37 run Docker was not even reachable
from a worker's worktree. Proving it needs an attended re-run of the blog-app fixture under the new
division of labour, which is its own `you` task (like T37 proved T36). This task builds and unit/golden-
tests the contract; it does not assert the live behaviour. Flag it for the PM as the natural next `you`
task. Docker Desktop being *running* may still be a precondition the person satisfies once — that is a
finding for the live run, not an assumption to bake in here.

## Scope

Prose, fixture task docs, templates/goldens, and the coordinator waiting-signal / idle-gate. No blog
product code. Anything else the change reveals goes in FINDINGS.md.
