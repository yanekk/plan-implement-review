# T10 — Full multi-worker run + kill-switch drill

**Phase:** 3 · **Depends on:** T23 · **Weight:** heavy · **Runs:** you

> **Absorbed by T23 (2026-09-12).** This drill is now the Phase 6 `parallel` fixture run
> (`tasks/T23-fixture-parallel-killswitch.md`), executed on captured data via the harness rather than
> by eye. Do not run T10 standalone; it closes ✅ when T23's fact report is all-green. The goal and
> success criteria below are what T23 must show; the procedure is in `TEST-HARNESS.md`.

## Goal

The full-size version of the dangerous thing, last, with the user watching: several real workers at
once — up to the ceiling — on a real small plan, the coordinator dispatching `pir-implement Txx`
and `pir-review Txx` per worker on task branches off one feature branch, built and reviewed
concurrently, merged serially into the feature branch, with a worker deliberately raising a decision
to prove surfacing works under load, a kill-switch drill partway through to prove the hard stop
tears every worker down while `main` stays untouched, restart-from-`PROGRESS.md` resumes cleanly,
and a single promotion of the feature branch to `main` at the end. Nothing new is built beyond a
real multi-task scratch plan; the task is the verification that the whole mode works for real.

## Design sections this implements

DESIGN §2.1 (concurrent build and review, coordinator-named tasks), §2.4 (ceiling and kill switch
under real load), §2.5 (a worker blocked on a decision, serialized merge, kill switch mid-task),
§2.6 (a `you` task run by a hands-on worker), §6 (recovery). This is the §5.1 hand-verified row for
the full run.

## Files

- A real small multi-task scratch plan under a scratch repo (throwaway), including at least one
  `you` task so the hands-on-worker path is exercised under load.
- Any final glue only — if this task needs new product code, the split was wrong and it should be
  raised with the user rather than absorbed here.

## Interface

No new interface. Exercises `pir-coordinate` (T09) over the real platform with the ceiling at 4 and
several independent tasks, one raising a decision and one marked `you`.

## Tests

The automated suite is already green from T01–T09. This task adds no unit tests unless the run
surfaces a pure-logic gap, which would be a small addition to the relevant core module's tests.

## Done when

- [ ] A real small plan of several independent tasks ran to all-`✅` on one feature branch with
      multiple workers live at once, ceiling respected, task-branch merges into the feature branch
      serialized, one decision surfaced and answered, one `you` task run by a hands-on worker the
      user drove (folded back without review), and a single promotion to `main` at the end —
      verified with the user.
- [ ] The kill-switch drill was performed: HALT stopped every live worker, `main` stayed untouched
      (nothing promoted), and restart re-opened the feature branch and resumed from `PROGRESS.md`.
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

Expect: several workers building and reviewing concurrently under coordinator-named tasks on task
branches off one feature branch; serial merges into the feature branch; a decision surfaced while
the rest keep moving; the `you` task handed to a hands-on worker you drive rather than an autonomous
builder; on HALT, all workers stopped and the scratch `main` untouched; on restart, resume from
`PROGRESS.md` to all-`✅` and a single promotion to `main`.
Tell me: did the ceiling hold, did merges stay one-at-a-time, was the decision surfaced without
stalling others, was the `you` task run by a hands-on worker and folded back, did HALT tear
everything down cleanly, and did restart resume without redoing finished work or corrupting `main`.
