# Progress

Update this whenever a task changes state. It is the handoff between sessions. What the build
teaches lives next door in [FINDINGS.md](FINDINGS.md).

Sixty words to a Notes cell, counted. Flat prose, no aphorism. The cell is the index; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-17 — 6 fixes, 2 decisions with the user (machine-enforced name gate; T09 self-wake spike added).

**Status:** Plan written 2026-09-17, no code yet. It fixes the parallel coordinator's blind spot
for hand-driven tasks (the fault that killed the `my-ender/print-vision` run) plus three related
faults: a fire-and-forget down-send, an off-convention coordinator name, and a coordinator that
goes idle and never delivers a queued answer (T08, §2.8, folded in 2026-09-17 after the same run
froze a second time). Scope settled with the user: real completion signal plus guardrails, full
hardening pass. Modifies the parallel-pir engine, the coordinator/verify skills, and `/docs`.
**Last updated:** 2026-09-17 (plan reviewed)
**Next `pir-work` will:** implement the next ready ⬜ — T02 or T03 (no dependencies, auto) — or the
user drives a T00 / T09 spike (`you`). Nothing is blocked.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.
`Runs`: **auto** = a worker builds it and a fresh session reviews it, no person needed.
**you** = the user drives it (a spike or a hands-on drill); no review session, the recorded
observation is the result.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Messaging-mode spike | you | — | ⬜ | Live: which `claude` flag makes a worker auto-accept a cross-session message, and whether a receipt notice is observable. Gates T01, T05. Throwaway. |
| T09 | Self-wake spike | you | — | ⬜ | Live: can a fully idle `--bg` coordinator wake itself on a cadence (harness scheduled wake, not a poll needing turns) and act? Names the mechanism T08 arms. Gates T08. Throwaway. |
| T01 | Worker spawn auto-accepts messages | auto | T00 | ⬜ | Add T00's permission flag to `spawnArgv` in platform.mjs. Argv test. Live confirmation is T07. |
| T02 | Hands-on completion signal | auto | — | ⬜ | Parse the verify report's two confirmations; emit `verified Txx` + a feed entry on a you-task merge. Never merges the two; auto tasks never emit it. |
| T03 | Coordinator-name guard | auto | — | ⬜ | `validateCoordinatorName` in naming.mjs: a `/` name invalid, the `·` form valid, always returns the expected name. Reuses existing helpers. |
| T04 | pir-verify writes the attestation | auto | T02 | ⬜ | The `done` report carries `machine:`/`person:`, matching T02's parser. `machine: none` for a pure look-check. |
| T05 | pir-coordinate guardrails, receipt loop, name check | auto | T00, T02, T03 | ⬜ | Read `verified` as trusted; never create HALT or brand a merge fraud; confirm/retry/surface a down-send; bin-enforced startup name gate via T03. |
| T06 | Update /docs | auto | T01, T02, T03 | ⬜ | The four changed behaviours as current behaviour across human-flow, run-lifecycle, task-state, control-folder, README. parallel-pir DESIGN sealed, untouched. |
| T08 | Coordinator delivery heartbeat | auto | T02, T05, T06, T09 | ⬜ | Harness-driven heartbeat delivers a queued answer even when the event watch is deaf or the coordinator idle. `delivered` feed + `deliver-overdue` tag; idempotent send. §2.8. |
| T07 | Capstone live drill | you | T01, T04, T05, T06, T08 | ⬜ | User + live sessions: hands-on task completes without a halt; down-send received with no prompt and confirmed; answer reaches parked worker with no manual ping on the heartbeat; slashed name caught at startup. ✅ FINDINGS row. |

**Coordinator queues (dependencies drive dispatch, not phase order):**
- First wave (no dependencies): T02 (auto), T03 (auto), T00 (you), T09 (you). T01 unblocks when T00 is ✅.
- T04 unblocks on T02; T05 on T00+T02+T03; T06 on T01+T02+T03.
- T08 unblocks on T02+T05+T06+T09 — the delivery heartbeat, built on the receipt loop, after the doc pass, and after T09 has proved the self-wake it arms.
- T07 (you) unblocks when T01, T04, T05, T06 and T08 are all ✅ — the live proof, last.

## Blocked on the user

Nothing yet. Three `you` tasks need the user when they are ready: the T00 and T09 spikes (early,
driving the messaging-mode and self-wake probes) and the T07 capstone (last, the live end-to-end
drill). All are bounded — scratch sessions and a scratch plan at ceiling 1, torn down after (DESIGN
§5.2). Each carries its own "Needs a person" block; under `pir-coordinate` the hands-on worker
presents it and waits.

**Review queue:** *(empty)*
