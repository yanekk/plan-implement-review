# T13 — brief-box

**Phase:** 2 · **Depends on:** T09, T12 · **Weight:** medium

## Goal

Bare `pir plan` opens a box to write the brief in, the way the person writes a prompt to Claude, and
both forms of `pir plan` land the person in the planner's conversation once the run starts. This is
the first thing the person sees of the feature.

## Design sections this implements

DESIGN §2.12, §2.13, prototype scenes 1–2.

## Files

- `src/shell/brief-box.mjs` (new), `src/shell/brief-box.test.mjs` (new)
- `src/shell/pir.mjs` (the real `openBriefBox`, and the landing for both forms), its test
- `src/shell/pir-tui.mjs` (open a run straight into a step's conversation; the `starting the planner…` wait)
- `src/shell/plan-rig.test.mjs` (end-to-end cases)

## Interface

```js
export function openBriefBox({ repo, tui, onSubmit, onCancel }) → Promise<void>
//   pi-tui Editor as the conversation view builds it; enter submits the trimmed text if non-empty;
//   shift+enter / ctrl+j newline; esc → onCancel
// pir.mjs: ['plan'] → planPreflight (T08) → refused: message, 1 → else openBriefBox → submit →
//   startPlanRun(brief) → openPlanner(runId); cancel → 0 with nothing created
// pir-tui.mjs: openPlanner(key) = openWatch with { openStep: 'plan' }; until the snapshot names the
//   planner session the view shows 'starting the planner…'; ← goes to the steps view
```

## Tests

- [ ] Empty and whitespace-only submit do nothing.
- [ ] A multi-line brief reaches `startPlanRun` with its newlines.
- [ ] Esc cancels with nothing started (spy never called).
- [ ] A pre-flight refusal prints before the box opens.

## Done when

- [ ] Every row passes in `npm test`.
- [ ] The end-to-end cases below pass under the T10 rig.

## End to end (the worker drives this)

- suite: `src/shell/plan-rig.test.mjs` · sizes: 80×24, 120×40
- [ ] `pir plan` → box with title and hint; type two lines with shift+enter; enter → planner's
      conversation opens showing the brief as pir's first message and then the fake planner's question.
- [ ] `pir plan "one line brief"` → lands in the same conversation, no box.
- [ ] `pir plan` then esc → back to the shell, exit 0, no branch `pir/plan-*` created.
- [ ] `pir plan` in a repo without `main` → refusal line, no box.
