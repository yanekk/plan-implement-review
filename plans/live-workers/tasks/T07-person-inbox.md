# T07 — person-inbox

**Phase:** 2 · **Depends on:** T03, T05 · **Weight:** medium

## Goal

Carry the person's input from the `pir` screen to the worker. The screen drops a file; the coordinator
watches the folder, validates each drop, applies the "do not ask again" grants, and forwards it over the
platform at once, outside the pass. It also answers matching permission requests itself from a worker's
grants. Every outcome is logged so nothing the person sends disappears silently.

## Design sections this implements

DESIGN §2.5, §2.6 (grants, auto-answer), §2.7 (answers, decline), §2.8 (interrupt).

## Files

- `src/shell/person-inbox.mjs` (new), `src/shell/person-inbox.test.mjs` (new)
- `src/shell/coordinate.mjs` (start the watcher with the run; clear `inbox/` in `clearTransientFeeds`,
  which `startupControlHygiene` calls and which clears `reports/` today).
  `createReportInbox`'s drain (sorted `*.json`, parse, unlink, drop malformed) and `waitForReport`'s
  `fs.watch` are generalised to take the folder and a parser, and serve both `reports/` and `inbox/`; no
  second reader or watcher is written (user 2026-09-25, plan review). The main loop's wait between passes
  (`waitForReport(reportsDir, timeoutMs, { watch })`) then wakes on either folder
- `src/shell/platform.mjs` (hook: on each `permission` event, consult grants before it counts as pending)

## Interface

```js
// The pir screen's side.
dropPersonInput(controlDir, input, { coordinatorAlive }) → { ok: true } | { ok: false, reason: 'not-running' | string }
// The coordinator's side.
startPersonInbox({ controlDir, platform, grants, watch = fs.watch }) → { drain(), stop() }
// drain(): read every *.json in inbox/, validate (core/person-input), forward, log, delete. Called by the
// watcher and once per pass as a backstop.
createGrants() → { add(workerId, grant), decide(workerId, request) }   // wraps core decidePermission
```

`permission` with `decision:"allow-always"` allows the request and adds `grantFrom(request)` for that
worker. A permission request that `decide` allows is answered by pir immediately and logged
`delivered-by-grant`; it never shows as pending.

## Tests

- [ ] each kind reaches the fake worker as the right line (message, interrupt, allow, deny, answers, decline)
- [ ] an invalid drop is deleted and logged, never forwarded, never crashes the watcher
- [ ] a drop for a dead worker or an already-answered request is logged `undelivered`
- [ ] `allow-always` then an identical request: the second is answered by pir with no pending state
- [ ] a partial file (no rename yet) is never read; temp files are ignored
- [ ] the existing report-inbox and waitForReport tests pass unchanged on the generalised reader
- [ ] `dropPersonInput` with the coordinator not alive writes nothing and returns `not-running`
- [ ] startup hygiene empties `inbox/`

## Done when

- [ ] `npm test` green with the tests above
- [ ] a coordinator test: fake worker asks permission → drop allow → worker continues to `result`
- [ ] forwarding does not wait for the next pass (asserted with the watcher firing between passes)
