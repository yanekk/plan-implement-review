# T14 — conflict-resolve-prompt

**Phase:** 4 · **Runs:** auto · **Depends on:** T05 · **Weight:** medium

## Goal

When the coordinator hits a merge conflict at its own merge step, make it hand the **person** a
ready-to-paste resolution prompt — not just surface which worker is parked. The worker that built the
losing branch has no idea a conflict happened (it finished cleanly and went idle; the clash is on the
coordinator's side, and the down-channel that once pushed the decision down is gone — §2.2). Today the
person has to reconstruct the whole situation and the git steps by hand before briefing that worker
(§2.8). This task has the coordinator compose that briefing and show it, so the person copies it,
attaches to the named worker in `claude agents`, and pastes it.

**The human is still the transport.** The coordinator emits *text on its own display*; it sends nothing
to the worker. No down-channel is revived (§2.2).

## The one thing the coordinator cannot fill in

Which side of the conflict to keep is the human judgement that made the conflict stop for a person in the
first place. So the prompt carries the mechanical scaffold and leaves the resolution choice as a marked
blank for the person to complete before pasting. The coordinator knows the parked worker, its task
branch, the feature branch (`pir/{slug}`), and the conflicting files — everything except the decision.

## Design sections this implements

DESIGN §2.8 (a merge conflict parks the worker; the person resolves by attaching to it directly) and
§2.2 (no down-channel — the coordinator hands over text, the person carries it). Updates DESIGN §2.8 and
`docs/human-flow.md` to record that the coordinator now offers a copy-paste resolution prompt.

## Files

- A pure prompt builder (new helper in `src/core/`, e.g. `conflict.mjs`) —
  `buildConflictPrompt({ task, workerName, featureBranch, files }) → string`. Pure, inputs as
  parameters (DESIGN § Architecture — the core takes no clock/IO). The string names the worker to attach
  to, tells it to merge `featureBranch` into its own task branch, lists the conflicting `files`, marks
  the keep-which-side choice as a blank for the person, and ends with commit → `npm test` →
  re-signal done.
- `src/shell/loop.mjs` — at the 3d conflict path (~514-522) and the restart-reconcile conflict path
  (~200-206), carry the built prompt on the parked task's `decision`/`surface` so the display can show
  it. (Correct the stale "routed down by `answer()`" comments here while touching them — the person, not
  a routed answer, drives the resolution.)
- `src/core/display.mjs` — render the prompt as a clearly delimited, copy-paste block on the conflicted
  worker's row/callout, keyed to that worker's `/`-separated name so the person knows where to paste.
- Tests: unit tests over `buildConflictPrompt` (names the worker, the branch, the files, leaves the
  choice blank, no resolution baked in); a display test that a conflicted row renders the prompt block.
- `DESIGN.md` §2.8 and `docs/human-flow.md` — record the copy-paste prompt.

## Interface

- `buildConflictPrompt({ task, workerName, featureBranch, files }) → string` (pure).
- The live display shows, on a conflicted worker's entry: the worker name to attach to, and the delimited
  resolution prompt with a blank for the keep-which-side decision.

## Acceptance criteria — done when

- [ ] On a coordinator merge conflict, the display shows both the parked worker to attach to and a
      delimited, ready-to-paste resolution prompt naming the feature branch and the conflicting files,
      with the keep-which-side choice left blank.
- [ ] `buildConflictPrompt` is pure and unit-tested; it bakes in no resolution choice.
- [ ] The stale "routed down by `answer()`" comments in `loop.mjs` are corrected.
- [ ] DESIGN §2.8 and `docs/human-flow.md` describe the copy-paste prompt.
- [ ] `npm test` is green.

## Note

This is headless-testable and lands before the live proof: T13 (attended-merge-conflict) depends on
this, and its live run is where a person actually copies the prompt, pastes it, and the worker resolves.
