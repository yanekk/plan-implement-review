# T05 — api-service

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

The program launchd runs: an HTTP server on `127.0.0.1` that answers the contract from `usage.json`,
keeps `api.json` current, and exits cleanly.

## Design sections this implements

DESIGN §2.1, §2.2, §2.5, §2.6 (the service's own behaviour), §2.8 (port column), §2.9.

## Files

- `src/shell/api-service.mjs` (new), `src/shell/api-service.test.mjs` (new)

## Interface

```js
// Listens on 127.0.0.1:{port}; port defaults to portFor(homeKind(env, osHome)). Writes api.json once
// listening, rewrites it every reassertMs when missing or not its own. Rejects with an error whose
// `code` is 'EADDRINUSE' when the port is taken, and 'TEST_REAL' when portFor is null.
export function startApiService({ env = process.env, osHome, now = Date.now, port, pid = process.pid, reassertMs = 30_000 } = {})
// → Promise<{ url, port, close(): Promise<void> }>
// close() stops the timer, removes api.json if its pid is ours, and closes the server.

// As a program: `node src/shell/api-service.mjs`. SIGTERM or SIGINT → close(), exit 0.
// EADDRINUSE → exit 78 (EXIT_PORT_TAKEN), nothing printed. Any other start failure → one line on
// stderr, exit 1.
```

Each request: build `{ method, url, host: req.headers.host }`, call `route` with
`endpoints = { '/v1/usage': () => usageBody(parseReading(cachedText(), now())) }`, write the result.
The cache holds the file's text and is refreshed when `statSync` shows a different size or mtime; a
missing or unreadable file is empty text. Request bodies are never read.

This module and everything it imports, transitively, uses only `node:` built-ins and relative paths.
Reason: DESIGN §2.6, it must start when `npm ci` failed.

## Tests

All on a temp `PIR_HOME` and an OS-chosen port, through real HTTP requests (`node:http`, so the
`Host` header can be set).

- [ ] no `usage.json` → 200 with nulls
- [ ] a valid `usage.json` → the body of DESIGN §2.1 with the file's numbers
- [ ] the file replaced with a newer reading → the next request serves it, with no restart
- [ ] the file replaced by garbage, by a future-dated reading, then deleted → 200 with nulls each time
- [ ] `Host: evil.example` → 403; `POST /v1/usage` → 405; `/nope` → 404; headers as §2.1, no `Access-Control-*`
- [ ] the listening address is `127.0.0.1`
- [ ] `api.json` exists once `startApiService` resolves, equals `discoveryRecord`, and no `.tmp` is left
- [ ] `api.json` deleted, or overwritten with another pid → rewritten within `reassertMs` (use 20 ms)
- [ ] `close()` removes `api.json`; when the file names another pid it is left alone
- [ ] a second service on the same explicit port → rejects `EADDRINUSE` and does not touch the first one's `api.json`
- [ ] `env` with the real home and `NODE_TEST_CONTEXT` → rejects `TEST_REAL`, nothing bound
- [ ] as a child process with a scratch `PIR_HOME`: answers; SIGTERM → exit 0 and `api.json` gone
- [ ] as a child process with the port forced to one a test server holds → exit 78, no `api.json`
- [ ] the import graph from `api-service.mjs` holds no bare specifier (walk it with the `SPECIFIER` approach of `src/core/boundary.test.mjs`)

## Outside actions

- Read the local API — `worker`

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `PIR_HOME=$(mktemp -d) node src/shell/api-service.mjs` answers `curl` on the url in that folder's `.pir/api.json`, and Ctrl-C removes the file.
- [ ] No test in this task binds port 47717: `grep -n 47717 src/shell/api-service.test.mjs` prints nothing.
