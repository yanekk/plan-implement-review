# T02 — api-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the API itself: what any request is answered with, what `api.json` holds, and the
one rule that decides whether code is on the real machine or a scratch home.

## Design sections this implements

DESIGN §2.1 (discovery, everything else), §2.2, §2.8, §3.2, §3.4.

## Files

- `src/core/api.mjs` (new)
- `src/core/api.test.mjs` (new)

## Interface

```js
export const API_VERSION = 1;
export const API_PORT = 47717;
export const EXIT_PORT_TAKEN = 78;

// §2.8. `osHome` is os.userInfo().homedir, passed in by the shell.
export function homeKind(env, osHome) // → 'real' | 'scratch' | 'test-real'

// 'real' → 47717, 'scratch' → 0, 'test-real' → null (the service refuses to start).
export function portFor(kind) // → number | null

// pirDir is `${PIR_HOME ?? HOME}/.pir`.
export function apiFiles(pirDir) // → { discovery, usage, off }  (api.json, usage.json, api-service.off)

export function discoveryRecord({ port, pid }) // → { version: 1, url: 'http://127.0.0.1:{port}', pid }

// The whole request decision (§2.1), in the order host → path → method. `endpoints` maps a path to a
// function returning the body object; a function that throws yields the 500.
export function route({ method, url, host }, { port, endpoints })
// → { status, headers: { 'Content-Type', 'Cache-Control', 'X-Content-Type-Options', Allow? }, body: string }
```

`homeKind` compares `env.PIR_HOME ?? env.HOME` with `osHome` after stripping one trailing slash. An
unset home reads as `scratch`. Reason: failing closed costs nothing there.

## Tests

- [ ] `homeKind`: real home, no test context → `real`; `PIR_HOME` elsewhere → `scratch`; `HOME` elsewhere, no `PIR_HOME` → `scratch`; real home with `NODE_TEST_CONTEXT` → `test-real`; `PIR_HOME` equal to the real home → `real`; trailing slash; neither variable set → `scratch`
- [ ] `portFor` for the three kinds
- [ ] `route`: `GET /v1/usage` with host `127.0.0.1:47717` → 200, the endpoint's body as JSON
- [ ] host `localhost:47717`, `LOCALHOST:47717` → 200
- [ ] host `evil.example`, `127.0.0.1` without port, `127.0.0.1:1`, `[::1]:47717`, undefined → 403 `forbidden_host`
- [ ] a bad host on an unknown path → 403, not 404
- [ ] `/v1/usage?x=1` → 200; `/v1/usage/`, `/`, `/v1`, `/v2/usage` → 404
- [ ] `POST`, `HEAD`, `OPTIONS`, `DELETE` on `/v1/usage` → 405 with `Allow: GET`; `POST /nope` → 404
- [ ] an endpoint that throws → 500 `internal`
- [ ] no response in any case carries a header starting `Access-Control-`
- [ ] every body parses as JSON and carries `version: 1`
- [ ] `discoveryRecord` shape and key order match DESIGN §2.1

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `src/core/boundary.test.mjs` passes for `api.mjs`.
