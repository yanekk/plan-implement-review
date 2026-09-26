# T09 — pir-commands

**Phase:** 1 · **Depends on:** T08 · **Weight:** light

## Goal

`pir` gets its three verbs: `pir plan`, `pir start {slug}`, and the dashboard, and `pir {slug}` becomes
an error pointing at `pir start`. Every place that prints or runs the old form in code, installer and
tests moves to the new one, so no screen tells the person to type a command that no longer works.

## Design sections this implements

DESIGN §2.1, §2.16 (refusal wording).

## Files

- `src/shell/pir.mjs`, `src/shell/pir.test.mjs`
- `bin/pir` (comment), `install.sh` (closing messages), `src/shell/launcher.test.mjs`
- strings naming `pir {slug}` / `pir ${slug}` in `src/shell/pir-tui.mjs`, `src/shell/coordinate.mjs`,
  `src/shell/control-run.mjs`, `src/shell/conversation-rig.mjs`, `src/core/dashboard.mjs` comments,
  and `src/shell/harness/live-drill.mjs` (`args: ['start', SLUG]`), with the tests asserting them

## Interface

```js
run(argv, { startRun, startPlanRun, openDashboard, openWatch, openBriefBox, stderr }) → exitCode
//   []                    → openDashboard(), 0
//   ['plan']              → openBriefBox(), 0    (T13 supplies the real one; here a stub that prints
//                           'pir plan: write the brief as an argument for now' and returns 2)
//   ['plan', ...words]    → startPlanRun(words.join(' ')); started → openWatch(runId), 0 (T13 changes
//                           this to land in the planner's conversation); refused → 1. Before the rename the
//                           record's slug field is the run id, so openWatch finds it by that name.
//   ['start', slug]       → today's run([slug]) behaviour; not-reviewed with where 'branch' → the
//                           DESIGN §2.16 resume wording
//   ['start'] / ['start', a, b] → usage, 2
//   [other, ...]          → "pir: unknown command '<other>'. To build a plan: pir start <other>" + usage, 2
```

Usage text, exactly:

```
usage: pir                 the dashboard
       pir plan ["brief"]  plan something new
       pir start {slug}    build a reviewed plan
```

## Tests

- [ ] Each argv row above, with spies.
- [ ] `pir plan` refusals print a clean message per reason and exit 1.
- [ ] No source file outside `plans/` and `docs/` still prints `pir {slug}` or `pir ${slug}` as a command
      to type (a test greps `src/`, `bin/`, `install.sh`).
- [ ] `launcher.test.mjs` asserts the closing messages name `pir start {slug}` and `pir plan`.

## Done when

- [ ] Every row passes in `npm test`.
- [ ] The live drill and the conversation rig start runs with `start`.
