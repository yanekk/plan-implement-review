# T25 — Cut the coordinator's relay overhead in the worker→bin path

**Phase:** 6 · **Depends on:** T19 · **Weight:** heavy · **Runs:** auto (surfaces the design choice to the PM — see *A decision may be yours*)

## Goal

The T19 bundle showed the run's single largest avoidable cost: the coordinator acts as a **manual relay**
between the workers and the loop. A worker reports by `SendMessage` to the coordinator *agent*; the loop
logic, though, runs in `coordinate.mjs` — an ordinary child process with no message inbox of its own
(DESIGN §2.2, and the architecture note that the bin "is an ordinary child process and no [inbox]"). So
the coordinator agent hand-encodes each inbound worker message into the bin's `inbox` file (a Write-a-
temp-file → append recipe) and the bin polls that file. Measured across T19, this relay added roughly
70–90 seconds — about **20–25% of the ~6-minute run** — of a slow LLM agent sitting in the path of every
routine handoff (`implemented`, `done`), doing nothing but re-encoding a message the bin will read.

This task removes, or sharply reduces, the agent from that hot path, so routine worker→bin handoffs cost
near-zero wall-clock and no LLM turn. It changes machinery (and probably a design rule), so unlike the
prompt-hardening task (T26) it is a real `src/` change with tests, and it runs **before** T26 so T26's
prose can describe the transport this task leaves in place.

## The hard constraint that shapes the design

`SendMessage` is **agent-only**: a plain Node process cannot receive it (FINDINGS 2026-09-07; DESIGN
§2.2). That is the whole reason the file bridge exists — the coordinator agent is the only thing that can
*receive* a worker's `SendMessage`, and the bin is the only thing that runs the loop. Any redesign has to
respect this: either keep the agent as receiver but make the relay cheap, or move routine reporting off
`SendMessage` entirely so the bin can ingest it directly.

## Candidate directions (not a decision — the builder investigates and picks)

1. **Workers report by writing a file the bin already polls, not by messaging the agent.** Routine
   `implemented`/`done` reports become an append to a control file the bin reads, removing the agent from
   the routine path completely; the agent stays only for what genuinely needs it — surfacing a
   `question`/`decision`/`conflict` to the PM. **Open problem to settle first:** a worker runs in its own
   task worktree (`pir/{plan}-T{nn}`), a separate working tree from the coordinator's feature worktree
   where `plans/{slug}/.parallel/control/` lives. Establish whether a worker can reach that control dir
   (a known absolute path, a shared location, or a git-branch drop) before committing to this.
2. **Keep `SendMessage` as the transport but make the relay one cheap step.** Collapse the Write-temp +
   append recipe into a single append the coordinator can do per message, and relay on the Monitor event
   rather than on a timer (this half overlaps T26's C8; coordinate so they do not fight). Smaller win,
   no worktree-reachability question, low risk.
3. **A hybrid:** routine reports go direct to the bin (direction 1); only PM-facing surfaces ride the
   agent (`SendMessage`). Likely the best of both, if direction 1's reachability holds.

The point is to cut the overhead, not to pick a favourite here. Weigh each against the constraint above
and the worktree-reachability finding.

## A decision may be yours (surface to the PM)

If more than one of these is genuinely defensible after investigation — especially if direction 1
requires a change to *how workers report* (a change to the worker contract, DESIGN §2.2's "worker →
coordinator" rule, or the wire protocol) — **stop and put the choice to the PM** before building, one
option at a time with its cost, per CLAUDE.md. Changing the transport rule in `DESIGN.md` is a design
decision, not a silent implementation detail. If the investigation shows only direction 2 is safe (e.g.
worktrees cannot reach the control dir), take it and say so — no decision needed.

## Files (confirm at build time)

- `src/shell/coordinate.mjs` — the bin loop and its inbox handling.
- `src/shell/loop.mjs` — the loop core, if the report ingestion moves.
- `skills/pir-coordinate/SKILL.md` and possibly `skills/pir-worker/SKILL.md` — if reporting changes for
  either side. (Coordinator prose is T26's job; here, change only what the *mechanism* forces.)
- `plans/parallel-pir/DESIGN.md` §2.2 — if the transport rule changes (only after the PM decides).
- Tests alongside whatever changes.

Do not touch the pure core (the boundary scan must stay green); the transport lives in `src/shell`.

## Tests

- [ ] `npm test` green, including new tests for the chosen transport (a worker report reaches the loop
      without the agent re-encoding it, or the single-step relay does what the two-step one did).
- [ ] The boundary scan stays green — no clock/network/randomness pulled into the core.

## Done when

- [ ] Routine worker→bin handoffs no longer require the coordinator agent to re-encode each message (or,
      if only direction 2 proved safe, the per-message relay is one step and event-driven).
- [ ] Any transport-rule change is reflected in `DESIGN.md` §2.2 and was decided with the PM.
- [ ] `npm test` and the boundary scan green.

## After this task

Not self-verifying: a transport change is only proven under real agents. Its proof is **T26 followed by
the live fixtures** (T20–T23), all gated behind it. Watch a live run for the relay overhead being gone —
the seconds between a worker's `implemented`/`done` and the bin's next action should collapse from the
~12–26s T19 showed to near-zero. T26 then updates the coordinator/worker prose to match whatever this
task lands; the fixtures run last, on the final machinery.
