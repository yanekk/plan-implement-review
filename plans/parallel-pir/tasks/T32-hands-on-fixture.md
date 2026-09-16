# T32 — The hands-on fixture: an agent builds a program, a person runs it

**Phase:** 8 (coverage: hands-on verification) · **Depends on:** T17, T30 · **Weight:** medium · **Runs:** auto

## Why this exists

No live fixture has ever exercised a `you` task — the hands-on path where the coordinator spawns a
`pir-verify` scribe worker the person drives, which skips review and folds back (DESIGN §2.6). Every
existing fixture's tasks are `auto`. The `you` path is proven only by unit tests
(`loop.test`/`coordinate.test`), never end-to-end with a person in the loop.

And the live runner **cannot drive a `you` task today** (confirmed 2026-09-14): a `you` task emits no
`surface` line, so the runner's only interactive injector (`scriptedAnswer`, keyed on `surface`) never
fires; the verify worker parks waiting for a human who is absent in an unattended run; the parked worker
keeps the run "active", so it never promotes or stalls and instead burns the wall-clock backstop and
FAILs. This fixture closes the gap for an **attended** run (PM decision 2026-09-14: attended-only — the
unattended auto-drive channel is deliberately out of scope).

The fixture is itself the build→verify split T31 teaches, made concrete.

## What "done" must behave like

**The fixture.** A new fixture `hands-on` in the registry, whose scratch plan is two tasks:

- **T01 `auto`** — an autonomous worker builds a simple runnable program: a tiny script (e.g.
  `greet.mjs`) that prints a known line (e.g. `hello from the agent`). It has its own trivial test,
  is committed on its task branch, and is reviewed by a fresh worker like any `auto` task.
- **T02 `you`** (depends on T01) — the hands-on verification. Its task doc carries a **"Needs a person"
  block** asking the person to **run** the program the agent built and confirm its output. The
  coordinator spawns a `pir-verify` worker; the person runs the program and reports; the worker scribes
  a `✅ verified by hand` row into `FINDINGS.md` on its task branch, marks the row `✅`, reports `done`
  — **no review** — and the coordinator merges its branch and the plan promotes.

**Two new facts** (`assertions.mjs`):

- **`verifyWorkerSpawned(task)`** — the `you` task's worker is a hands-on/verify session, not an
  autonomous implementer. Keys on the capture **timeline** agent name (role is encoded in the worker
  name — `· verify`; the flow log drops role, so the log cannot prove this).
- **`youNeverReviewed(task)`** — the `you` task has **no** `review {task}` flow line yet **does** have a
  `merge {task}` line: it went straight from hands-on to merge, skipping the fresh-review phase (§2.6).
- Reuse **`oneMergeToMain()`** (still one promotion) and **`ceilingHeld(n)`**.
- Optional **`scribeWroteFinding`** — the merged `FINDINGS.md` contains the hand-verified `✅` row (a
  **contains** check via `finalContent`; the existing exact-trim match won't do). Include if cheap; the
  two facts above plus one-promote are the load-bearing set.

**Attended runner support (attended-only).**

- A **durable, visible "go drive worker X for Txx" signal** the person can see. Today `youToDrive` is a
  console-only print (`coordinate.mjs` main) that scrolls past while the runner goes quiet. Emit it to
  the flow log (or a dedicated `hands-on`/feed file) so the person — and the capture — can see which
  worker to drive. This is the minimal signal, **not** an auto-driver.
- A **roomier wall-clock budget** for this fixture's seatbelt (the person drives at human speed): a
  longer `timeoutMs` in the fixture's `seatbelts` (e.g. 20–30 min), still an automatic backstop.
  Teardown-on-exit and the kill switch stay.
- The completion path already works (worker `done` → merge → promote); T32 only adds the signal + budget
  so an attended run isn't guillotined and the person knows what to drive.

**The "Needs a person" block.** `common.mjs`'s `taskDoc` emits no such block today; extend it, or embed
the block in the `you` task's goal text, so `pir-verify` step 1 finds the command to present.

**Docs.** TEST-HARNESS.md gains a per-fixture note for `hands-on` (mirroring the human-decision note: what
the person does, which worker to drive, that the manual channel is driving the named verify worker, and
that there is **no** auto channel by design); DESIGN §4.1's fixture list adds it.

## Files (confirm at build time)

- `src/shell/harness/fixtures/hands-on.mjs` (new) and `src/shell/harness/fixtures.mjs` (import + register
  in `FIXTURES`).
- `src/shell/harness/assertions.mjs` (+ `verifyWorkerSpawned`, `youNeverReviewed`, optional
  `scribeWroteFinding`) and `src/shell/harness/assertions.test.mjs` (fact tests).
- `src/shell/harness/common.mjs` (the "Needs a person" block in `taskDoc`, if extended).
- `src/shell/harness/run.mjs` (durable `youToDrive` signal; per-fixture timeout comes from the seatbelt).
- `plans/parallel-pir/TEST-HARNESS.md`, `plans/parallel-pir/DESIGN.md` §4.1.

## Tests

- [ ] `verifyWorkerSpawned` passes when the you-task's captured worker name has role `verify`, fails when
      it is an implementer.
- [ ] `youNeverReviewed` passes on a flow with `spawn T02` + `merge T02` and **no** `review T02`; fails if
      a `review T02` line is present.
- [ ] The fixture object is well-formed and registered (`listFixtures` includes `hands-on`); its T02 row
      is `runs: 'you'` and its task doc carries a "Needs a person" block.
- [ ] The durable drive signal is written where the runner/capture can read it (a unit test on the emit).
- [ ] `npm test` green; the boundary scan green.

## Done when

- [ ] The `hands-on` fixture exists and is registered; its plan is auto-build T01 + you-verify T02
      (dep T01) with a "Needs a person" block.
- [ ] `verifyWorkerSpawned` + `youNeverReviewed` built and tested; `oneMergeToMain`/`ceilingHeld` reused.
- [ ] The runner emits a durable, visible drive signal and gives the fixture a roomier attended timeout;
      an attended run can reach `promoted` once the person drives the verify worker to done.
- [ ] TEST-HARNESS.md and DESIGN §4.1 updated; `npm test` and the boundary scan green.

## Note on structure

An `auto` task, fresh-reviewed — the fixture + facts + runner support are code that needs fresh eyes. The
end-to-end hands-on path cannot be forced without a person, so it is confirmed by T33, the attended run.
Sibling of T31 off T30; the two can run at once.
