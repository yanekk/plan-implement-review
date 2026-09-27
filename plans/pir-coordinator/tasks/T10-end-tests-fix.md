# T10 — end-tests-fix

**Phase:** 3 · **Depends on:** T05 · **Blocks:** T09 · **Weight:** medium

Added by the T07 worker with the person's approval (2026-09-27): the drill showed a red end reads `running`
on the dashboard and waits on the person. The person chose to treat red tests like a main-sync conflict.

## Goal

When the run's tests are red at the end, with the agent on, pir spawns one worker in the feature worktree
to make them green, exactly as it spawns the main-sync worker for a conflict (DESIGN §2.9 step 1), then
reruns the tests. One attempt only (user 2026-09-27): if the tests are still red after that worker reports
`done`, the run ends red as today (report written, no merge offered, `not ready`). With the agent off, the
end is exactly today's.

## Design sections this implements

DESIGN §2.9 step 1 and §2.11 (tests red), extended: red tests get a fix worker the way a sync conflict does.
Record the rule in DESIGN §2.9 and §2.11 with the date and "user 2026-09-27", and in `/docs`.

## When it fires

- The end gate is red (every task ✅, the feature-branch tests fail): before the sync.
- The tests rerun after a clean or resolved `syncMain` are red.
- At most one test-fix worker per end sequence, whichever of the two fires first. A re-sync while in
  `ready to merge` (§2.10) whose tests turn red gets one attempt of its own.
- Not when the sync is `unresolved`: that branch is already not ready for a different reason.

## Files

- `src/core/conflict.mjs`, test: `buildConflictPrompt({ kind: 'tests-red', slug, plan, testsReason, logPath, audience: 'worker' })`:
  tells a worker in the feature worktree that the plan's test block fails on `pir/{slug}`, where the output
  is, to make it pass without changing what any task delivered beyond the fix, run the test block, commit,
  and report `done` (or `question` if it cannot). Reuses the worker audience and test step of `main-sync`.
- `src/shell/coordinate.mjs`, test: the end sequence gains a `fix-tests` step beside `syncing`: spawn the
  worker (role `fix`, task label `TESTS_FIX_TASK = 'tests-fix'`), wait for its `done` as the main-sync
  worker is waited for, rerun the tests, then carry on to the brief. Its questions route through the agent
  like any worker's. Its `done` is read the way the main-sync worker's is (`case 'sync'` today).
- `src/core/coordinator-brief.mjs` / `coordinator-report.mjs`: the end facts and the report's branch
  footer say whether a fix worker ran and whether it made the tests green.
- `docs/run-lifecycle.md` (and any `/docs` page that describes the end of a run), `README.md`: the red
  end now gets one fix attempt before it is handed over red.

## Tests

- [ ] Gate red → a `tests-fix` worker is spawned in the feature worktree with the `tests-red` prompt; on
      its `done` with tests green, the run reaches `ready to merge`.
- [ ] Still red after its `done` → no second worker; the report is written and the run reads `not ready`.
- [ ] Red after a clean sync → one fix worker; gate red and then red again after the sync → still one.
- [ ] `unresolved` sync → no fix worker.
- [ ] `--no-coordinator` → no fix worker, today's red end.
- [ ] A question from the fix worker is briefed to the agent.
- [ ] Restart mid-fix: the kept worktree and a respawned worker, as for main-sync.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] DESIGN §2.9/§2.11, `/docs` and `README.md` say what the red end does now.
- [ ] `./install.sh` run after the change (from the feature branch, per FINDINGS).
