# T07 — end-sync

**Phase:** 2 · **Depends on:** T04, T06 · **Weight:** heavy

## Goal

The end of a build with the coordinator agent: fetch the run's base before merging it into the feature
branch, hold in `preparing` with a visible reason and retry every minute while the remote cannot be
reached or the local and remote bases have split, and while waiting for the person's merge, fetch every
five minutes so a merge on GitHub or a moved base is seen. Every text it produces names the run's base.

## Design sections this implements

DESIGN §2.8, §2.9.

## Files

- `src/shell/coordinate.mjs` (`endSync`, `endSyncing`, the waiting step, the hand-off and finished calls, `re-synced with {base}` commit message)
- `src/core/display.mjs` and the status snapshot (`handoff.hold`, `handoff.lastWatchFailure`), `src/shell/render.mjs` (show the hold)
- `src/shell/coordinate.test.mjs`, `src/core/display.test.mjs`, `src/shell/render.test.mjs`

## Interface

```js
handoff: { state: 'preparing'|'ready'|'red', baseSha, base,
           hold: null | { reason: 'fetch-failed'|'diverged', text, since, nextTry },
           lastWatch: time|null, lastWatchFailure: time|null, … }
// Intervals are injected (defaults 60_000 retry, 300_000 watch) and compared against the loop's `now`,
// never a clock read in core.
endSync: prepareBase(root, base, {mode:'start'}) → ok: syncBase({ baseSha: sha, base }) | !ok: set hold, retry after interval
waiting: each pass baseContains(tip, { refs: [refs/heads/<base>] }); every watch interval prepareBase(…, {mode:'watch'})
         then baseContains with refs/remotes/<remote>/<base> too; moved without the tip → re-sync as today
```

## Tests

- [ ] end sync fetches: remote base ahead → merged commit is the remote's sha
- [ ] unreachable remote at the end → state preparing with hold fetch-failed, no hand-off, no helper spawned; remote restored → next retry syncs and hands off
- [ ] diverged at the end → hold diverged with its text
- [ ] retry waits the injected interval (no retry on the next pass)
- [ ] waiting: merge landed only on the remote's base → seen after the watch interval, run finished
- [ ] waiting: fetch fails → lastWatchFailure set, state unchanged
- [ ] waiting: base moved without the tip → re-sync as today, commit `report({slug}): re-synced with dev`
- [ ] hand-off and finished lines name dev in a dev run
- [ ] render shows the hold text in the preparing line

## End to end (the worker drives this)

- suite: harness scenario tests in `npm test` (fake platform) · sizes: live view at 80×24
- [ ] a coordinator-agent run in a dev repo whose remote is unreachable at the end → live view shows `preparing: can't reach origin, retrying`; after the remote path is restored it shows `ready to merge` and the dev hand-off

## Done when

- [ ] the end of a run never merges a base it did not just try to fetch, and never hands off while held
- [ ] every hold, watch and re-sync case above has a test
- [ ] `npm test` green
