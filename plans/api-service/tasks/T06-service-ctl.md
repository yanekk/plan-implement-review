# T06 — service-ctl

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** heavy

## Goal

Carry out `on`, `off`, `refresh` and the status check against launchd, the plist, the off marker and
the service's own answer, with `launchctl` injected so no test runs the real one.

## Design sections this implements

DESIGN §2.6, §2.7, §2.8 (login-item column), §2.9 (the last three rows), §5.2.

## Files

- `src/shell/service-ctl.mjs` (new), `src/shell/service-ctl.test.mjs` (new)

## Interface

```js
// Shared options. Defaults are the real machine's; T09 passes label, plistPath, scriptPath and
// plistEnv for its scratch item, and then the homeKind and installed-engine rules are not applied
// (`scratchItem: true`).
// {
//   env = process.env, osHome = userInfo().homedir, platform = process.platform,
//   launchctl = realLaunchctl,          // (args: string[]) → { status, stdout, stderr }
//   get = httpGet,                      // (url, { timeoutMs }) → Promise<{ status, body } | null>
//   label = SERVICE_LABEL,
//   plistPath = `${osHome}/Library/LaunchAgents/${label}.plist`,
//   scriptPath = <api-service.mjs beside this file>,
//   nodePath = <`/bin/sh -c 'command -v node'`, else process.execPath>,
//   plistEnv, scratchItem = false, uid = process.getuid(), now = Date.now, sleep,
// }

export async function serviceOn(opts)      // → { text, code }
export async function serviceOff(opts)     // → { text, code }
export async function serviceRefresh(opts) // → { text, code }
export async function serviceStatus(opts)  // → { text, code }

// As a program, for install.sh: `node src/shell/service-ctl.mjs refresh` prints `text`, exits `code`.
```

- With `scratchItem`, `servicePlan` is given `kind: 'real'` and `installedEngine: true` whatever `env` says, and
  the off marker and `api.json` are those of `env`'s home. Only T09 uses it.
- `installedEngine` is true when `scriptPath` equals `${osHome}/.claude/pir-engine/src/shell/api-service.mjs`.
- `loaded` is `launchctl(['print', `gui/${uid}/${label}`]).status === 0`; `lastExit` is parsed from its
  `last exit code = N` line.
- Steps run in `servicePlan`'s order. `bootout` tolerates status 3 (not loaded, measured).
  `bootstrap` is retried up to 10 times, 300 ms apart, while it fails (measured: code 5 while the old
  instance is still being torn down).
- `await-answer` polls `get` on the service url for up to 5 s, then returns `serviceStatus`.
- `serviceStatus`, state order: off marker → `off`; not loaded → `not-installed`; `get` answers a
  version-1 usage body → `running` (pid from `api.json`, reading from the body's fields); `get`
  answers anything else → `port-held`; no answer → `not-answering` with `lastExit`. On the real
  machine the url is `http://127.0.0.1:47717`; on a scratch home it comes from that home's `api.json`
  and the launchctl checks are skipped.
- `remove-stale-discovery` deletes `api.json` only when its pid is not alive (`identity.mjs` `isAlive`).

## Tests

With a fake `launchctl` that records its calls and a temp folder for the plist and the home.

- [ ] `on`, not loaded: writes the plist (`plutil -lint` passes), calls `bootstrap gui/{uid} {plist}`, removes the marker
- [ ] `on`, already loaded: `bootout` first, then `bootstrap`
- [ ] `bootstrap` failing twice with status 5 then succeeding → three calls, success
- [ ] `bootstrap` failing ten times → `code` 1 and a text naming launchctl's stderr
- [ ] `off`: `bootout`, plist removed, marker written; `bootout` status 3 is not an error
- [ ] `off` removes an `api.json` whose pid is dead and keeps one whose pid is alive
- [ ] `refresh` with the marker present → no launchctl call, the "is off" message, `code` 0
- [ ] `refresh` without it → plist rewritten, `bootout` then `bootstrap`
- [ ] scratch home, and the real home under `NODE_TEST_CONTEXT` → `on`, `off`, `refresh` make no launchctl call and write no file
- [ ] `scriptPath` outside the installed engine → `on` and `refresh` refuse with the §2.7 text
- [ ] platform `linux` → the macOS message, no call
- [ ] `nodePath` is the unresolved `command -v` path, not its realpath (inject an `exec`)
- [ ] `serviceStatus`: each of the five states, from fake `launchctl` output and a fake `get`
- [ ] `serviceStatus` on a scratch home: url read from that home's `api.json`, no launchctl call, `running` from an injected `get`; no `api.json` → `not-answering`
- [ ] the CLI: `refresh` on a scratch `PIR_HOME` prints the skipped line and exits 0; an unknown word exits 2
- [ ] static: the only `execFileSync` of `launchctl` in `src/` is `realLaunchctl`

## Done when

- [ ] `npm test` is green with the cases above, and the suite made no real `launchctl` call: `launchctl print gui/$(id -u)/com.pir.api-service` still fails after it.
- [ ] `PIR_HOME=$(mktemp -d) node src/shell/service-ctl.mjs refresh` prints `skipped the API service (not the real home)`.
