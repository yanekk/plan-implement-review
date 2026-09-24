# T01 — decide-dead-worker

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Extend the one resume decision so it also answers the mid-run death: revive, fall back, or give up.
Pure, so the whole table of DESIGN §2.2–§2.5 is proven in milliseconds, and restart and mid-run share
it rather than disagreeing again.

## Design sections this implements

DESIGN §2.2, §2.4, §2.5, §3.3.

## Files

- `src/core/resume.mjs`, `src/core/resume.test.mjs`
- `src/core/dispatch.mjs`, `src/core/dispatch.test.mjs`

## Interface

```js
decideResume({ featureTasks, branchStates, deaths = {}, maxDeaths = 3 })
  → { merge, review, resume, revive, giveUp }   // sorted task numbers
// deaths[num] = { count, role: 'implement'|'review', sessionId: string|null, revived: bool }
// order: ✅ → merge; count >= maxDeaths → giveUp; branch null → none;
//        revive-eligible (§2.4) && !revived && sessionId → revive; 🔍 → review; else resume

decideDispatch({ tasks, assignments, maxWorkers, halted, givenUp = new Set() })
// a task in givenUp is never in spawn; it still counts as not-✅ for complete
```

## Tests

- [ ] `deaths` omitted: output identical to today for every existing case (merge/review/resume), plus empty `revive`/`giveUp`.
- [ ] Each row of the §2.4 table, first death: implement+⬜/🟡 → revive; implement+🔍 → review; review+🔍 → revive; any+✅ → merge.
- [ ] Same rows with `revived: true` → the fallback column; with `sessionId: null` → the fallback column.
- [ ] `count: 3` → giveUp for ⬜/🟡/🔍 and an absent branch, but merge for ✅; `count: 2` → not giveUp; `maxDeaths` override honoured.
- [ ] A feature row ✅/⛔ with a death entry → no entry at all.
- [ ] `decideDispatch`: a ready task in `givenUp` is not spawned; a plan whose only unfinished task is given up is not `complete`; halted ignores `givenUp`.
- [ ] Boundary test still green.

## Done when

- [ ] The interface above is exported and every test above passes in `npm test`.
- [ ] No existing `resume.test.mjs` or `dispatch.test.mjs` case changed its expectation.
