# T13 — Prove the worker↔coordinator comms protocol: by-name addressing, idle-gated close

**Phase:** 3 · **Depends on:** T12 · **Weight:** medium · **Runs:** auto (with a hands-on live half)

## Goal

Before the full T10 drill, prove — small and seatbelted — the two coordinator↔worker communication
behaviours the earlier work could only build and defer. T12 closed the six drill gaps against the
fakes but left the real message *reliability* to T10; the user chose to settle it in its own task
first, so T10 inherits a comms protocol already shown to work rather than discovering it mid-drill.

Two problems, decided with the user (2026-09-10) and landed here:

1. **A worker reaches the coordinator BY NAME, reliably** — not by luck of a return socket. Today
   nothing makes the coordinator's own session take the convention name `{repo} · {plan}`: the
   harness named the drill's coordinator `pir-t10 / pir-coordinate scratch`, a shape that even
   contains `/`, which `SendMessage` rejects in a target name (§2.8, FINDINGS 2026-09-07). The
   worker's first message arrived anyway over the worker's return socket (`uds:/tmp/cc-socks/…`,
   FINDINGS 2026-09-10), but that is a fallback to lean on by accident, not a protocol. Make
   by-name addressing deterministic and prove it.
2. **The coordinator never kills a worker before it is idle after finishing its task.** Close is
   `claude stop` then SIGTERM the pid (platform.mjs, FINDINGS 2026-09-09); firing it while the
   worker is still mid-turn can interrupt or lose work. FINDINGS 2026-09-09 already caught the
   file-watcher closing a worker mid-*commit* and losing its work (fixed by watching the committed
   row); this is the session-*idle* analogue of the same hazard. Gate every close of a finished
   worker on the agent list showing it idle.

This is a small task: two behaviours, their fakes tests, and one seatbelted live verification. It is
not a rework of the loop.

## Design sections this touches (PM-decided 2026-09-10 — this task lands the edits)

- **§2.2** (the two directions): the coordinator sends each freshly-spawned worker a one-line
  **hello** so the worker→coordinator channel is confirmed open before anything relies on inbound.
- **§2.3** (the worker lifecycle — close): close waits for the worker to be **idle** after it
  finishes its task; only a worker that has left the agent list (dead) or the kill switch closes a
  session that is not idle.
- **§2.8** (naming and addressing): the coordinator **runs under the deterministic name
  `{repo} · {plan}`** so a worker's by-name message resolves, and it passes that real, addressable
  name to each worker at spawn. Record how the coordinator session comes to carry that name.

These are the PM's decision; implement them and update DESIGN §7's decision log with the date and
the reason. If, while building, any of the three turns out to need a *different* rule than the one
above (e.g. the coordinator session genuinely cannot be made to carry the name), STOP and raise it
with the PM — do not invent a fourth rule to get unblocked.

## Problem A — worker → coordinator, by name

The convention (§2.8): the coordinator is `{repo} · {plan}`; a worker builds that string itself to
message home. The gap: nothing makes the coordinator's session actually *have* that name, and the
harness-given name may be `SendMessage`-invalid.

- **Do (decide the mechanism and prove it live):**
  - Make the coordinator session addressable as `{repo} · {plan}`. The most likely route is that the
    coordinator is launched with `claude --bg -n "{repo} · {plan}"` — the same `-n` workers use
    (§2.8, T00) — so `claude agents --json` shows it under that name and `SendMessage` resolves it.
    Confirm whether a running `/pir-coordinate` session can take that name, or whether the
    `pir-coordinate` skill must instruct the user to launch the coordinator so. Document the answer.
  - **Belt-and-suspenders:** the coordinator sends each freshly-spawned worker (both an implement
    spawn and a review spawn) a one-line `[pir:v1 kind=hello task=Txx]` message at spawn, carrying
    the coordinator's own addressable name. This opens the return channel — FINDINGS 2026-09-07: a
    worker's *reply* rides the sender's return socket reliably — so even if by-name first-contact
    were flaky, a worker has a proven channel. The worker ignores a hello otherwise (pir-worker).
  - Update `pir-worker` (it already addresses by name; add that it may receive and ignore a hello,
    and may reply on it) and `pir-coordinate` (how the coordinator is named/launched), and DESIGN
    §2.2/§2.8.
- **Acceptance (build / fakes):** the loop sends a hello to every worker it spawns this pass
  (implement and review); a test asserts the fake's `sent` carries a `hello` per freshly-spawned
  session, addressed by the worker name, and that a worker's normal messages still drive the loop.
  The coordinator's addressable name is built with `coordinatorName` and used at launch in the bin.
- **Needs a person (live, scratch, ceiling 1):** a real worker sends a message to the coordinator by
  the convention name `{repo} · {plan}` and it arrives at a coordinator session that was launched
  under that name; and the coordinator's hello reaches the worker. This is the piece the drill left
  unproven for a *correctly-named* coordinator.

## Problem B — idle-gated close

Today the loop closes a finished worker as soon as it reports implemented/done (loop.mjs 3c/3e).
`claude agents --json` reports each session's `status` (idle/busy) and `state` (working/done)
(FINDINGS 2026-09-07), and `parseAgents` already carries `status`/`state`.

- **Do:** before closing a **finished** worker — a merged worker, or an implementer being handed to
  a fresh reviewer — require the agent list to show it idle (not `busy`/`working`). If it is still
  busy, **defer the close to a later pass** rather than SIGTERM it mid-turn; the slot stays held
  until it is safe to close. Two carve-outs keep their current behaviour: a **dead** worker (already
  gone from the list) is cleaned up immediately — that is not a mid-work kill — and the **kill
  switch** closes every worker regardless of idleness (a hard stop, §2.4). Note the review handoff
  briefly holding CEILING+1 (FINDINGS 2026-09-09) becomes cleaner: the implementer is closed only
  once it is idle.
- **Acceptance (build / fakes):** a fake worker scripted `busy` for one pass then `idle`: the loop
  does not close it while busy and closes it once idle; a test asserts no close fires against a busy
  finished worker, and that the kill-switch path still closes a busy worker.
- **Needs a person (live, scratch, ceiling 1):** confirm a real worker reporting done is not
  SIGTERMed until the agent list shows it idle (its commit/turn completed), so no work is lost.

## Files (expected — the implementing session confirms)

- `src/shell/loop.mjs` — hello after each spawn/review (or the coordinate.mjs wrapper, whichever
  keeps loop.mjs's tests intact); idle-gate the close, reading `status`/`state` from the live list.
- `src/shell/coordinate.mjs` — compute the coordinator's addressable name and use it when launching;
  the bin.
- `src/shell/platform.mjs` — surface `status`/`state` to the close decision (already parsed).
- `src/shell/fake/platform.mjs` — a scriptable `busy → idle` worker; record the hello.
- `skills/pir-worker/SKILL.md`, `skills/pir-coordinate/SKILL.md` — the protocol and the launch name.
- `plans/parallel-pir/DESIGN.md` — §2.2, §2.3, §2.8 and the §7 decision log.
- The matching `*.test.mjs` for each.

## Done when

- [ ] Every freshly spawned worker (implement and review) gets a coordinator hello (fakes test).
- [ ] A finished worker is not closed while the agent list shows it busy; it is closed once idle; a
      dead worker and the kill switch still close immediately (fakes tests).
- [ ] The coordinator runs under `{repo} · {plan}`, and the bin / `pir-coordinate` skill state how it
      comes to carry that name.
- [ ] DESIGN §2.2/§2.3/§2.8 and the §7 log carry the three decided rules.
- [ ] `npm test` green; every fix provable against the fakes has a test.
- [ ] LIVE, with the user (scratch, ceiling 1): a real worker reaches the coordinator **by name**;
      the coordinator's hello reaches the worker; a finished worker is closed **only once idle**.
      Recorded in `FINDINGS.md` with the date.

## Needs a person

The live confirmations above use real agents, so they are verified with the user on the scratch
harness (`/Users/jan.krolikowski/src/pir-t10`), seatbelted: scratch plan, ceiling 1, kill switch
wired. The automated half is provable against the fakes; the live half proves the protocol and
de-risks the full T10 drill.
