# T12 — prove-and-install

**Phase:** 4 · **Depends on:** T03, T04, T05, T07, T08, T09, T10, T11 · **Weight:** medium

## Goal

Show the whole change working on a real run before it is installed: a fixture with a setup line
prepares, builds and ends green; the same fixture without a block is refused; the narrow review pass
unblocks it. Then make it live.

## Design sections this implements

DESIGN §1 success criteria, §5.3, §6.

## Environment (the worker owns this)

```
# trusted scratch, as resume-dead-worker T09 does: installFixture('single', { into: <scratch> })
# in <scratch>/plans/<slug>/DESIGN.md replace `setup: none` with:
#   setup:
#     - sleep 8 && touch .setup-ran
cd <scratch> && PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs single      # detached, the checkout's engine
# limit: touch <scratch>/plans/single/.parallel/control/HALT if the run has not finished in 10 minutes
# teardown: HALT if still running; `claude agents --json --all` shows no fixture session; delete scratch
```

## Outside actions

- Watched live run — `worker` (moved down from `ask` by the user, 2026-09-24; DESIGN §5.3)
- `./install.sh` — `worker`

## Automated checks (the worker runs these)

- The run finishes; `status.json` has `finalState: finished`, `readyToMerge` set, `testsReason` null.
- `control/setup/T01.log` exists and `.setup-ran` is in T01's worktree before its worker started.
- In a second scratch whose DESIGN block is removed, `node src/shell/pir.mjs single` exits non-zero with
  the T03 message and spawns nothing.
- Following this branch's `skills/pir-review-plan/SKILL.md` there, the narrow pass writes a block,
  verifies it in a fresh copy, reaches its ask, commits `plan-review(single): setup/test block`;
  `pir single` then starts (stop it at once). The worker gives the yes itself: a scratch block has
  nothing for the person to judge (plan review, user, 2026-09-24).
- After install: `grep -n parseTestBlock ~/.claude/pir-engine/src/shell/coordinate.mjs` finds it, and
  `~/.claude/skills/pir-work/SKILL.md` has the block gate. In parallel mode, install only after
  `pir/declared-test-command` is merged to main.

## Needs a person

```
Needs you — I cannot see this from here:

  node <scratch>/src/shell/pir.mjs          # the viewer; ↵ opens the single run
```

Expect: the T01 row reads `preparing` with a spinner for about 8 seconds, then `building`; the run ends
with the green hand-off.
Tell me: does `preparing` read as "getting ready" rather than stuck, and is the ending clear?

## Done when

- [ ] The automated checks above are recorded in FINDINGS with their results.
- [ ] The person's answer is recorded in FINDINGS as ✅ with the date.
- [ ] The installed engine and skills carry the change.
