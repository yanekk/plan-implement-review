# T05 — narrate-deaths

**Phase:** 3 · **Depends on:** T04 · **Weight:** light

## Goal

Tell the person what happened when a worker dies, is revived, is replaced or is given up, in the
words DESIGN §2.6 fixes; show a given-up task as such instead of `queued`, and tag a live task's row
with its restarts so a `pir` user sees them.

## Design sections this implements

DESIGN §2.6, and §2.3 for the conversation log.

## Files

- `src/shell/coordinate.mjs`, `src/shell/coordinate.test.mjs`
- `src/core/display.mjs`, `src/core/display.test.mjs`
- `src/core/conversation.mjs`, `src/core/conversation.test.mjs` (the `revived` note line)
- `src/shell/render.mjs` if the row kind needs a style

## Interface

```js
// coordinator.pass() summary gains one sentence per revive / revive-failed / worker-died / give-up,
// printed with renderer.line exactly as §2.6 words it. The fallback sentence names adoptTask's action.
// buildRunState task: { ..., gaveUp: bool, deaths: n }
// rowFor: gaveUp → { kind: 'gave-up', label: `gave up · worker died ${deaths}×` }
//         live phase and deaths > 0 → label `${PHASE_LABEL[phase]} · worker restarted ${deaths}×`
// deaths/gaveUp are plain task fields; the snapshot stores runState whole, so `pir` paints them too
// stall exit: the end message lists given-up tasks by number
// conversation.mjs noteLines: `revived` → one dim line, exactly DESIGN §2.6
```

## Tests

- [ ] Each of the four actions renders the §2.6 sentence for a sample task, including "(2 of 3)".
- [ ] A given-up task's row reads `gave up · worker died 3×`, not `queued`.
- [ ] A live task with one death reads `implementing · worker restarted 1×`; with none, its label is unchanged.
- [ ] A snapshot written and read back keeps `deaths` and `gaveUp`, so the `pir` view shows both.
- [ ] A stall with a given-up task names it in the end message.
- [ ] A `revived` note renders as one line in both the step and the full mode; an unknown note kind is unchanged.
- [ ] A run with no deaths prints nothing new.

## Done when

- [ ] Every test above passes in `npm test`; wording matches DESIGN §2.6 verbatim.
