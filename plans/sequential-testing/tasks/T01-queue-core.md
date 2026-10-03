# T01 — queue-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the machine-wide test queue: the order entries run in, what a bump writes, whose turn
it is, which entries and slot are stale given liveness answers, when a running suite is past its limit,
and the view model the queue screen and the dashboard's pinned line paint. Also the `testTimeoutMinutes`
setting. Every shell piece of the queue executes or paints what this returns, so the whole of DESIGN
§2.6–§2.8's queue rules is proven here.

## Design sections this implements

DESIGN §2.6, §2.7 (the limit's value and the setting), §2.8 (pinned line and queue view text), §2.12
(stale entries, unreadable files, races), §3.3, §3.5 (entry and slot shapes).

## Files

- `src/core/testqueue.mjs` (new), `src/core/testqueue.test.mjs` (new)
- `src/core/basebranch.mjs`, `src/core/basebranch.test.mjs` (`testTimeoutMinutes`)

## Interface

```js
export const DEFAULT_TIMEOUT_MIN = 30;
// entry: { id, order, enqueuedAt, owner: { pid, startTime }, repo, run, kind: 'task'|'end'|'single'|'baseline',
//          task, role, try, cwd, limitMs, label }
// slot:  { entryId, owner: { pid, startTime }, command: { pid, startTime } | null, startedAt, limitMs } | null
orderEntries(entries) → entries                      // by order, then enqueuedAt, then id; never mutates
bumpOrder(entries, id, slot) → number | null         // smallest waiting order − 1; null when id is absent,
                                                     // is the running entry, or is already first
decideSlot({ entries, slot, alive, now }) → {
  staleEntries: [id],        // owner not alive, or the entry unreadable (entry === null)
  staleSlot: boolean,        // slot owner not alive, or slot names no live entry
  reap: { pid, startTime } | null,   // the stale slot's command, for the shell to kill after its identity check
  next: id | null,           // first live waiting entry, when the slot is free or stale
  timedOut: boolean,         // the live slot's suite is past its limit
}
  // alive: (owner) => boolean, answered by the shell beforehand; no clock but `now`
timeoutDue({ startedAt, limitMs, now }) → boolean   // now − startedAt >= limitMs
queuePosition(entries, id, slot) → number | null     // 1-based among waiting entries
entryWhat(entry) → string     // 'T05 cart-totals · implement' | 'single · builder' | 'single · baseline' | 'end of build'
queueView({ entries, slot, now }) → {
  running: { id, run, repo, what, try, elapsedMs, limitMs } | null,
  waiting: [{ id, pos, run, repo, what, try, waitedMs }],
}
pinnedLine(view) → string     // DESIGN §2.8: '⧗ test queue  running {run} {what} · m:ss / m:ss · {n} waiting' | '⧗ test queue  idle'
nth(n) → '1st' | '2nd' | '3rd' | '4th' | '11th' | '12th' | '13th' | '21st' …
```

`basebranch.mjs`: `parseSettings` accepts `testTimeoutMinutes`, a positive finite number, else
`bad-settings` with `"testTimeoutMinutes" must be a positive number`. `effectiveTimeout({ repo, user })
→ minutes`, user over repo, default `DEFAULT_TIMEOUT_MIN`.

## Tests

- [ ] orderEntries: by order; ties by enqueuedAt then id; input not mutated
- [ ] bumpOrder: middle entry → min − 1; first entry → null; running entry → null; unknown id → null; one waiting entry → null
- [ ] bump twice in a row of two entries swaps them back (second bump of the new second)
- [ ] decideSlot: free slot → next is the first live entry; first entry's owner dead → it is stale and next is the second
- [ ] decideSlot: slot owner dead → staleSlot, reap is its command, next chosen as if free; command null → reap null
- [ ] decideSlot: slot naming an entry that no longer exists → staleSlot
- [ ] decideSlot: live slot past limit → timedOut; at limit − 1 ms → not
- [ ] decideSlot: an unreadable entry (null) is stale; an empty queue → next null
- [ ] queuePosition and queueView: positions 1..n in order, running excluded from waiting, elapsed and waited from now
- [ ] entryWhat for each kind; pinnedLine for idle, running with 0 waiting, running with 3 waiting
- [ ] nth for 1, 2, 3, 4, 11, 12, 13, 21, 22, 101
- [ ] parseSettings: 45 ok; 0, -1, '30', NaN, Infinity → bad-settings; absent stays absent
- [ ] effectiveTimeout: user over repo, repo alone, neither → 30
- [ ] boundary.test.mjs passes with the new module

## Done when

- [ ] Every function above exists with the listed tests green in `npm test`.
- [ ] `src/core/testqueue.mjs` imports nothing from `src/shell/` or Node's I/O modules.
- [ ] The pinned-line and queue texts match DESIGN §2.8.
