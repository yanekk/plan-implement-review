# T02 — single-flow

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of a single run: ids, the name rule, session names, the opening instructions, the
report parser, the red message, the PROGRESS cell, and `decideSingleStep`, which decides every
transition of a run from setup to `ready` or `dropped`, including red rounds and the baseline. Every
later task executes or paints what this returns, so the whole of DESIGN §2.4–§2.7 is proven here.

## Design sections this implements

DESIGN §2.4, §2.5, §2.6 (names, instructions), §2.7, §2.8 (PROGRESS cell), §2.11 (resume decisions), §3.3, §3.5 (state shape).

## Files

- `src/core/singleflow.mjs` (new), `src/core/singleflow.test.mjs` (new)
- `src/core/runrecord.mjs`, `src/core/runrecord.test.mjs` (`kind: 'single'`)

## Interface

```js
export const SINGLE_ID_RE = /^single-[0-9a-f]{4}$/;
export const RED_LIMIT = 3;
singleIdFrom(hex4) → 'single-' + hex4          // throws on anything but four lowercase hex
isValidSingleName(name) → boolean               // kebab-case, not single-{hex4}, not plan-{hex4}
singleSessionName({ repo, run, step }) → '{repo} / {run} / single / builder|reviewer'   // step 'build'|'review'
builderInstruction({ reportsDir, base, baseSha, prompt, setupNote = null }) → string   // DESIGN §2.6, verbatim
reviewerInstruction({ reportsDir, name, base, baseSha, prompt }) → string
parseSingleReport(text) → { kind: 'built'|'reviewed'|'dropped', name: string|null, body } | null
  // header `[pir:v1 kind=… single=…]` on the first line only; `single=-` → name null, allowed only for dropped
redMessage({ sha, reason, round, logPath, tail, baseline, base, baseSha }) → string   // DESIGN §2.5, both forms
initialSingleState({ id, prompt, base, baseSha, commands }) → state   // DESIGN §3.5 fields
decideSingleStep(state, facts) → { state, actions }                    // DESIGN §3.3 action list
  // facts: { reports: [parsed], checks: { ok, failures: [text] } | null, idle: bool, live: bool,
  //          exited: bool, commandDone: { kind: 'setup'|'tests'|'baseline', ok, half, reason, logPath, tail, head, clean } | null,
  //          renamed: { branch, worktree, control, index }, resume: bool }
singleProgress(runState) → string                                      // DESIGN §2.8 PROGRESS cell
```

`runrecord.mjs`: `KINDS` gains `'single'`; parse and serialize round-trip it.

## Tests

- [ ] ids, names: `single-3fa2` valid id; `singleIdFrom('XYZ')` throws; `fix-typo` valid name; `single-3fa2`, `plan-3fa2`, `Fix`, `a--b` invalid
- [ ] instructions match DESIGN §2.6 text exactly, with and without a setup note
- [ ] parseSingleReport: each kind; `single=-` only for dropped; prose without header → null; header not on line 1 → null
- [ ] fresh state → runSetup; setup: [] → spawn build at once; setup failed → spawn build with the note
- [ ] built report → check; failed check → send the failure once (same failure not re-sent), step unchanged
- [ ] passed check → runTests with the head; green + same head + clean → closeWhenIdle, then rename sub-steps in order, then spawn review
- [ ] green but head moved or dirty → runTests again
- [ ] first red → runBaseline, then send redMessage round 1 with the baseline line; later reds reuse the baseline
- [ ] rounds 1–3 plain; round 4 and 5 carry the past-limit line; rounds counted per step (review starts at 0)
- [ ] reviewed report → check → tests → green → closeWhenIdle → finish ready
- [ ] dropped in build and in review → closeWhenIdle → finish dropped
- [ ] a report of the other step's kind is ignored; session exits with no report → exitCrashed
- [ ] resume: half-done rename finished first; `running: 'tests'` restarts the tests; otherwise resumeSession with the step's last session id
- [ ] singleProgress: every cell in DESIGN §2.8, including `(red 2)`
- [ ] runrecord round-trips kind single; an unknown kind is still rejected

## Done when

- [ ] `singleflow.mjs` exports the interface and the boundary test passes
- [ ] every rule in DESIGN §2.4, §2.5, §2.7 has a test
- [ ] `npm test` green
