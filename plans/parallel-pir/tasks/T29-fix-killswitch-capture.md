# T29 — Fix the kill-switch capture: seal on `halt-close`, and make the `hello` flow line honest

**Phase:** 6 · **Depends on:** T28 · **Weight:** medium · **Runs:** auto · **Gates:** the T23 re-run

## Why this exists

The T23 live run (2026-09-14, FINDINGS) FAILed — but on the capture harness, not on behaviour. The
kill switch itself worked correctly: two workers ran concurrently at ceiling 2 with T03 waiting, and
on HALT every worker plus the coordinator was torn down, `main` was untouched, and nothing was
promoted. `ceiling-held:2` passed. Yet two facts went red, both because the runner takes its evidence
snapshot too early. This is the **second hardening task from a failed fixture** (after T28), and it is
the reason T23 could not pass on the machinery as-is: a naive re-run FAILs identically.

## Root cause (confirmed, from the bundle + code)

**Problem A — the seal races the kill switch.** `run.mjs` `runOutcome({ flowText, haltPresent })`
returns terminal (`over: true, reason: 'halted'`) on `haltPresent` — the mere existence of the HALT
flag file — OR on a `halt-close` flow line. In a kill-switch drill the HALT flag is created by the
operator (or the wall-clock timeout), so `haltPresent` is true immediately, and `waitForCompletion`
returns on the very next poll. The bundle is then sealed ~2s after HALT is touched, about 4s BEFORE
the coordinator writes its own `halt-close` line and finishes closing its workers. In the T23 run:
HALT touched 06:32:34, bundle sealed ≈06:32:36, `halt-close` written 06:32:40 and 06:32:41. So the
sealed `flow.log` stops at the last `ceiling full` line and omits both `halt-close` lines, and
`killSwitchStoppedAll` fails for "no halt-close in the flow — the kill switch was not seen to fire."
Unlike a promote-terminated scenario (T18–T22), where the coordinator writes the terminal marker only
after it is done, the HALT flag precedes the coordinator's reaction — so this is the first scenario
where sealing on the terminal marker's *presence* beats the coordinator to the evidence. The wall-clock
timeout's own auto-HALT has the same shape: it will seal before the coordinator can react to it.

**Problem B — the `hello` flow line is written before the hello is actually sent.** In live mode the
bin cannot call SendMessage (it is an agent tool, coordinate.mjs header). So `loop.mjs` (≈lines
140–141) does `platform.send(name, { kind: 'hello', … })` — which in the live path only **queues the
hello to the outbox** for the coordinator session to send — and in the same breath `record('hello', …)`
writes the `hello Txx` flow line, at spawn time. The actual SendMessage is performed later by the
coordinator *session* draining that outbox. In the T23 run the session was HALTed 11s in (right after
launching the bin and confirming it was alive), before it drained the outbox, so the hello was logged
and queued but never sent: the final 71-line coordinator transcript has **zero** SendMessage calls and
the workers received only their spawn prompt. `helloPerSpawn`'s flow-half (a `hello` line per spawn)
therefore matched while its transcript-half (a hello SendMessage addressed to each worker) failed. The
two halves can disagree whenever a run ends between the queue and the send — which the kill switch does
by design.

## What "done" must behave like

**Problem A (clear, one right answer):**

- A **HALT-terminated** run is over only once the coordinator has recorded its own `halt-close`, not on
  the bare presence of the HALT flag. Change `runOutcome` / `waitForCompletion` so `haltPresent` alone
  is **not** a terminal: it waits for `hasType('halt-close')` (the coordinator confirming it processed
  the kill switch). The wall-clock timeout stays the hard backstop for a coordinator that never
  confirms — so a hung coordinator still cannot cost unboundedly (DESIGN §5.2).
- Add a **short grace after `halt-close`** before sealing (a couple of polls), so the final teardown
  tick and the coordinator's flushed transcript are captured too — the seal must not race the
  transcript flush the way it raced `halt-close`.
- The wall-clock timeout must still guarantee the run ends even if `halt-close` never comes (e.g. the
  coordinator died). Do not make `halt-close` the *only* exit — keep the timeout backstop.

**Problem B — a sub-decision for the PM; confirm the approach before building.** There are three honest
ways to close the queue-vs-send gap, and the choice is a behaviour/scope call, so put it to the PM as
one short question before building and do what they say. Recommended: **(ii)**.

  (i) **Make the flow line honest.** Record `hello Txx` only when the SendMessage is actually issued —
      i.e. the coordinator session confirms the send back to the bin (a small up-channel `hello-sent`
      signal), or the record moves to the session side. Strongest guarantee, but a real
      architecture change to the down-channel, and it fights the kill switch (you would be sending
      hellos to workers you are about to kill).

  (ii) **Scope `helloPerSpawn` to what the kill switch allows.** In a HALT-terminated run, a spawn whose
      channel had not yet opened when the kill switch fired is exempt from the transcript-half — the
      down-channel was queued (the `hello` flow line proves that), and the kill switch legitimately
      interrupts the send. Keep the transcript-half strict for promote-terminated fixtures (single,
      review-queue), where a missing hello is a real bug. Smallest change; the fact stays meaningful
      everywhere it should.

  (iii) **Drop `helloPerSpawn` from the parallel fixture.** Per-worker naming and hello delivery are
      already proven by the single and review-queue fixtures; the kill-switch drill's job is the
      ceiling and the stop. Rely on `ceilingHeld(2)` + `killSwitchStoppedAll()` here. Simplest, but
      loses the concurrency-naming check in the one fixture that spawns the most workers at once.

  Do not decide this silently, and do not weaken `helloPerSpawn` for the promote-terminated fixtures.

## Files (confirm at build time)

- `src/shell/harness/run.mjs` — `runOutcome` / `waitForCompletion`: a HALT run is terminal on
  `halt-close`, not `haltPresent`; a short post-`halt-close` grace before returning; the wall-clock
  timeout stays the backstop. `runOutcome` stays pure (it is unit-tested against canned flow text).
- `src/shell/harness/run.test.mjs` — the new seal-timing tests (below).
- For Problem B, depending on the chosen approach: `src/shell/harness/assertions.mjs` (`helloPerSpawn`
  scoping) and/or `src/shell/harness/fixtures/parallel.mjs` (drop the fact); or, for (i),
  `src/shell/loop.mjs` + `src/shell/coordinate.mjs` + `skills/pir-coordinate/SKILL.md` (the hello-sent
  confirmation and the moved record).
- `plans/parallel-pir/TEST-HARNESS.md` — note that the kill-switch snapshot now waits for `halt-close`
  before sealing; and, if the fact changes, what `parallel`'s facts now are.
- `tasks/T23-fixture-parallel-killswitch.md` — update "Facts it must show" to match any fact change.

## Tests

- [ ] `runOutcome`: the HALT flag present with **no** `halt-close` in the flow is **not** terminal
      (stays active); `halt-close` present **is** terminal. (Mutation check: the old
      `haltPresent`-is-terminal behaviour reds this test.)
- [ ] `waitForCompletion` (injected timers): with the HALT flag present but no `halt-close`, the loop
      keeps polling until the `halt-close` line appears, then seals after the grace; and the wall-clock
      timeout still ends a run where `halt-close` never comes (backstop).
- [ ] The Problem B fix proven by a test: for (ii), `helloPerSpawn` passes on a HALT-terminated bundle
      whose interrupted spawn has a `hello` flow line but no SendMessage, and still **fails** on a
      promote-terminated bundle missing a hello; for (iii), the parallel scenario no longer declares the
      fact; for (i), the `hello` flow line appears only once the send is confirmed.
- [ ] `npm test` green; the boundary scan green (no clock/network/randomness in the core).

## Done when

- [ ] A HALT-terminated run seals only after the coordinator's `halt-close` (plus the grace), so the
      captured `flow.log` contains `halt-close` — with the wall-clock timeout still guaranteeing the run
      ends if the coordinator never confirms.
- [ ] The `hello` queue-vs-send gap is resolved per the PM's chosen approach, and `helloPerSpawn` stays
      strict for the promote-terminated fixtures.
- [ ] `TEST-HARNESS.md` (and, if the fact changed, `T23` and `parallel.mjs`) updated.
- [ ] `npm test` and the boundary scan green.

## After this task — not self-verifying

The kill switch is only proven under real agents. Its proof is the **T23 re-run** (`run.mjs parallel
--into <dir>`, HALT touched mid-run), gated behind this task: two workers concurrent at ceiling 2 with
T03 waiting, HALT, every worker and the coordinator torn down, `main` untouched, nothing promoted — the
three facts (`helloPerSpawn` as redefined, `ceilingHeld(2)`, `killSwitchStoppedAll`) all green — followed
by the reflection pass (DESIGN §4.1). T23 closes T10 when that report is all-green.
