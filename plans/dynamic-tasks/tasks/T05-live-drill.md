# T05 — live-drill

**Phase:** C · **Depends on:** T02, T03, T04 · **Weight:** light

## Goal

Prove the whole path with a real worker and the person: a worker proposes a task, the person
approves it in the worker's session, and the coordinator adopts and dispatches it. The automated
layers prove the merge and dispatch mechanics; only a person can judge whether a real agent
escalates on the right trigger, writes a well-formed addition after approval, and whether the live
run behaves. This task builds the harness fixture for the path and runs the drill with the person.

## Design sections this implements

DESIGN §4 (what no automated layer proves), §5.1 (the person-only check), §5.2 (seatbelts).

## Files

- `src/shell/harness/fixtures/dynamic-task.mjs` — a fixture: a small reviewed plan whose intended
  path is a worker introducing a task, with a `defineScenario` spec (facts over the captured
  bundle). Register it in `src/shell/harness/fixtures.mjs`.
- `src/shell/harness/fixtures.test.mjs` (or the fixture's own test) — the fixture installs
  deterministically and its spec validates.

## Interface

```
// fixture descriptor (fixtures/dynamic-task.mjs), same idiom as the existing fixtures:
export default {
  slug, planText, taskDocs, seedFiles?,
  scenario: defineScenario({ id, title, fixture, seatbelts, facts, expectedTerminal }),
}
// facts assert the run adopted and dispatched the introduced task (over the log/bundle).
```

Because approval is person-in-the-loop, a fully-hands-off live scenario cannot complete on its own;
the scenario is driven with the person answering the worker. The deterministic proof of the two
DESIGN scenarios already lives in `loop.test.mjs` (T02); this fixture is the real-agent drill.

## Automated checks (the worker runs these)

```
npm test        # the fixture installs deterministically and its scenario spec validates
```

## Needs a person

The worker prepares the fixture and hands the person the live run, then waits for the judgement
(DESIGN §5.1). Under the seatbelts in DESIGN §5.2 (a low ceiling and a wall-clock timeout that
auto-touches HALT; `PARALLEL_LIVE=1` only for the live half):

```
# with the fixture installed as a scratch repo, run the coordinator live on it (seatbelted):
PARALLEL_LIVE=1 <ceiling + timeout as the scenario sets> pir-coordinate <fixture-slug>
# when the worker parks asking to add the task, attach to it in `claude agents`, approve, answer there.
```

Expect: the worker escalates a `decision` asking to add a task; after approval it adds the row, the
`PLAN.md` entry and the task doc on its branch and finishes; the coordinator narrates `adopt` and
dispatches the new task once its dependencies are `✅`.

Tell me: did the worker escalate before adding (not add on its own), was the added task well-formed,
and did the coordinator pick it up and dispatch it. Record the answer, dated, in `FINDINGS.md` as a
✅ hand-verification.

## Tests

- [ ] The fixture installs deterministically (byte-identical committed state on two installs).
- [ ] Its `defineScenario` spec validates and its facts are well-formed.
- [ ] `npm test` is green.

## Done when

- [ ] The `dynamic-task` fixture exists, is registered, and its automated checks pass.
- [ ] The live drill has been run with the person and its judgement recorded in `FINDINGS.md` with
      the date (✅). Until then the task is implemented-but-unverified — say which half is which in
      `PROGRESS.md` and the report.
