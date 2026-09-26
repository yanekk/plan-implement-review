# T17 — harness-plan-fixture

**Phase:** 3 · **Depends on:** T07, T08, T15 · **Weight:** medium

## Goal

The real-Claude harness learns to start from a repo with no plan: it stands up a tiny codebase, starts
a planning run with a fixed brief, plays the person through planning and review, gives the go, waits
for the build to finish, and checks the outcome. This is the fixture T18 runs; building it is free,
running it is not.

## Design sections this implements

DESIGN §4, §5.2 (timeout, ceiling, reply cap), §2.8 (the go through `startRun`).

## Files

- `src/shell/harness/fixtures/plan-command.mjs` (new), registered in `fixtures.mjs`
- `src/shell/harness/run.mjs`: a `plan` scenario kind
- `src/shell/harness/answerer.mjs`: canned replies to idle sessions
- `src/shell/harness/capture.mjs`: `parseLogName` accepts `plan-{n}` and `review-{n}`
- `src/shell/harness/assertions.mjs`: the plan-command facts
- their tests

## Interface

```js
// fixture 'plan-command': seed = a node package with src/slug.mjs exporting nothing yet, a test script
//   `node --test`, one passing test; no plans/; brief:
//   "Add a slugify(text) function to src/slug.mjs: lowercase, ASCII letters and digits, words joined by
//    single hyphens. Headless, no UI. Keep the plan to at most three tasks."
// scenario: { kind: 'plan', ceiling: 2, timeoutMs: 90 * 60_000, replyCap: 40,
//             reply: 'Yes. Go with your recommendation, and keep it as small as possible.' }
// run.mjs plan kind: startPlanRun (T08) with PIR_HOME scratch, answerer until the plan run finishes,
//   then startRun(slug) as the go, then the existing completion wait on the build; HALT and stop on timeout
// answerer: pendingDrops gains replies = { text, cap }: an idle planning session with nothing pending
//   whose last entry is its own text gets `text` once per turn, at most `cap` times per run
```

## Tests

- [ ] `parseLogName` for `plan-1.ndjson`, `review-2.ndjson`, and the old task names.
- [ ] Reply rule: sent once per idle turn, never while busy or pending, stops at the cap.
- [ ] The fixture installs a scratch repo with no `plans/` and a green `npm test`.
- [ ] Assertions over a recorded bundle (hand-built in the test): reviewed plan on `pir/{slug}`, every
      task ✅, tests green, `main`'s head unchanged, index row `kind 'work'`.
- [ ] A dry pass of the plan scenario against the T05 fakes (shim on `PATH`) reaches the assertions green.

## Done when

- [ ] Every row passes in `npm test` with no real `claude`.
- [ ] `node src/shell/harness/run.mjs plan-command --into <scratch>` is the documented command, and its
      refusal without `--into` in the canonical checkout is unchanged.
