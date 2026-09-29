# T08 — single-rig

**Phase:** 3 · **Depends on:** T04, T05 · **Weight:** medium

## Goal

Extend the planning rig so a whole single run can be driven in the real `pir` under a pty with fake
builder and reviewer sessions, and prove it with one test. T09, T10 and T11 add their end-to-end tests
on top of it; there is no second rig.

## Design sections this implements

DESIGN §4 (End to end), §5 End to end, §5.2 (the rig's seatbelts).

## Files

- `src/shell/fake/sessions.mjs` (builder and reviewer scripts; matchers `BUILDER_MATCH`, `SINGLE_REVIEWER_MATCH`)
- `src/shell/plan-rig.mjs`, `src/shell/plan-rig.test.mjs`

## Interface

```js
export const SINGLE_RIG_NAME = 'rig-fix';
export const SINGLE_RIG_QUESTION = 'Should the fix also cover the second file?';
// script sets for single runs, beside the planning ones:
//   'single-happy'      builder commits, reports built rig-fix; reviewer commits a fix, reports reviewed
//   'single-red'        the scratch repo's test line fails until the builder's second commit
//   'single-asks'       builder asks SINGLE_RIG_QUESTION before building
//   'single-dropped'    builder reports dropped after the person's answer
//   'single-taken'      builder first names a taken name, then SINGLE_RIG_NAME
startPlanRig({ scripts }) — the scratch repo gains .pir/settings.json with setup [] and a test line the scripts control
startSingle(rig, prompt) → startSingleRun in the scratch repo with the rig's env (for tests that do not go through the box)
```

## Tests

- [ ] rig test: `startSingle` with `single-happy`, then `openScreen` on the dashboard shows a `single` row that reaches `ready to merge` (T10 paints it; until then assert on the snapshot's runState)
- [ ] every script set runs to its outcome through `runSingle` without the screen

## Done when

- [ ] the rig starts and finishes a single run with fake sessions under the same seatbelts as planning
- [ ] the five script sets exist and each has a passing run
- [ ] `npm test` green
