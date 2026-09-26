# T03 — worker-observer

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The shell half of observing a worker: a cheap fingerprint of its task worktree, and the log entries
it has produced since the last look. It hands raw facts to the pure core (T01) and decides nothing
itself. The entries are the ones `worker-proc` already keeps in memory; nothing reads the ndjson file.

## Design sections this implements

DESIGN §2.2, §2.7 (git failure), §3.4, §3.5.

## Files

- `src/shell/platform.mjs`: add `observe()` to the object `createPlatform` returns. Injected git runner
  so tests point it at a scratch repo.
- `src/shell/platform.test.mjs`: tests below.
- `src/shell/fake/platform.mjs`: `observe()` returns a scripted observation per worker (a `behaviors`
  entry gains an `observe` script keyed by pass: fingerprints and entries), and a behaviour can put a
  worker's `list()` state at `permission` or `questions` for a number of passes.

## Interface

```js
// On the object createPlatform returns.
observe(id, { worktreePath, cursor = 0 }) → {
  fingerprint: string | null,  // null when git fails; never throws
  entries: object[],           // the worker's log entries from index `cursor` on (worker.entries())
  cursor: number,              // the index to pass next time
}
// An unknown id → { fingerprint, entries: [], cursor } (the worktree is still fingerprinted).
```

- Fingerprint: HEAD sha + `git status --porcelain=v1 -uall` + size and mtimeMs of each listed path.
  The mtimes catch a second edit to an already-dirty file, which porcelain alone does not.
- `worker.entries()` returns a copy of the whole history each call; slice from `cursor`. If that ever
  shows up as a cost on a long conversation, add an `entriesSince(n)` to `worker-proc` rather than
  keeping a second copy.

## Tests

- [ ] Fingerprint on a scratch git repo: unchanged tree → same string; new file, edit of a tracked
      file, second edit of an already-dirty file, a commit → each a different string.
- [ ] An ignored file written in the worktree → same string.
- [ ] git failing (not a repo) → `fingerprint: null`, no throw.
- [ ] Against the fake `claude` (as `platform.test.mjs` already drives it): two calls return two slices
      with no overlap and no gap; the second call's `cursor` equals the entry count.
- [ ] An unknown id → no entries, no throw.
- [ ] The fake platform returns scripted observations and scripted `permission`/`questions` states.

## Done when

- [ ] `platform.observe()` exists with the shape above and all listed tests pass in `npm test`.
- [ ] The fake platform can script a worker's fingerprints, entries and request state over passes for
      T04's loop tests.
