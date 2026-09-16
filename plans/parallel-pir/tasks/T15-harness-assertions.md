# T15 — Assertion library and scenario spec: declared facts checked against a bundle

**Phase:** 6 · **Depends on:** T14 · **Weight:** medium · **Runs:** auto

## Goal

Make a scenario's expected behaviour checkable data. Define the **scenario spec** — a scenario's
identity, its fixture, its seatbelts, and the **facts** it must show — and an **assertion library**
of pure predicates over a captured bundle (T14) that report each fact pass/fail with the evidence
that decided it. This is what makes the harness data-driven rather than opinion-driven: the verdict
is a list of facts and the bundle lines that prove or break each.

DESIGN §4.1 lists the sources a predicate reads (flow log, agent-status timeline, transcripts,
`git log`) and gives example facts. Read it first.

## Do

- **A `Fact` is a pure predicate** `(bundle) → { pass, evidence, detail }`. It reads only a loaded
  bundle; no clock, no I/O, no live agent (the boundary in DESIGN §3.1 applies — these live in a
  testable layer). `evidence` names the bundle lines/events that decided it, so a failure points at
  the data, not a verdict with no trace.
- **A library of reusable fact-builders** covering the behaviours the scenarios need, e.g.:
  - `helloPerSpawn()` — exactly one `hello` in the flow log per `spawn`, and the coordinator's
    transcript shows a matching `SendMessage` addressed by that worker's name (T13 Problem A).
  - `noCloseBeforeIdle()` — for every finished worker, no `close` in the flow log precedes an `idle`
    observation of that session in the agent-status timeline (T13 Problem B).
  - `byNameAddressing()` — a worker's transcript has a `SendMessage` whose `to` is the coordinator's
    convention name `{repo} · {plan}` (not only a return-socket reply).
  - `questionRoundTrip()` — a `surface` of a `question`/`decision` in the flow, an answer delivered
    down (outbox / coordinator transcript), and the worker resuming to `done` after it.
  - `mergeConflictParked()` — a `surface` of a `conflict`, no `merge` of that branch, and `main`
    unchanged by it.
  - `oneMergeToMain()` — `main` gained exactly one commit (the promotion) and no task branch merged
    to `main` directly (`git-log.txt`).
  - `killSwitchStoppedAll()` — after `HALT`, every this-run worker leaves the timeline and nothing is
    promoted.
  - `ceilingHeld(n)` — the timeline never shows more than `n` of this run's workers live at once.
- **A `checkScenario(spec, bundle)`** that runs the spec's facts and returns a structured report
  (each fact, pass/fail, evidence) plus an overall verdict. A pretty-printer renders it for a person.
- Everything here is unit-tested against **canned bundles** — hand-written `agents-timeline.jsonl`,
  flow logs and transcript fixtures that encode both the passing and the failing shape of each fact,
  so a predicate that always returns pass is caught.

## Acceptance (build / fakes)

- Each fact-builder has a test with a bundle that passes it and one that fails it, and the failing
  case's `evidence` points at the offending line/event.
- `checkScenario` aggregates facts into one report and one verdict; a single failing fact fails the
  scenario.
- A `noCloseBeforeIdle` test proves it fails a bundle where a `close` timestamp precedes any `idle`
  observation and passes one where an `idle` observation comes first — the T13 Problem B gate, now
  checkable from data.
- No predicate reads a clock, the filesystem or a live agent; `npm test` green.

## Files (expected — the implementing session confirms)

- `src/shell/harness/assertions.mjs` — the `Fact` shape, the fact-builders, `checkScenario`, printer.
- `src/shell/harness/scenario.mjs` — the scenario-spec shape (id, fixture ref, seatbelts, facts).
- `src/shell/harness/*.test.mjs` with the canned bundles.

## Done when

- [ ] The scenario-spec shape and the assertion library exist, with `checkScenario` and a printer.
- [ ] Every fact-builder has a passing and a failing test over a canned bundle, with evidence.
- [ ] Pure throughout (DESIGN §3.1); `npm test` green.

## Needs a person

None. Fully provable against canned bundles; the real bundles it will judge arrive in T17.
