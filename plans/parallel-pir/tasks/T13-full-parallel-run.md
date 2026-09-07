# T13 — Full multi-worker run + kill-switch drill

**Phase:** 3 · **Depends on:** T12 · **Weight:** heavy

## Goal

The full-size version of the dangerous thing, last, with the user watching: several real workers
at once — up to the ceiling — on a real small plan, built and reviewed concurrently, merged
serially to `main`, and a deliberate kill-switch drill partway through to prove the hard stop
tears every worker down and that restart-from-`PROGRESS.md` resumes cleanly. Nothing new is
built here beyond a real multi-task scratch plan and any final wiring the earlier tasks left; the
task is the verification that the whole mode works for real.

## Design sections this implements

DESIGN §2.1 (concurrent build and review), §2.4 (the ceiling and caps under real load), §2.5
(serialized merge, kill switch mid-task), §6 (recovery). This is the §5.1 hand-verified row for
the full run.

## Files

- A real small multi-task scratch plan under a scratch repo (throwaway).
- Any final glue only — if this task needs new product code, the split was wrong and it should be
  raised with the user rather than absorbed here.

## Interface

No new interface. Exercises `pir-coordinate` (T12) over the real shell with the ceiling at 4 and
several independent tasks.

## Tests

The automated suite is already green from T01–T12. This task adds no unit tests unless the run
surfaces a pure-logic gap, which would be a small addition to the relevant core module's tests.

## Done when

- [ ] A real small plan of several independent tasks was run to all-`✅` with multiple workers
      live at once, ceiling respected, merges serialized, verified with the user.
- [ ] The kill-switch drill was performed: HALT closed every live worker, nothing half-done
      reached `main`, and restart resumed from `PROGRESS.md`.
- [ ] Both results recorded in FINDINGS.md with the date; no scratch worker or worktree left.

## Needs a person

This is the full live run, so a person drives and watches throughout. Seatbelt: a scratch repo
and a scratch plan of trivial tasks, the real ceiling of 4, the kill switch ready.

```
pir coordinate scratch-multi        # several independent trivial tasks, ceiling 4
# watch: claude agents --json  (up to 4 workers, each in its own worktree)
# partway through, drill the kill switch:
touch plans/scratch-multi/.parallel/control/HALT
# expect every worker closed; then remove and restart:
rm plans/scratch-multi/.parallel/control/HALT ; pir coordinate scratch-multi
```

Expect: several workers building and reviewing concurrently; serial merges to the scratch main;
on HALT, all workers closed and nothing half-merged; on restart, the run resumes from
`PROGRESS.md` and finishes to all-`✅`.
Tell me: did the ceiling hold, did merges stay one-at-a-time, did HALT tear everything down
cleanly, and did restart resume without redoing finished work or corrupting `main`.
