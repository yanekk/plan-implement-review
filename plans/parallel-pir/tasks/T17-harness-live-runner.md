# T17 — Live runner and the first real scenario runs (folds T10 and T13's live half)

**Phase:** 6 · **Depends on:** T14, T15, T16 · **Weight:** heavy · **Runs:** you

## Goal

Tie the harness together and run it for real. The runner takes a fixture (T16), sets up a scratch
repo, launches a seatbelted real coordinator, drives the scenario, captures the bundle (T14) and
checks it against the scenario's facts (T15) — producing a dated, data-driven pass/fail. This is
where the live behaviours the project has only asserted or hand-watched become recorded data, and it
**folds in T10 (the full multi-worker + kill-switch drill) and T13's live half (the comms proof)**:
each is one scenario here.

Because every run spawns real paid `claude --bg` workers, this is a `you` task: the user launches it
and it runs under seatbelts (DESIGN §4.1, §5.2). No session starts it unattended.

## Do

- **The runner (`auto` to build, its runs are `you`):** given a scenario, install its fixture into a
  fresh scratch repo (T16), launch the coordinator **session under its convention name**
  `{repo} · {plan}` (`claude -n`, DESIGN §2.8) so by-name addressing resolves, start the T14 capture,
  let the coordinator drive to promotion / halt / stall, then seal the bundle and run
  `checkScenario` (T15). Print the fact-by-fact report and exit non-zero on any failed fact.
- **Seatbelts on every run (DESIGN §5.2):** scratch plan + scratch repo; the scenario's own low
  ceiling; kill switch wired; and a **per-scenario wall-clock timeout that auto-touches `HALT`** so a
  hung real worker cannot run or cost unboundedly. The runner must tear every worker down on any exit
  (reuse the coordinator's `teardownRun` orphan-guard).
- **Run each scenario with the user, small first:** single → review-queue → clean-merge →
  human-decision → merge-conflict → parallel (with the kill-switch drill last, largest). Record each
  run's verdict and its bundle path in `FINDINGS.md` with the date. A scenario that fails a fact is a
  real finding (either a bug or a fixture that does not force its path) — log it and decide with the
  user before moving on.
- **The build half is `auto` and testable:** the runner's wiring — fixture install, argv/launch
  construction, capture start/stop, `checkScenario` invocation, timeout→`HALT`, teardown-on-exit —
  is unit-tested with the injected `claude` runner and a scratch git repo (the DESIGN §5.2 dry-run
  seatbelt), exactly as the coordinator's own tests are, so everything short of a real agent spawning
  is proven before any live run.

## Acceptance

**Build / fakes (`auto`):**
- The runner installs a fixture, constructs the coordinator launch (name = `{repo} · {plan}`), starts
  and seals a capture, and runs `checkScenario`, all under the dry-run seatbelt with the injected
  `claude` runner — tested with no live agent.
- The timeout path touches `HALT` and the exit path tears every worker down; both have a test.

**Live, with the user (`you`, seatbelted — this is the fold of T10 + T13 live half):**
- **single:** a real worker is addressed by, and reaches, the coordinator at `{repo} · {plan}`; the
  hello arrives; the worker is closed only once idle; the plan promotes with one merge to `main`.
- **parallel + kill switch:** multiple real workers run within the ceiling; `HALT` mid-run SIGTERMs
  every worker, nothing is promoted, `main` is untouched.
- **review-queue / clean-merge / merge-conflict / human-decision:** each fixture forces its path and
  its facts pass against the captured bundle; the conflict parks without a bad merge; the decision
  round-trips down and the worker resumes.
- Each run's verdict and bundle path recorded in `FINDINGS.md` with the date.

## Files (expected — the implementing session confirms)

- `src/shell/harness/run.mjs` — the runner + the bin.
- `src/shell/harness/run.test.mjs`.
- Fixture and bundle artifacts under `plans/{scratch}/.parallel/…` at run time (not committed).

## Needs a person

The live runs spawn real paid agents, so they are verified with the user on the scratch harness,
seatbelted: scratch plan, per-scenario low ceiling, kill switch wired, wall-clock timeout auto-HALT.
The user launches each scenario and the harness produces the data; the person's part is starting it
and confirming the bundle looks like a real run (not the assertions, which are data). The build half
is fully provable against fakes and does not wait on the user.

```
Needs you — real agents, seatbelted (per scenario):

  cd <scratch repo>
  claude -n "<repo> · <scenario-plan>"     # coordinator session under the convention name
    # then inside it:  /pir-coordinate <scenario-plan>   (with the harness runner + capture)

Expect: the scenario drives to promotion or the drilled HALT; the sealed bundle's facts pass.
Tell me: did it complete under the timeout, and does the fact report read all-pass — and if not,
  which fact failed and what the bundle shows.
```
