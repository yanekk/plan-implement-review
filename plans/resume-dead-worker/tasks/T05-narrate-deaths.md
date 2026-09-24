# T05 — narrate-deaths

**Phase:** 3 · **Depends on:** T04 · **Weight:** light

## Goal

Tell the person what happened when a worker dies, is revived, is replaced or is given up, in the
words DESIGN §2.6 fixes, and show a given-up task as such instead of `queued`.

## Design sections this implements

DESIGN §2.6.

## Files

- `src/shell/coordinate.mjs`, `src/shell/coordinate.test.mjs`
- `src/core/display.mjs`, `src/core/display.test.mjs`
- `src/shell/render.mjs` if the row kind needs a style

## Interface

```js
// coordinator.pass() summary gains one sentence per revive / revive-failed / worker-died / give-up,
// printed with renderer.line exactly as §2.6 words it. The fallback sentence names adoptTask's action.
// buildRunState task: { ..., gaveUp: bool, deaths: n }
// rowFor: gaveUp → { kind: 'gave-up', label: `gave up · worker died ${deaths}×` }
// stall exit: the end message lists given-up tasks by number
```

## Tests

- [ ] Each of the four actions renders the §2.6 sentence for a sample task, including "(2 of 3)".
- [ ] A given-up task's row reads `gave up · worker died 3×`, not `queued`.
- [ ] A stall with a given-up task names it in the end message.
- [ ] A run with no deaths prints nothing new.

## Done when

- [ ] Every test above passes in `npm test`; wording matches DESIGN §2.6 verbatim.
