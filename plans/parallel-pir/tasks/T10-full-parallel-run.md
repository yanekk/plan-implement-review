# T10 — Full multi-worker run + kill-switch drill

**Phase:** 3 · **Depends on:** T09 · **Weight:** heavy · **Runs:** you

## Goal

The full-size version of the dangerous thing, last, with the user watching: several real workers at
once — up to the ceiling — on a real small plan, the coordinator dispatching `pir-implement Txx`
and `pir-review Txx` per worker, built and reviewed concurrently, merged serially to `main`, with a
worker deliberately raising a decision to prove surfacing works under load, and a kill-switch drill
partway through to prove the hard stop tears every worker down and restart-from-`PROGRESS.md`
resumes cleanly. Nothing new is built beyond a real multi-task scratch plan; the task is the
verification that the whole mode works for real.

## Design sections this implements

DESIGN §2.1 (concurrent build and review, coordinator-named tasks), §2.4 (ceiling and kill switch
under real load), §2.5 (a worker blocked on a decision, serialized merge, kill switch mid-task),
§2.6 (a `you` task surfaced), §6 (recovery). This is the §5.1 hand-verified row for the full run.

## Files

- A real small multi-task scratch plan under a scratch repo (throwaway), including at least one
  `you` task so surfacing is exercised under load.
- Any final glue only — if this task needs new product code, the split was wrong and it should be
  raised with the user rather than absorbed here.

## Interface

No new interface. Exercises `pir-coordinate` (T09) over the real platform with the ceiling at 4 and
several independent tasks, one raising a decision and one marked `you`.

## Tests

The automated suite is already green from T01–T09. This task adds no unit tests unless the run
surfaces a pure-logic gap, which would be a small addition to the relevant core module's tests.

## Done when

- [ ] A real small plan of several independent tasks ran to all-`✅` with multiple workers live at
      once, ceiling respected, merges serialized, one decision surfaced and answered, one `you`
      task surfaced not dispatched — verified with the user.
- [ ] The kill-switch drill was performed: HALT stopped every live worker, nothing half-done
      reached `main`, and restart resumed from `PROGRESS.md`.
- [ ] Both results recorded in FINDINGS.md with the date; no scratch worker or worktree left.

## Needs a person

This is the full live run, so a person drives and watches throughout. Seatbelt: a scratch repo and
a scratch plan of trivial tasks, the real ceiling of 4, the kill switch ready.

```
pir coordinate scratch-multi        # several independent trivial tasks, ceiling 4, one you-task
# watch: claude agents --json  (up to 4 workers, each in its own worktree)
# answer the one decision a worker raises, and confirm other tasks kept moving meanwhile.
# partway through, drill the kill switch:
touch plans/scratch-multi/.parallel/control/HALT
# expect every worker stopped; then remove and restart:
rm plans/scratch-multi/.parallel/control/HALT ; pir coordinate scratch-multi
```

Expect: several workers building and reviewing concurrently under coordinator-named tasks; serial
merges to the scratch main; a decision surfaced while the rest keep moving; the `you` task handed to
you rather than a worker; on HALT, all workers stopped and nothing half-merged; on restart, resume
from `PROGRESS.md` to all-`✅`.
Tell me: did the ceiling hold, did merges stay one-at-a-time, was the decision surfaced without
stalling others, was the `you` task surfaced, did HALT tear everything down cleanly, and did restart
resume without redoing finished work or corrupting `main`.
