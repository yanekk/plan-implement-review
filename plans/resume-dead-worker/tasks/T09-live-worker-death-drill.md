# T09 — live-worker-death-drill

**Phase:** 5 · **Depends on:** T05, T08 · **Weight:** medium

## Goal

See the fix work over real agents: a real worker killed mid-task is revived on its kept branch, a
second kill falls back to a fresh worker, and the task rows and the conversation view read right in
`pir`. The worker drives `pir` itself and judges the screen (CLAUDE.md; `pir-e2e` skill).

## Environment (the worker owns this)

Everything runs from a fixture scratch, which carries this branch's `src/` (harness `carrySource`), so
the code under test is the branch's own. Do not run `./install.sh`: this plan is built by a parallel
run whose workers use the installed engine and skills (DESIGN §5.3).

```
node src/shell/harness/run.mjs worker-death --into <trusted scratch A>
node src/shell/harness/run.mjs worker-death-twice --into <trusted scratch B>
# watched run: install the worker-death fixture into trusted scratch C (fixtures.installFixture), then
# drive `PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs worker-death` in a pseudo-terminal rig (pir-e2e)
# SIGKILL T01's implementer pid from control/workers.json once `T01: part 1` is on its branch
# teardown: Ctrl+S twice or HALT; no fixture worker pid from workers.json still alive; delete A, B, C
```

## Outside actions

- Live harness run — `worker`
- Watched live run — `worker`
- Kill a scratch worker — `worker`

## Automated checks (the worker runs these)

Both harness runs: every fact PASS; record each bundle path. `worker-death-twice` must show
`fellBackAfterSecondDeath`.

## Worker drill (the worker judges)

In the watched run, capture the screen at each step and judge it against DESIGN §2.6:

- after the kill, T01's row reads `implementing · worker restarted 1×`, then the task finishes and merges;
- opening T01 (→) shows one conversation: the worker's work before the kill, the `exited` line, the
  `revived` line, pir's continuation message, and the worker carrying on;
- nothing on screen is confusing, cut off or missing next to the prototype-era views.

Record the verdict as worker-driven, not as verified by hand.

## Done when

- [ ] Both harness runs PASS, bundle paths in FINDINGS with the date.
- [ ] The drill's verdict and captures are recorded in FINDINGS as a worker-driven 📌 row with the date.
- [ ] No fixture worker is left running; scratches A, B and C are deleted.
