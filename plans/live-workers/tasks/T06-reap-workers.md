# T06 — reap-workers

**Phase:** 2 · **Depends on:** T04, T05 · **Weight:** light

## Goal

No worker outlives its run. A child survives a SIGKILLed coordinator, so the recorded `workers.json`
is used to reap leftovers on startup, on the dashboard's stop, and on teardown, with a start-time check
so a reused pid is never killed. Removing a run also deletes its conversations.

## Design sections this implements

DESIGN §2.3 (retention), §2.12.

## Files

- `src/shell/reap.mjs` (new), `src/shell/reap.test.mjs` (new)
- `src/shell/coordinate.mjs` (`startupControlHygiene` calls the reap before the first pass)
- `src/shell/loop.mjs` `reconcile` (its `platform.list()` reap of the previous run's workers only sees this
  process's children after T05; drop it, the startup reap covers it) and its test
- `src/shell/control-run.mjs` (`stopRun`'s own escalation replaced by T04's `terminate`; `stopRun` reaps from `workers.json` instead of `claude agents`;
  `removeRun` deletes `conversations/`), and its test. `terminate` takes the injected shape stopRun's tests use
- `src/shell/pir-tui.mjs` (`defaultPlatform(record)`, the `makePlatform` dependency: it builds the
  `createPlatform({ root })` that `stopRun` lists and closes through; after T05 that platform has no
  children, so `stopRun` gets the `workers.json` reap instead)

Depends on T05 because T05 writes `workers.json` and makes the old `platform.list()` reaps blind; landing
this first would stop reaping a still-`--bg` run's workers.

## Interface

```js
readWorkersFile(controlDir) → [{ id, task, role, pid, startTime }]   // [] if absent or corrupt
reapRecorded(controlDir, { isAlive, startTimeOf, kill, wait }) → { reaped: [pid…], skipped: [pid…] }
// kill only when isAlive(pid) and startTimeOf(pid) === recorded startTime; T04's terminate(), SIGKILL after 3 s
```

## Tests

- [ ] a live recorded pid with matching start time is SIGTERMed, then SIGKILLed if still alive
- [ ] a pid alive with a different start time (reused) is skipped
- [ ] a dead pid is skipped; a corrupt or missing file reaps nothing and does not throw
- [ ] startup hygiene reaps before the first pass (so before `reconcile`); `stopRun` reaps after the coordinator is gone
- [ ] `removeRun` deletes `conversations/` and leaves nothing else changed

## Done when

- [ ] `npm test` green with the tests above
- [ ] no `claude agents` listing remains in the stop or startup path
- [ ] DESIGN §6's manual orphan recovery matches what the code does
