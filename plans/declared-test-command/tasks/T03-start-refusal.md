# T03 — start-refusal

**Phase:** 2 · **Depends on:** T01 · **Weight:** light

## Goal

A plan whose DESIGN.md has no valid block counts as not reviewed: `pir {slug}` and the coordinator bin
refuse it before anything is spawned, including on a restart and a dry run, and say how to fix it.

## Design sections this implements

DESIGN §2.2, §2.3.

## Files

- `src/shell/coordinate.mjs` — `readTestBlockGate`, the check in `main` right after the review gate
- `src/shell/launch.mjs` — `startRun` reason `no-test-block`
- `src/shell/pir.mjs` — the message for it
- matching `*.test.mjs`

## Interface

```js
// readTestBlockGate(slug, { root = process.cwd() }) → parseTestBlock(<root>/plans/<slug>/DESIGN.md);
// a missing file → { ok: false, reason: 'no DESIGN.md' }.
export function readTestBlockGate(slug, opts) {}

// launch.startRun → { started: false, reason: 'no-test-block', detail: <parser reason> }
```

Message, both entry points:

```
cannot start '<slug>': plans/<slug>/DESIGN.md has no valid setup/test block (<detail>).
A plan without one counts as not reviewed. Run /pir-review-plan <slug> to add it.
```

## Tests

- [ ] `readTestBlockGate` on a valid, a missing-block, a malformed and a missing DESIGN.md.
- [ ] `startRun` refuses with `no-test-block` and the detail after a passing review gate, and spawns
      nothing; an unreviewed plan still reports `not-reviewed` first.
- [ ] `pir.mjs` prints the message above for `no-test-block`.
- [ ] The coordinator's `main` refuses (exit 1, message on stderr) in live and dry-run modes, before
      any worktree is created. Test through the existing main/gate test seam.

## Done when

- [ ] Both entry points refuse a plan without a valid block with the message above, tested.
- [ ] A plan with a valid block starts exactly as before.
