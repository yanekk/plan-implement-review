# T05 — pir-coordinate guardrails, receipt loop, name check

**Phase:** 2 · **Runs:** auto · **Depends on:** T00, T02, T03 · **Weight:** medium

## Goal

Rewrite the parts of the coordinator skill that let it destroy a correct run. It must read a
hand-driven task's completion as trusted evidence, never police the engine's merges or reach for
the kill switch on suspicion, confirm a decision it sent down was actually received, and check its
own session name at startup. This is the coordinator half of DESIGN §2.1, §2.3, §2.4, §2.5 and
§2.7.

**Note (added 2026-09-18, commit 2ed7ff9):** the §2.4 guardrail — the coordinator never creates the
HALT file — was already added to `skills/pir-coordinate/SKILL.md` (its "rails you must honour"
kill-switch bullet) and deployed, ahead of this plan, so the plan could be run safely by a coordinator.
**Verify it is present and extend it; do not re-add it.** The rest of T05 (the `verified` signal, the
no-merge-policing rule, the receipt loop, the name gate) is untouched by that early change.

## Design sections this implements

DESIGN §2.1 (read the `verified` signal), §2.3 (do not police merges; absence of an `answer` for a
`you` task is not evidence it did not happen), §2.4 (the kill switch is the user's), §2.5 (confirm,
retry, or surface a down-send), §2.7 (startup name check).

## Files

- `skills/pir-coordinate/SKILL.md` — the loop steps, the "What you may not claim" area, the
  down-send contract, and documenting the enforced first-run name gate.
- `src/shell/coordinate.mjs` — the startup name gate itself (machine-enforced, §2.7): read the
  coordinator's own name (`$CLAUDE_CODE_SESSION_ID` matched in `claude agents --json`, FINDINGS
  2026-09-17), validate it with T03's `validateCoordinatorName`, and refuse to launch under an
  off-convention name, printing `expected`.
- `src/shell/coordinate.test.mjs` — the gate's unit test, over a fake session list and environment.

## Interface

Prose changes, each pinned to a DESIGN rule:

```
- The `verified Txx` flow line + its `kind:"verified"` feed entry (T02) is the trusted, designed
  completion of a you-task. Report it to the user as done; never treat a you-task's merge as
  suspect. (§2.1)
- Never brand an engine merge as fraud, never re-audit a merged commit to decide whether it "really
  happened", never freeze the run over a surprising merge. A genuinely unexpected merge is a
  question for the user, not grounds to act. (§2.3)
- A you-task completes with NO `answer` from you and NO `surface`. The absence of an `answer Txx`
  for a you-task is its designed shape, not evidence it did not happen. Do not infer "never asked"
  = "never done". (§2.3)
- You never create the HALT kill-switch file. It is the user's stop. A problem you can see is
  surfaced to the user as a decision; the user decides whether to stop. (§2.4)
- A down-send is done when CONFIRMED RECEIVED, not when queued: after SendMessage, watch for the
  delivery notice T00 documented; if none arrives in the fallback window, re-read the outbox line
  and send again; if the worker is gone after a retry, surface the failure to the user in plain
  English. Never report a decision delivered without evidence it was. (§2.5)
- First-run gate (machine-enforced in the bin, §2.7): at startup the bin reads its own session name
  (`$CLAUDE_CODE_SESSION_ID` matched in `claude agents --json`), validates it with
  validateCoordinatorName from T03, and refuses to launch under a `/` or off-convention name,
  printing the validator's `expected`. The skill documents this and how to relaunch; it does not
  perform the check by hand.
```

Where T00 found no observable receipt notice, the §2.5 wording keys on its absence instead —
follow what T00 recorded in `FINDINGS.md`, not this sketch.

## Tests

Mostly prose (read-through plus the live drill, T07); the startup name gate is code and is
unit-tested under `npm test`:

- [ ] The skill tells the coordinator to read `verified Txx` as the trusted completion of a you-task.
- [ ] The skill forbids creating the HALT file and forbids branding a merge as fraud, in those words.
      (The HALT-forbid half is already present from 2026-09-18 — verify it, add the merge-fraud half.)
- [ ] The skill states that a you-task has no `answer` and no `surface`, and that the absence of an
      `answer` is not evidence the task did not happen.
- [ ] The receipt loop (confirm / retry / surface) is spelled out and matches what T00 found about
      the delivery notice.
- [ ] The bin's first-run name gate refuses an off-convention self-name and prints `expected`, and
      lets the correct name through — unit-tested over a fake session list and environment (`npm test`).
      The skill documents the enforced gate; it does not perform the check itself.
- [ ] No other coordinator behaviour is loosened — the existing ceiling, serialized-merge, and
      "user owns every decision" rules stay intact.

## Done when

- The coordinator can no longer, by its instructions, create the kill switch or treat a merge as
  fraud; it reads `verified Txx` as trusted; it confirms a down-send. The bin refuses to launch
  under an off-convention name at startup (machine-enforced, unit-tested), and the skill documents it.
- Every changed rule cites its DESIGN section.
- The receipt-loop and spawn-flag wording match T00's findings and T02's signal — check them
  against each other before marking done.
