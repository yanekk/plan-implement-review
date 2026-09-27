# T04 — worker-link-and-silence

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Give the coordinator the two worker-level things the alert needs: the Remote Control session link as
soon as Remote Control is on, and a way to start build workers with the Claude app's own push silenced.

## Design sections this implements

DESIGN §2.2 (link), §2.5.

## Files

- `src/shell/worker-proc.mjs`, `src/shell/worker-proc.test.mjs`.
- `src/shell/platform.mjs`, `src/shell/platform.test.mjs` (or wherever platform is tested).
- `src/shell/fake/platform.mjs`: `workers()` rows carry `remote`, `url` and `lastText` (set by a behaviour)
  so T05 can test against it.

## Interface

```
worker.remoteUrl → string|null        // the last enableRemoteControl session_url; null once switched off
worker.remoteRefused → bool
startWorker({ …, env })               // passed to the SDK as Options.env; absent means inherit
                                      // (Options.env replaces process.env, so callers pass { ...process.env, X })
createPlatform({ …, workerEnv: () => object|null })
                                      // called at each build spawn; its result is merged over process.env
platform.workers()[i] → { …, remote: 'on'|'off'|'refused', url: string|null, lastText: string|null }
                                      // lastText: the worker's last assistant text in its entries; T05's
                                      // report-less `question` wording (DESIGN §2.3) needs it and the row
                                      // otherwise carries only the activity fold
```

`plan-run.mjs` calls `startWorker` directly and is not changed, so planning sessions never get the
variable.

## Tests

- [ ] With the fake claude stream: after `remoteControl(true)` settles, `remoteUrl` is the fake's
      `session_url`; after `remoteControl(false)`, null; after a refusal, `remoteRefused` true.
- [ ] `startWorker` with `env` passes it to the spawned process (fake spawner sees the variable);
      without `env` behaves as today.
- [ ] Platform spawn with a `workerEnv` returning `{ CLAUDE_CLIENT_PRESENCE_FILE: p }` gives the worker
      that variable plus the inherited environment; returning null adds nothing.
- [ ] `workers()` rows carry `remote`, `url` and `lastText` (null before any assistant text).

## Done when

- [ ] Tests pass; existing worker-proc and platform tests unchanged and green.
- [ ] `plan-run.mjs` has no diff.
