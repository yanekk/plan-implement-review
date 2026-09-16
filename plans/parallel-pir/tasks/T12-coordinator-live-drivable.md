# T12 — Make the coordinator actually drivable live: six drill fixes

**Phase:** 3 · **Depends on:** T09 · **Weight:** heavy · **Runs:** auto

## Goal

The T10 live drill (2026-09-10, ceiling 1, user-driven, stopped deliberately after the first
round-trip) proved the two big unknowns POSITIVELY — a real `claude --bg` worker spawned, and its
first unsolicited message reached the coordinator — and then surfaced six real gaps that block a
full live run. All six are in the shell driver, the message format, and environment assumptions; the
pure core (`loop`/`naming`/`progress`) held up. This task closes the six so T10 can run end to end.

The account of the drill is `FINDINGS.md` (2026-09-10) and, in full, `/tmp/pir-parallel-drill-handoff.md`
as it stood that day. The scratch harness it ran against is `/Users/jan.krolikowski/src/pir-t10`
(`plans/scratch`, two tasks: T01 forces a question, T02 is independent); its control dir
`plans/scratch/.parallel/control/` still holds the `log` and the bridged `inbox` as evidence.

**Two of these fixes are genuine decisions with more than one defensible answer (Problem 2's drive
model, Problem 3's message format). Those are technical "how" and yours to make — but if any fix
forces a change to a rule in `DESIGN.md §2` (the §2.8 naming reality under Problem 1, the drive model
under §2.2/§2.5, the base-branch assumption under §2.9), STOP and raise it with the PM before
implementing it: a DESIGN rule is the PM's to change.**

## Design sections this touches

DESIGN §2.2, §2.5 (surfacing and routing — the answer channel), §2.8 (naming, worker↔coordinator
addressing), §2.9 (feature branch cut from a base branch), §5.2 (seatbelts — the missing
circuit-breaker and promotion guard).

## The six problems, each actionable

### P1 (blocks any question-raising run) — Problem 2: the bin has no channel to inject the user's answer
`main()` in `src/shell/coordinate.mjs` (~L394–409) only calls `coordinator.pass()` and prints
surfaces. It never calls `answer()`/`defer()` and reads no input. So any task that raises a question —
the whole of §2.2/§2.5 — is surfaced and then stuck: the decision cannot be routed back down. The
skill text describes the agent driving `pass()`/`answer()` in-process, but the drill drove the bin,
and the two models are inconsistent.
- **Do:** pick ONE drive model and make the bin and the `pir-coordinate` skill agree.
  - (a) The skill drives `startCoordinator(...)` in-process across its own turns. Needs the run state
    to survive between turns — `createRunState()` is in-memory today (`loop.mjs`), so this needs a
    resumable state file or a persistent process.
  - (b) The bin reads answers from a control file the skill writes (symmetric to the bridge outbox)
    and calls `answer()`/`defer()`. `createAgentBridge` (coordinate.mjs) already models half of this.
- **Acceptance:** a user decision entered through the chosen channel reaches `answer()` and is sent to
  exactly the parked worker; a deferred one reaches `defer()`. Proven against the fakes; the live half
  folds into T10.

### P1 — Problem 3: workers emit prose; the controller parses only the `[pir:v1 …]` wire format
The drill worker's message arrived as natural language ("T01 question (kind: question) — …"), not
`encodeMessage({kind:'question',task:'T01',…})`. `platform.mjs::parseMessage` (~L51–61) only reads
`kind`/`task` from the `^\[pir:v1 kind=… task=…\]$` header; anything else becomes `kind:'message'`
with the task inferred from the sender name. The loop's state machine branches on
`kind: question|implemented|done|conflict`, so a real worker's prose is not recognised — the loop was
validated against fakes that speak the wire format, and real workers do not.
- **Do:** decide ONE — (preferred) make `pir-worker`/`pir-implement`/`pir-review` emit the
  `[pir:v1 kind=… task=…]` header so the machine-readable contract holds; or make the coordinator
  translate prose→kind before feeding the inbox; or loosen `parseMessage` to detect a leading
  `kind:` token. The header approach keeps the contract; document whichever is chosen in `pir-worker`.
- **Acceptance:** a message shaped the way the real worker sends it parses to the right `kind`/`task`
  and drives the loop's state machine. A test asserts the real shape, not just the fake wire string.

### P1 (blocks any run in this checkout) — Problem 4: the bin assumes a local `main` exists
`worktree.mjs::openFeature` cuts the feature branch with `git branch <feature> main` (L114) — `main`
hardcoded — and `promote` merges back to `main`. A checkout on `worktree-parallel-pir-plan` with only
`remotes/origin/main` and no local `main` throws on pass 1 ("not a valid object name: 'main'"). The
drill worked around it with a manual `git branch main HEAD` (since deleted).
`spawn-one-scratch.mjs::ensureMainCheckedOut` (L185) already solves this; `coordinate.mjs` never
ported it.
- **Do:** add an `ensureMain`-style guard to the bin, OR make the base branch configurable (thread a
  `base` through `openFeature`/`promote`), OR document that the coordinator must run from a checkout
  that has local `main`. Prefer the guard — it is what makes the seatbelted scratch run just work.
- **Acceptance:** the bin stands up the feature branch on a checkout with no local `main` without a
  manual pre-step.

### P2 (safety/correctness before multi-worker) — Problem 5: the coordinator counts its OWN session in the ceiling
The control log showed `ceiling full: 2/1 busy` with only one real worker. The coordinator's own
`claude` session shares the repo git-dir, so `platform.mjs::resolveSameRepo` (~L98–102) / `list()`
include it, and `loop.mjs` sums it into `liveAfter` (the `liveIds` set is every listed id). Harmless
at ceiling 1 (T01 still spawned, T02 correctly held), but at a real ceiling it under-dispatches by
one and reports a wrong busy count.
- **Do:** when counting the ceiling, filter `list()` to worker-named agents matching the
  `{repo} · {plan} · T…` prefix (§2.8 already defines workers by name), excluding the coordinator and
  any foreign agent. FINDINGS 2026-09-08 already flagged "T09 must drop self"; this is where it lands.
- **Also port the missing seatbelts from `spawn-one-scratch.mjs`:** the runaway circuit-breaker
  (`CEILING`/`OVER_GRACE`, L245–283, tolerates a transient CEILING+1 review handoff but aborts a real
  runaway — the first live run hit ~12 before it existed) and the scratch-repo promotion guard
  (`PARALLEL_ALLOW_HERE`, L206–215, refuses to promote into a checkout named `plan-implement-review`
  unless overridden). `coordinate.mjs` has neither today.
- **Acceptance:** with N real workers the reported busy count is N, not N+1; a forced over-ceiling
  state aborts and stops every live worker; promotion into the canonical repo is refused without the
  override.

### P2 — Problem 6: the bin exits on `MAX_PASSES` and orphans live workers
The bin ran out its pass budget (~5 min) and printed "ran out of passes" while worker T01 was still
live and parked — leaving a paid session orphaned (the drill had to `claude stop` + SIGTERM by hand).
- **Do:** tie the bin's lifetime to the work (run until promoted / halted / all remaining workers
  parked), and on EVERY exit path tear down or explicitly hand off live workers. `claude stop <id>`
  alone does not end a session — SIGTERM its pid (`platform.mjs::close`, FINDINGS 2026-09-09).
- **Acceptance:** no exit path leaves a live worker the bin spawned. A test drives the drain to a
  parked/stalled stop and asserts every spawned worker was closed (stop + SIGTERM).

### P2 (confirm, may already be fine) — Problem 1: coordinator session name ≠ the §2.8 convention
Convention (`naming.mjs::coordinatorName`): coordinator = `{repo} · {plan}` = `pir-t10 · scratch`,
which workers build themselves to message home. Reality: the harness named the skill session
`pir-t10 / pir-coordinate scratch` — a different shape that even contains `/`, the char §2.8 avoids
because `SendMessage` rejects it in a target name. Yet the worker's first, unsolicited message to
`pir-t10 · scratch` still arrived (over the worker's return socket `uds:/tmp/cc-socks/…sock`).
FINDINGS 2026-09-07 saw replies ride that return address, but this was a first contact, not a reply.
- **Do:** confirm the mechanism and its reliability. Does a worker-initiated send to `pir-t10 ·
  scratch` actually resolve to the slashed session, or did the platform route it another way? If
  inbound is only reliable after the coordinator has messaged the worker first, have the coordinator
  send each freshly spawned worker a one-line hello to open the return channel before relying on
  inbound. Decide and document. Nothing today makes the skill session TAKE the `{repo} · {plan}` name
  — if closing this needs a §2.8 change, raise it with the PM (see the Goal note).

## Files (expected — the implementing session confirms)

- `src/shell/coordinate.mjs` — the drive model / answer channel (P2), ceiling self-filter and ported
  seatbelts (P5), lifetime + worker teardown on exit (P6), the base-branch guard call (P4).
- `src/shell/worktree.mjs` — configurable/guarded base branch (P4).
- `src/shell/platform.mjs` — `parseMessage` and/or `list()` worker-name filtering (P3, P5).
- `skills/pir-worker/SKILL.md` (and `pir-implement`/`pir-review` as needed) — emit the `[pir:v1 …]`
  header (P3); the coordinator hello, if adopted (P1).
- The matching `*.test.mjs` for each.

## Done when

- [ ] A user decision routes end to end against the fakes; the bin and skill agree on one drive model (P2).
- [ ] A real-worker-shaped message parses to the right `kind`/`task` (P3).
- [ ] The bin stands up the feature branch on a checkout with no local `main` (P4).
- [ ] Ceiling counts workers only; circuit-breaker and `PARALLEL_ALLOW_HERE` guard are in place (P5).
- [ ] No exit path orphans a spawned worker (P6).
- [ ] Problem 1's delivery mechanism is confirmed and documented (P1).
- [ ] `npm test` green; every fix provable against the fakes has a test. Anything only provable live is
      marked unverified and folded into T10's re-run.

## Needs a person

The live confirmations (a real answer reaching a real worker and it acting; multi-worker at ceiling 2;
the kill switch halting live workers; promotion to main) are T10's re-run with the user, on the
`/Users/jan.krolikowski/src/pir-t10` scratch harness. This task's own acceptance is provable against
the fakes; it hands T10 a coordinator that can actually be driven.
