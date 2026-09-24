# T09 — live-worker-death-drill

**Phase:** 5 · **Depends on:** T05, T08 · **Weight:** medium

## Goal

See the fix work over real agents: a real worker killed mid-task is revived on its kept branch, a
second kill falls back to a fresh worker, and the task rows read right to the person in `pir`.

## Environment (the worker owns this)

Everything runs from a fixture scratch, which carries this branch's `src/` (harness `carrySource`), so
the code under test is the branch's own. Do not run `./install.sh`: this plan is built by a parallel
run whose workers use the installed engine and skills (DESIGN §5.3).

```
node src/shell/harness/run.mjs worker-death --into <trusted scratch A>
node src/shell/harness/run.mjs worker-death-twice --into <trusted scratch B>
# watched run: install the worker-death fixture into trusted scratch C (fixtures.installFixture), then
cd <scratch C> && PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs worker-death    # detached, the branch's engine
# SIGKILL T01's implementer pid once `T01: part 1` is on its branch (Kill a scratch worker)
# teardown: HALT if still running; claude agents --json --all shows no fixture session; delete A, B, C
```

## Outside actions

- Live harness run — `worker`
- Watched live run — `worker`
- Kill a scratch worker — `worker`

## Automated checks (the worker runs these)

Both harness runs: every fact PASS; record each bundle path. `worker-death-twice` must show
`fellBackAfterSecondDeath`.

## Needs a person

Start the watched run first, then hand this over and wait:

```
Needs you — I cannot see this from here:

  node <scratch C>/src/shell/pir.mjs          # the viewer only; ↵ opens the worker-death run

Expect: T01's row reads `implementing · worker restarted 1×` after the kill, then the task finishes
and merges.
Tell me: does the row read right, and is anything on screen confusing or missing?
```

## Done when

- [ ] Both harness runs PASS, bundle paths in FINDINGS with the date.
- [ ] The person's verdict on the rows is recorded in FINDINGS as a ✅ row with the date.
- [ ] No fixture session is left in `claude agents --json --all`; scratches A, B and C are deleted.
