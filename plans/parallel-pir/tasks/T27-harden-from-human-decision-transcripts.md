# T27 — Harden the coordinator from the T21 transcripts

**Phase:** 6 · **Depends on:** T21 · **Weight:** medium · **Runs:** auto

## Goal

The `human-decision` fixture (T21, 2026-09-13) passed on real agents, and its reflection found the
decision path itself sound — but five friction points in the coordinator's loop. The PM chose to fix
four of them (candidates 1, 2, 4, 5; candidate 3, the harmless `SendMessage` field padding, was left —
the skill already forbids it and the model pads anyway, so more prose is unlikely to help). Four edits:
three are prose in `pir-coordinate`, one (candidate 4) is a small `src/shell/coordinate.mjs` change,
because a Node process cannot make the coordinator wake without a flow-log line to watch. It changes no
design rule. Like T24/T26 the prose half is **not self-verifying**: it is proven only by a live run,
which is the gated fixture queue that follows it (T22, T23, which both drive the coordinator skill).

## Design sections this implements

DESIGN §2.2 (the coordinator↔bin transport and the flow log it drives off), §2.5 (decisions routed
through the coordinator to the PM). No rule changes; the edits make the skill and the flow log teach
what these sections already require, and cut wasted coordinator turns.

## The four findings (from the T21 bundle `pir-t17-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`)

1. **`await-idle` woke the coordinator into no-op turns.** The bin logs `await-idle` while it holds a
   hand-off until a worker goes idle (internal bookkeeping, not a stall). The coordinator watched the
   flow log for bare growth, so each `await-idle` woke a full turn that only said "still holding" — ~4
   wasted turns this run, scaling linearly with task count.
2. **The coordinator surfaced a decision as a free-text end-of-turn message, not `AskUserQuestion`.** It
   worked only because a human was watching; it also used `AskUserQuestion` on the first run, so the
   behaviour was inconsistent. A blocking tool prompt makes the decision explicit and robust.
3. **No flow event when the bin queues an answer to the outbox.** After writing the answer to the
   `answers` file the coordinator had nothing to wake it, so it hand-polled the outbox/answers to notice
   the drain (~15s of manual polling in an otherwise event-driven loop).
4. **The coordinator re-paraphrased the worker's already-clear question** before showing it to the user
   (~18s), instead of forwarding the surfaced `message` text with minimal framing.

## What to change

- **`skills/pir-coordinate/SKILL.md`** (candidates 1, 2, 4):
  - The flow-tag list marks `await-idle` as internal bookkeeping — do not react to it, narrate it, or
    spend a turn on it; and adds the new `answer {task}` tag.
  - The Monitor is armed to wake on a **milestone** line (`spawn`/`answer`/`review`/`merge`/`surface`/
    `close`/`halt-close`/`promote`), not on bare log growth, so `await-idle` never wakes it.
  - Loop step 2 surfaces a decision with **`AskUserQuestion`**, forwarding the surfaced `message` text
    with minimal framing rather than re-paraphrasing it (candidate 5).
  - Loop step 3 waits for the `answer {task}` flow line, then delivers the queued outbox message like a
    hello — no hand-polling.
- **`src/shell/coordinate.mjs`** (candidate 4): `answer()` logs an `answer {task}` flow line after it
  queues the down-message, symmetric with the loop's `hello`. This is the coordinator's wake signal.

## Acceptance criteria

- `answer()` writes an `answer {task}` flow-log line when a decision routes down; a unit test asserts it
  (via an injected `control` that captures log lines).
- No design rule changes; `npm test` stays green.
- The `pir-coordinate` prose edits land next to the rules they refine, in flat prose, and name the T21
  run as their reason.
- Candidate 3 (SendMessage padding) is deliberately NOT addressed; the commit says why.

## Not self-verifying

The prose half governs live coordinator behaviour and is proven only by a live run. Its proof folds into
the next gated fixtures: T22 (merge-conflict) exercises the surfaced→`AskUserQuestion` path and the
`await-idle` filter; T23 (parallel) exercises the answer/hand-off cadence at ceiling >1. Do not claim
the prose works from the tests alone.

## Done when

Reviewed by a fresh session against the code, the flow-log contract, and this doc, then ✅. The live
proof is recorded when T22/T23 run.
