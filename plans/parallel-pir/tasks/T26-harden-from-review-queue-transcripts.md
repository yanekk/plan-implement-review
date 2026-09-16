# T26 — Harden the coordinator and worker prompts from the T19 transcripts

**Phase:** 6 · **Depends on:** T25 · **Weight:** medium · **Runs:** auto

## Goal

The `review-queue` fixture (T19, 2026-09-13) passed on real agents with T24's hardening already in
place, but its captured transcripts show four residual friction points — three in the coordinator's
relay loop, one latent race between the bin and a worker. This task folds the fixes in. Three are prose
edits to the two skills (the same kind of work as T24); one (S1) is a small `src/` change to the spawn
message the bin emits, because a worker cannot be told whom to report to by prose alone. It changes no
design rule. Like T24 it is **not self-verifying**: prose and message wording that govern live behaviour
are proven only by a live run, which is the gated fixture queue that follows it (see *After this task*).

**This task runs after T25** (the coordinator↔bin transport redesign), so its coordinator edits must
describe the transport as T25 leaves it, not the hand-relay this task was first written against. Where
T25 has already resolved a finding, drop that edit rather than restating it — in particular, if T25's
redesign already gives a worker its reply address without depending on the hello, **S1 is subsumed and
is dropped** (say so in the commit). Read T25's task doc and its landed changes before applying these.

## Design sections this implements

DESIGN §2.2 (coordinator name, hello), §2.3 (lifecycle), §2.5 (decisions and questions routed through
the coordinator to the PM), §2.8 (naming and addressing), §4.1 (the live harness). No rule changes; the
edits make the skills and the spawn message teach what these sections already require.

## The four findings (from the T19 bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`)

1. **Double-backgrounded launch scared the coordinator.** It ran the bin with both `run_in_background`
   and a trailing `&`; the wrapper returned `exit 0` at once and the coordinator feared the bin had
   died (05:54:13), spending a `pgrep` step to reassure itself. A jumpier coordinator could relaunch a
   second bin.
2. **The coordinator ignored its own Monitor and sleep-polled.** After arming a flow-log Monitor that
   told it "do not poll or sleep" (05:54:46), it still ran six blocking `sleep` polls (05:55:17 …
   05:59:43, ≈45s), duplicating what the Monitor delivered and slowing its reactions.
3. **A worker guessed at an ambiguous spec because it has no ask path.** T02 wrote `rq-2.txt` with a
   trailing newline, reconsidered, and rewrote it without one (05:54:15→23); the three workers
   converged only by order of who wrote first. The spec ("only contents are the text `ok`") is
   genuinely ambiguous about the newline — the exact half-specified case CLAUDE.md says to escalate —
   and no worker raised it. The `kind=question` channel and control `answers` file already exist (T12),
   so this is mostly teaching workers to use them; T21 (human-decision) is built to test this path and
   is de-risked by fixing it.
4. **A worker learns its reply address only from the hello, which can arrive too late.** The spawn
   prompt names no coordinator; the worker gets the address from the hello body. In T19 the hello
   (05:54:25) beat the workers finishing (05:54:44), but a fast task or a slow hello would leave a
   worker done with nowhere to report.

The dominant *cost* the bundle showed — the coordinator hand-relaying every worker message into the
bin's inbox (≈20–25% of the run) — is **not** addressed here; it is its own task, **T25** (the transport
redesign), which runs first. This task only makes the prompts describe whatever transport T25 lands.

## Files

- `skills/pir-coordinate/SKILL.md` — edits C7–C10.
- `skills/pir-worker/SKILL.md` — edit W5.
- The bin source that builds the spawn message (`src/shell/coordinate.mjs` and/or the naming/spawn
  helper it calls) — edit S1. Confirm the exact file at build time; do not touch the pure core.

No other files. Keep `npm test` green; S1 lives in `src/shell`, outside the core boundary scan.

## The edits

Flat prose for the skills, matching each skill's register; each cites the T19 friction it closes.
Continue T24's edit numbering (C1–C6, W1–W4 are T24's).

### Coordinator — `skills/pir-coordinate/SKILL.md`

**C7 — Launch the bin exactly once; the wrapper's immediate exit is expected.** State the launch
verbatim: run the bin in the background *either* with the tool's `run_in_background` *or* a trailing
`&`, never both. The wrapper shell returns `exit 0` immediately — that is normal and does **not** mean
the bin died; the bin is the detached `node` process. Confirm once with `pgrep -fl "coordinate.mjs
{slug}"` if unsure, and never launch a second bin. (T19 finding 1.)

**C8 — Once the Monitor is armed, act on its events; do not `sleep`-poll.** Strengthen T24's C3: after
you arm the flow-log Monitor, do not run blocking `sleep` polls of the log or outbox — react to Monitor
events and inbound worker messages, and read the log once per event to get the new line, not on a
timer. (T19 finding 2: six `sleep` polls that duplicated the Monitor.)

**C9 — Relay a worker's question or decision to the PM and wait.** State: when a worker sends
`kind=question` or `kind=decision` (over whatever transport T25 lands), surface it to the PM and hold
that task until an answer arrives via the control `answers` file or the PM's reply; do not let the run
proceed on a guess in the worker's place. (T19 finding 3, coordinator half; the path T21 exercises.)

**C10 — Report at the milestones, not after every event.** State: report to the PM at run start, at
completion (the `promote`/HALT line, per C2), and whenever a decision or failure needs them — not a
recap after each spawn/merge/close. The flow log is the running record; the PM does not need it
narrated. (T19 optimization c: a status paragraph after nearly every event.)

### Worker — `skills/pir-worker/SKILL.md`

**W5 — Ask on a genuine ambiguity; do not silently pick.** Into the "what you talk to the coordinator
about" section: if the task spec is genuinely ambiguous — especially anything a user would see, such as
exact file contents — send the coordinator `kind=question` with the choices and wait for the answer
before committing; do not guess and move on. The coordinator relays it to the PM (C9). (T19 finding 3:
the trailing-newline flip-flop that converged only by luck.)

### Spawn message — `src/shell` (S1, only if T25 did not already do it)

**S1 — Name the coordinator's reply address in the spawn message.** The bin already knows its own
session name; include it in the prompt each worker is spawned with, so the worker knows whom to report
to without waiting for the hello. Keep the hello as the channel-open cue, not the sole carrier of the
address. Add or extend a test that the generated spawn message contains the coordinator name. (T19
finding 4: the hello-timing race.) **Check T25 first:** if the transport redesign already carries the
reply address into the spawn, this edit is done — drop it and note that in the commit.

## Tests

- [ ] `npm test` stays green. C7–C10 and W5 are prose and touch no code. S1 is a `src/shell` change
      outside the core boundary scan; it gets a unit test that the spawn message carries the coordinator
      address. A red boundary scan means an edit strayed into the pure core.

## Done when

- [ ] C7–C10 and W5 are applied to the two skill files, flat prose, each landing next to the rule it
      clarifies rather than as an appendix.
- [ ] S1 is applied to the spawn-message source with a test (or dropped as subsumed by T25, noted in
      the commit), and the exact file is recorded in the commit.
- [ ] No edit contradicts `DESIGN.md`, T24's or T25's edits, or the other skill.
- [ ] `npm test` green.

## After this task

Not self-verifying. Once T26 is reviewed ✅, the remaining live fixtures (T20–T23) are its proof: they
are gated on T26 and run attended, one at a time. Watch that the coordinator never fears an orphaned bin
(C7), stops sleep-polling once the Monitor is armed (C8), and reports only at milestones (C10); that
**T21 (human-decision) sees the worker actually raise `kind=question`** and the coordinator relay it
(C9/W5); and that no worker is left without a reply address on a fast task (S1, unless T25 handled it).
The remaining fixtures (T20–T23) are gated on T26 so none runs until this hardening is in. The
relay-middleman cost is handled by T25 (built first), not here.
