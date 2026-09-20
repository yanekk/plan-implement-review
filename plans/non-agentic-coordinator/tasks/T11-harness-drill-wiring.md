# T11 — harness-drill-wiring

**Phase:** 3 (addendum) · **Runs:** auto · **Depends on:** T05, T10 · **Weight:** light

## Goal

Two live-scenario fixtures FAIL for test-rig reasons, not coordinator reasons — the T09 live run
(2026-09-20) proved the coordinator correct in both, but `run.mjs` scored them red. Fix the rig so both
report `PASS` unattended, without re-introducing the removed down-channel (§2.2).

**1. `parallel`'s kill-switch drill never fires.** `killSwitchStoppedAll()` needs a `halt-close` flow
line, which the coordinator only writes if it sees the `HALT` flag *while it is still dispatching*. But
`runScenario` touches `HALT` only on the wall-clock timeout (10 min, never reached by a fast run) or in
`teardownScenario` — after the coordinator has already exited `completed`. So a normal `parallel` run
(three trivial tasks, done in ~2 min) hands off cleanly and no `halt-close` is ever written; the fact
reports "the kill switch was not seen to fire". The drill is unit-tested only against a canned bundle
that already contains a `halt-close` line. Live, it cannot pass.

**2. `human-decision`'s designed park is scored FAIL.** The fixture's correct outcome is that T01 parks
forever waiting for the person while the independent T02 merges past it — the harness is not a person and
must not answer T01 (the down-channel is gone, §2.2). Its fact `parkedWorkerHoldsSlot('T01')` PASSES. But
the run then hits the timeout and halts, and `runScenario` ends with `const ok = report.pass && !timedOut`
— so any timed-out run is FAIL regardless of its facts. A fixture whose correct terminal is "parked, then
halted" can never pass unattended. (fixtures/human-decision.mjs already documents the intent: "this
scratch run just captures that it held its slot and never got an answer routed to it".)

Both were found during T09's live runs (FINDINGS 2026-09-20).

## Design sections this implements

DESIGN §4 (the live-scenario harness proves the new model) and §4.1 (the kill-switch drill), §2.2 (no
down-channel — the fix must not fake an answer), §2.6/§5.2 (HALT is the kill switch).

## Files

- `src/shell/harness/run.mjs` —
  1. Fire `HALT` mid-run for a fixture that declares a kill-switch drill: after the workers are up (the
     first `spawn` is observed), touch `HALT` once so the live coordinator sees it while dispatching and
     writes `halt-close`. Model it on the existing `restart` branch in `main()` (a per-fixture drill flag),
     not a new always-on behaviour. The 10-min timeout→auto-HALT stays as the runaway guard.
  2. Honour a fixture's declared expected terminal in the `ok` computation: a fixture that declares its
     correct end is a park/halt (e.g. `human-decision`) passes when its facts pass and it reached that
     declared terminal, instead of the blanket `report.pass && !timedOut`.
- `src/shell/harness/fixtures/parallel.mjs` — declare the kill-switch drill (the trigger `run.mjs` reads),
  so `killSwitchStoppedAll()` has a `halt-close` to assert against live.
- `src/shell/harness/fixtures/human-decision.mjs` — declare that its expected terminal is a park/halt.
- `src/shell/harness/scenario.mjs` — if the drill/terminal flags belong on the scenario spec, thread them
  through `defineScenario` (keep the shape declarative; `killSwitch: true` already lives here).
- `src/shell/harness/run.test.mjs` — cover both against fakes: a kill-switch fixture gets `HALT` touched
  after the first spawn and the run is scored on the `halt-close`; a park-terminal fixture with passing
  facts and a halted terminal scores `ok:true`.

## Interface

The exact flag names are the implementer's to choose (`how`); keep them declarative and named for intent,
e.g. a fixture/scenario carrying `killSwitchDrill: true` (touch HALT once, mid-run) and
`expectedTerminal: 'parked'` (a halt after a park is success, not timeout-failure). `run.mjs`'s `ok`
becomes: facts pass AND the run reached the fixture's expected terminal (`completed` by default; `parked`
for `human-decision`).

## Do NOT

- **Do not re-introduce the down-channel to "answer" `human-decision`.** There is no scripted answer, no
  `answers` feed, no relay (§2.2, removed in T05). The fix is to score the park as the expected terminal,
  not to make the rig answer the worker.
- **Do not touch `merge-conflict`.** Its staleness is a separate decision (T10 § Out of scope, FINDINGS).

## Tests

- [ ] A kill-switch-drill fixture, run over fakes, has `HALT` touched after the first spawn is observed,
      and `killSwitchStoppedAll()` is scored against the resulting `halt-close`; a run with no drill flag
      is untouched mid-run (the timeout guard still exists).
- [ ] A park-terminal fixture whose facts pass and which ends halted scores `ok:true`; a fixture with no
      such declaration still fails on a timeout (no regression to the runaway guard).
- [ ] `npm test` is green.

## Done when

- [ ] `run.mjs` fires the kill switch mid-run for the declaring fixture and honours a declared park/halt
      terminal; `parallel` and `human-decision` declare their drills; `run.test.mjs` covers both over
      fakes; `npm test` is green.
- [ ] The live confirmation that `parallel` and `human-decision` now report `PASS` end-to-end over real
      workers is a hand-verification (§5.1), recorded with T09's other live results — not asserted by this
      task, which is proven by the fake-driven `run.test.mjs`.
