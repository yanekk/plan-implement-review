# T09 — finisher-drill

**Phase:** 3 · **Depends on:** T03, T06, T07 · **Weight:** medium

## Goal

A worker uses the whole end of a run with the finisher, in the real `pir` screen through the
conversation rig, at both sizes, and judges it against DESIGN §2.11: can a person see at a glance that
the run waits for their go, what the go approves, and what happened after. It fixes what has one right
answer, with a test each, and brings the person only choices with two defensible answers.

## Design sections this implements

DESIGN §2.8, §2.9, §2.11 (per `pir-e2e`'s drill).

## Files

- `src/shell/conversation-rig.mjs`: `finisher` scenario variants `stuck` (a failed step, a second go)
  and `reserved` (a destructive request parked for the person) if T07's scenario lacks them.
- Whatever the drill fixes, each with a test.

## End to end (the worker drives this)

- suite: the conversation rig · sizes: 80×24, 120×40
- [ ] ready → go → done, from the dashboard through the live view to the ended run
- [ ] ready → `Not yet` → row unchanged, a later go works
- [ ] go → stuck → row and footer say so; a second go → done
- [ ] a reserved request after the go → row `asking you`, answered in the conversation
- [ ] the alert texts the fake notifier recorded match §2.9 for each of the above

## Done when

- [ ] Each case above driven and judged; results written in PROGRESS Notes as worker-driven.
- [ ] Every fix has a test; open choices, if any, asked and answered.
