# T07 — Capstone live drill

**Phase:** 3 · **Runs:** you · **Depends on:** T01, T04, T05, T06, T08 · **Weight:** medium

## Goal

Prove, with the user and live sessions, that the whole fix works end to end — because none of it
can be shown by the test command. A coordinator drives a tiny scratch plan that includes a
hand-driven task, and the person confirms the four behaviours the failed run got wrong: a
hand-driven task completes and the coordinator reads it as verified and does NOT halt; a decision
sent down reaches a worker with no approval prompt and the coordinator confirms receipt; a decision
reaches a parked worker without the person having to ping the coordinator, on the heartbeat, even
after the coordinator has gone quiet (§2.8); and a coordinator launched with a slashed name is
caught at startup. This is the §5.1 hand-verification that closes the plan.

## Design sections this implements

DESIGN §2.1, §2.5, §2.6, §2.7, §2.8 — the live halves of each, which §4 says no test can reach.

## Environment (the worker owns this)

```
# Bring-up (worker):
./install.sh                              # deploy the changed src/ + skills/ to ~/.claude/
# Create a tiny scratch plan under plans/<scratch>/ with: one auto task, one you/verify task,
# and PROGRESS marked reviewed, so a real coordinator run has something small to dispatch.
# Seatbelt: run at ceiling 1 — PARALLEL_MAX_WORKERS=1 (DESIGN §5.2).

# Teardown (worker, before marking done — and confirm it is down):
# remove the scratch run's worktrees:   git worktree remove <each> --force
# delete its branches:                  git branch -D pir/<scratch>* 2>/dev/null
# stop + rm any scratch sessions:       claude stop <id>; claude rm <id>
# confirm: `git worktree list` shows none left, `claude agents --json` shows none left.
```

## Automated checks (the worker runs these)

```
npm test                 # green on the installed source before the live drill
# Launch a coordinator deliberately misnamed with a slash, e.g.
#   claude -n "scratch / bad-name"  then /pir-coordinate <scratch>
# and record whether the startup name check stops it with the correct name (§2.7). This half is
# machine-observable in the coordinator's own output; record it as a machine result.
```

## Needs a person

```
# With the coordinator running the scratch plan at ceiling 1, the person:
#  1. Drives the you/verify task to completion in its worker session, then watches the coordinator:
#     does it report the task as verified/done and let the run continue — WITHOUT halting or
#     calling it fraud? (§2.1, §2.3)
#  2. Answers a decision the coordinator surfaces for the auto task, and confirms the worker
#     received it with NO approval prompt and the coordinator reported the receipt confirmed. (§2.5, §2.6)
#  3. After answering, does NOT message or nudge the coordinator, and confirms the answer still
#     reaches the parked worker on its own within the heartbeat window — the manual ping the failed
#     runs needed is no longer needed. If the build provides a drill switch to arm only the heartbeat
#     (not the fast event watch), use it so this leans on the heartbeat alone. (§2.8)
#  4. Confirms the slashed-name launch was caught at startup with the right name to use. (§2.7)
```

Expect: the hand-driven task completes and the run continues; the decision reaches the worker with
no prompt and the coordinator confirms receipt; the answer reaches the parked worker with no manual
ping, on the heartbeat; the misnamed coordinator is stopped at startup.

Tell me, so it goes in `FINDINGS.md` with the date:
  1. Did the coordinator read the completed hands-on task as verified and keep going (no halt, no
     fraud)? yes/no.
  2. Did the down-sent decision reach the worker with no approval prompt, and did the coordinator
     confirm it was received? yes/no.
  3. Did the answer reach the parked worker without you pinging the coordinator, within the
     heartbeat window? yes/no — and roughly how long it took.
  4. Was the slashed coordinator name caught at startup? yes/no.

## Done when

- All four behaviours are confirmed by the person and written into `FINDINGS.md` with the date as
  a ✅ row (the machine name-check result and the person's judgements recorded as separate
  confirmations, DESIGN §2.2).
- The scratch run is torn down and both `git worktree list` and `claude agents --json` confirm
  nothing is left.
- `main` was never touched by the drill.
