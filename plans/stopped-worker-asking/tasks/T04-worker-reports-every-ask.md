# T04 — worker-reports-every-ask

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Tell workers to drop a fresh `question`/`decision` report every time they end a turn waiting on the
person, a follow-up after an answer included, because an earlier report no longer holds once pir has
seen the answer. It names the question in the run and covers the case the engine rule misses: a worker
asking while its own background job runs.

## Design sections this implements

DESIGN §2.4.

## Files

- `skills/pir-worker/SKILL.md`: one sentence in § "When a stock skill would ask the user and wait",
  step 1.

## Interface

The sentence says, in the skill's register: drop the report every time you are about to end a turn
waiting on the person, including a follow-up question after they answered an earlier one; the earlier
report stopped counting when their answer arrived.

## Tests

- [ ] None automated: a skill line. `npm test` stays green (no test reads the skill text; if one does,
      it passes).

## Done when

- [ ] The sentence is in step 1 of that section and nothing else in the skill changed.
- [ ] `npm test` is green.
