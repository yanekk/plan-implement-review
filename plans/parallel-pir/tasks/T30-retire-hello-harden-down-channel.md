# T30 — Retire the `hello`; notice failed down-sends; pin the send contract

**Phase:** 7 (post-completion hardening) · **Depends on:** T23 · **Weight:** medium · **Runs:** auto
· **Live confirmation:** a `you` re-run of the review-queue fixture (see *Done when*)

## Why this exists

Three findings from the T23 reflection (2026-09-14, FINDINGS), decided with the PM into one task.

- **A — the `hello` earns nothing.** At spawn the coordinator sends each worker a one-line
  `[pir:v1 kind=hello task=Txx]` message whose only job was to confirm the down-channel was open before
  an answer might need to travel it. Since T25 the worker never replies up that channel (it drops a file
  into `control/reports/`), so the original "the reply rides the return socket" rationale (T13) is already
  gone (DESIGN §2.2 says as much). The T23 run then proved the hello is not load-bearing: both hello sends
  *failed* (ENOENT/409) because HALT fired before the coordinator drained its outbox, and both workers
  still picked the right task and built the right thing **from the spawn prompt alone**. The T21 and T22
  runs separately proved the coordinator can deliver a real decision to a worker with no prior hello. The
  hello is a start-up ping nothing depends on, and a moving part that can fail silently.

- **C — a failed down-send goes unnoticed.** When a SendMessage fails, nothing detects it; the message is
  just not delivered. With the hello gone, the only remaining down-send is the **answer to a parked
  worker** — the one message that genuinely matters (your decision reaching a blocked worker). It must not
  fail silently.

- **E — the send contract is not pinned.** In the T23 run the coordinator sent SendMessage with five keys
  (`to`, `message`, plus `recipient`/`content`/`type`) though only `to`/`message` are read. The rule is
  already written in `pir-coordinate` ("those two fields and no other") yet the model padded it — so E is
  about making the instruction unmissable, not adding it.

## What "done" must behave like

**A — retire the hello (clear, one right answer).**

- No hello is sent at spawn. Remove `sendHello` and its two call sites in `loop.mjs` (the implementer
  spawn and the fresh-reviewer spawn), and the `record('hello', …)` it writes. The down-channel for
  **answers** is untouched — that path must keep working.
- The `hello` flow tag leaves the vocabulary. The flow log of a normal run then contains **zero** `hello`
  lines, and a run still reaches its terminal state (promote / halt-close) exactly as before.
- The worker skill no longer tells the worker to expect or ignore a hello; the coordinator skill no longer
  sends or logs one. The coordinator's own name stays (it is still the identity in `claude agents --json`
  and the address the coordinator sends answers *from*/*to*), but its "passed to the worker in the hello"
  rationale goes.
- The harness fact `helloPerSpawn` is retired. Replace it with **`noHelloEver`** — the flow log contains
  no `hello` line — so the fixtures assert the retirement positively rather than dropping the check. Every
  fixture that declared `helloPerSpawn` moves to `noHelloEver` (or drops it where a sibling fixture already
  carries it); the promote-terminated fixtures keep proving the run still promotes.

**C — notice a failed down-send.** When the coordinator's answer send fails (SendMessage returns an error,
or the worker is gone), it must not be silent:

- Record a `send-failed Txx` flow line (new tag in the vocabulary) so the failure is visible in the flow
  log and capturable by the harness.
- Surface it to the user in plain English ("couldn't reach worker Txx to deliver your decision") rather
  than dropping the answer.
- Keep / tighten the existing outbox re-read fallback (T22) as the delivery retry: the answer stays queued
  and is re-attempted, and only a genuinely unreachable worker produces the surfaced `send-failed`. The
  bin already owns the answers/outbox files; the agent performs the send, so this is part prompt
  (the coordinator noticing its own SendMessage error) and part vocabulary (`send-failed` + the fallback).

**E — pin the send contract.** State in `pir-coordinate`, unmissably, that a down-send is **exactly**
`SendMessage({to, message})` and carries no other keys — no `recipient`, `content`, or `type`. One
worked example, and a one-line "do not add fields" so the model stops padding.

## Files (confirm at build time)

- `src/shell/loop.mjs` — remove `sendHello`, both call sites (≈247, ≈278), the `record('hello', …)`
  (≈138–141), and the header comment block about the hello opening the return channel (≈131–136). The
  no-send-half path (loop.test's id-mismatch case) already tolerates no send.
- `src/shell/coordinate.mjs` — drop the hello from the outbox/relay handling and its comments (≈188–192,
  ≈265, ≈636–638); add the failed-send detection/surface + `send-failed` flow line to the answer
  down-send path.
- `src/shell/harness/assertions.mjs` — retire `helloPerSpawn`; add `noHelloEver` (flow has no `hello`
  line) and, for C, a `sendFailureSurfaced` check keyed on the `send-failed` tag; update the flow-tag list
  (drop `hello`, add `send-failed`).
- `src/shell/harness/fixtures*` — every fixture declaring `helloPerSpawn` → `noHelloEver`.
- `src/shell/loop.test.mjs` / `src/shell/coordinate.test.mjs` — remove the T13 hello tests (≈403–427),
  keep the answer-delivery tests, add C's deterministic test (a dropped first send → the fallback
  delivers and the failure is recorded).
- `skills/pir-coordinate/SKILL.md` — remove the hello sections (≈18, 65, 231–253); pin the two-field send
  contract (E, near ≈215); add the failed-send surface behaviour (C).
- `skills/pir-worker/SKILL.md` — remove "You may receive a `hello`…" (≈128–136) and the naming note that
  the coordinator name is for the hello (≈194–196).
- `plans/parallel-pir/DESIGN.md` — §2.2 (retire the hello / down-channel open-check, lines ≈125–130), the
  return-channel references (≈351–352), the capture flow-tag lists (≈602, 618, 630, 636) and the
  comms-protocol decision (≈857–861): the down-channel is opened lazily by the first real answer, addressed
  by name; a failed send is surfaced, not silent. Record the change and its rationale.
- `plans/parallel-pir/TEST-HARNESS.md` — the fixtures' facts now say `noHelloEver` (not `helloPerSpawn`);
  note the `send-failed` tag.

## Tests

- [ ] `loop.mjs`: a spawn sends **no** hello; the flow log has no `hello` line; the answer down-send still
      fires. (Mutation: re-adding `sendHello` does not reintroduce a `hello` flow line the fixtures accept.)
- [ ] `assertions.mjs`: `noHelloEver` passes on a hello-free flow and **fails** on a flow containing a
      `hello` line; `sendFailureSurfaced` passes when a `send-failed` line is present for an undelivered
      answer.
- [ ] C: a fake-platform test where the first answer send is dropped — the outbox fallback re-delivers,
      the worker unblocks, and a genuinely unreachable worker instead yields a recorded `send-failed`.
- [ ] `npm test` green; the boundary scan green (no clock/network/randomness in the core).

## Done when

- [ ] No hello is sent or logged anywhere; the down-channel for answers still delivers; `noHelloEver`
      replaces `helloPerSpawn` across the fixtures.
- [ ] A failed answer down-send is recorded (`send-failed`) and surfaced to the user, with the outbox
      fallback as the retry; C's test is green.
- [ ] The `pir-coordinate` send contract is pinned to `{to, message}` only (E).
- [ ] DESIGN, TEST-HARNESS, both skills and the tests are updated; `npm test` and the boundary scan green.
- [ ] **Live confirmation (a `you` re-run, attended).** Re-run the **review-queue** fixture live
      (`node src/shell/harness/run.mjs review-queue --into <dir>`): `noHelloEver` green, the run still
      promotes once, and the coordinator's transcript shows clean two-field sends (E). Record the verdict +
      bundle in FINDINGS. This is the "fixture that confirms the fix"; A and E are confirmed here, C is
      confirmed by its deterministic test above (a live send failure cannot be forced on demand).

## Note on structure

Built and fresh-reviewed as an `auto` task (the code change is what needs the fresh eyes), then closed by
the attended live re-run above — mirroring how a Phase-6 fixture confirms an `auto` hardening task
(T24→T19, T26→T20/T21, T29→T23). If the PM would rather split the live re-run into its own `you` task,
that is a one-line change to PROGRESS.
