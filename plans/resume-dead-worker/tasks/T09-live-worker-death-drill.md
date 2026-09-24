# T09 — live-worker-death-drill

**Phase:** 5 · **Depends on:** T05, T08 · **Weight:** medium

## Goal

See the fix work over real agents: a real worker killed mid-task is revived on its kept branch, a
second kill falls back to a fresh worker, and the lines on screen read right to the person.

## Environment (the worker owns this)

```
./install.sh                                              # make the engine live, then grep a revive line in ~/.claude/pir-engine/src/shell/loop.mjs
node src/shell/harness/run.mjs worker-death --into <trusted scratch path>   # PARALLEL_MAX_WORKERS=1 via the fixture
# teardown: harness teardownScenario; then claude agents --json --all shows no fixture session; delete the scratch
```

## Outside actions

- Live harness run — `ask`
- `./install.sh` — `worker`

## Automated checks (the worker runs these)

```
node src/shell/harness/run.mjs worker-death --into <scratch>    # all facts PASS; record the bundle path
```

Then the same fixture with `times: 2`, recording `fellBackAfterSecondDeath`.

## Needs a person

The harness runs the coordinator without a display, so the person watches a direct run on the
installed fixture scratch while the worker kills the implementer's pid at its first commit.

```
cd <scratch> && PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 node src/shell/coordinate.mjs worker-death
```

Expect: the `↻ … woke its conversation to carry on` line, the task finishing, and the branch never
disappearing.
Tell me: do the lines read right, and is anything on screen confusing or missing?

## Done when

- [ ] Both harness runs PASS, bundle paths in FINDINGS with the date.
- [ ] The person's verdict on the lines is recorded in FINDINGS as a ✅ row with the date.
- [ ] No fixture session is left in `claude agents --json --all`; the scratch is deleted.
