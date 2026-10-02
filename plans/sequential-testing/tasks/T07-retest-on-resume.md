# T07 — retest-on-resume

**Phase:** 2 · **Depends on:** T02, T05 · **Weight:** medium

## Goal

A restart must never send an untested branch onward. Reconciliation reads the ledger and branch heads,
and T02's `decideResume` sends a `🔍` or `✅` branch without a green run at its head to a fresh worker of
the right role, with the retest note, instead of to review or straight to merge. That worker checks what
the person may have changed, commits, and reports again, and the gate (T05) tests it with three fresh
tries.

## Design sections this implements

DESIGN §2.5.

## Files

- `src/shell/loop.mjs` (`reconcile`), `src/shell/loop.test.mjs`
- `src/shell/coordinate.mjs` where the opening instruction for a spawned worker gets its notes, and its test

## Interface

- `reconcile` reads `ledger.read()` and each adopted branch's head, calls `decideResume({ featureTasks,
  branchStates, ledger, heads })`, and for each `retest { num, role }` spawns a fresh worker on the
  existing worktree with role `implement` (instruction `pir-implement T{nn}`) or `review`
  (`pir-review T{nn}`), no setup, `retestNote({ role })` appended as the setup note is, seeded in phase
  `implementing` or `reviewing` with `tries = 0`.
- The `restart-summary` line names retested tasks: `retesting T05 (implement)`.

## Tests

- [ ] 🔍 branch, ledger green at head → reviewer, as today
- [ ] 🔍 branch, no ledger → fresh implementer with the retest note; its report goes through tests
- [ ] 🔍 branch, implement green at an older sha (an interrupted review) → fresh reviewer, whose done goes through tests
- [ ] ✅ branch, review green at head → merged with no worker, as today; without → fresh reviewer with the note
- [ ] the retested worker starts at try 1 of 3 after a resume that followed a third-red stop
- [ ] restart-summary text includes the retested tasks; a first start prints no summary

## Done when

- [ ] No reconcile path merges a branch whose head has no review green in the ledger, or reviews one with no implement green.
- [ ] The listed tests are green in `npm test`.
- [ ] `restart-review` and `restart-implement` behaviour is unchanged when the ledger is green at head.
