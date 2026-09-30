# T02 — api-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the API itself: what any request is answered with, the health body, what `api.json`
holds, and the one rule that decides whether code is on the real machine or a scratch home.

## Design sections this implements

DESIGN §2.1 (discovery, everything else), §2.2, §2.8, §3.2, §3.4.

## Files

- `src/core/api.mjs` (new)
- `src/core/api.test.mjs` (new)

## Interface

```js
export const API_VERSION = 1;
export const API_PORT = 47717;
export const EXIT_PORT_TAKEN = 47; // not 78: launchd reports 78 itself when it cannot start the program (§2.2)

// §2.8. `osHome` is os.userInfo().homedir, passed in by the shell.
export function homeKind(env, osHome) // → 'real' | 'scratch' | 'test-real'

// 'real' → 47717, 'scratch' → 0, 'test-real' → null (the service refuses to start).
export function portFor(kind) // → number | null

// pirDir is `${PIR_HOME ?? HOME}/.pir`.
export function apiFiles(pirDir) // → { discovery, usage, off }  (api.json, usage.json, api-service.off)

export function discoveryRecord({ port, pid }) // → { version: 1, url: 'http://127.0.0.1:{port}', pid }

// The /health body (§2.1).
export function healthBody({ pid }) // → { version: 1, status: 'ok', pid }

// The whole request decision (§2.1), in the order path → method. `endpoints` maps a path to a
// function returning the body object; a function that throws yields the 500. The `Host` header is
// not an input: §2.1 checks none.
export function route({ method, url }, { endpoints })
// → { status, headers: { 'Content-Type', 'Cache-Control', 'X-Content-Type-Options', Allow? }, body: string }
```

`homeKind` compares `env.PIR_HOME ?? env.HOME` with `osHome` after stripping one trailing slash. With
neither variable set it returns `test-real`. Reason: `indexDir` falls back to the real home there, so
`scratch` would write the real files; refusing costs nothing, since a real run always has `HOME`.

## Tests

- [ ] `homeKind`: real home, no test context → `real`; `PIR_HOME` elsewhere → `scratch`; `HOME` elsewhere, no `PIR_HOME` → `scratch`; real home with `NODE_TEST_CONTEXT` → `test-real`; `PIR_HOME` equal to the real home → `real`; trailing slash; neither variable set → `test-real`, with and without `NODE_TEST_CONTEXT`
- [ ] `portFor` for the three kinds
- [ ] `route`: `GET /v1/usage` and `GET /health` from a two-row table → 200, that endpoint's body as JSON
- [ ] `/v1/usage?x=1`, `/health?x=1` → 200; `/v1/usage/`, `/health/`, `/`, `/v1`, `/v2/usage` → 404
- [ ] `POST`, `HEAD`, `OPTIONS`, `DELETE` on `/v1/usage` and on `/health` → 405 with `Allow: GET`; `POST /nope` → 404
- [ ] `healthBody` shape and key order match DESIGN §2.1
- [ ] an endpoint that throws → 500 `internal`
- [ ] no response in any case carries a header starting `Access-Control-`
- [ ] every body parses as JSON and carries `version: 1`
- [ ] `discoveryRecord` shape and key order match DESIGN §2.1

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `src/core/boundary.test.mjs` passes for `api.mjs`.
