# T03 — service-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the login item: the plist text launchd reads, which steps `on`, `off` and `refresh`
take in each situation, and the exact lines `pir service` prints.

## Design sections this implements

DESIGN §2.6, §2.7, §2.8 (login-item column).

## Files

- `src/core/service.mjs` (new)
- `src/core/service.test.mjs` (new)

## Interface

```js
export const SERVICE_LABEL = 'com.pir.api-service';

// Label, ProgramArguments [node, script], RunAtLoad, KeepAlive, ProcessType Background. `env`, when
// given, becomes EnvironmentVariables: only T09's scratch check passes it (PIR_HOME). Every string is
// XML-escaped.
export function plistText({ label, node, script, env }) // → string

// facts: { kind /* homeKind */, platform, installedEngine: boolean, off: boolean, loaded: boolean }
// action: 'on' | 'off' | 'refresh'
// Step.do: 'remove-off' | 'write-off' | 'write-plist' | 'remove-plist' | 'bootout' | 'bootstrap'
//          | 'remove-stale-discovery' | 'await-answer'
export function servicePlan(action, facts) // → { steps: Step[], message: string | null }

// state: 'running' | 'off' | 'not-installed' | 'port-held' | 'not-answering'
// facts: { state, url, pid, reading /* core/usage Reading | null */, lastExit }
export function statusText(facts, now) // → { text: string, code: 0 | 1 }

export function ageText(ms) // → 'just now' | 'N min ago' | 'N h ago' | '1 day ago' | 'N days ago'
```

`servicePlan` rules:

- platform not `darwin` → no steps, message `pir service needs macOS (launchd)`.
- kind not `real` → no steps, message `skipped the API service (not the real home)`.
- `on` or `refresh` with `installedEngine` false → no steps, message
  `pir service: run the installed pir (./install.sh first)`.
- `refresh` with `off` true → no steps, message `the API service is off (pir service on turns it on)`.
- `on`: `remove-off`, `write-plist`, `bootout` if loaded, `bootstrap`, `await-answer`.
- `refresh`: `write-plist`, `bootout` if loaded, `bootstrap`, `await-answer`.
- `off`: `bootout` if loaded, `remove-plist`, `remove-stale-discovery`, `write-off`.

`statusText` returns the six texts of DESIGN §2.7 verbatim; code 0 only for `running`.

## Tests

- [ ] `plistText` for the real label parses as a plist: write it to a temp file and run `/usr/bin/plutil -lint` (skip off macOS)
- [ ] a path containing `&`, `<` and a space is escaped and survives `plutil -convert json`
- [ ] `env` absent → no `EnvironmentVariables` key; present → the key with each pair
- [ ] `servicePlan`: every rule above, one case each, including `off` when not loaded and `on` when already loaded
- [ ] `servicePlan('off')` on a scratch home and under `test-real` → no steps
- [ ] `statusText`: each of the six texts of §2.7, compared as whole strings
- [ ] `statusText` with one null window → `5-hour unknown` or `weekly unknown`
- [ ] `ageText`: 0 and 59 999 ms → `just now`; 60 000 ms → `1 min ago`; 59 min → `59 min ago`; 60 min → `1 h ago`; 23 h → `23 h ago`; 24 h → `1 day ago`; 48 h → `2 days ago`
- [ ] `ageText` of a negative age (clock moved back) → `just now`

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `src/core/boundary.test.mjs` passes for `service.mjs`.
