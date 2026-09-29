# T04 — worker-link-and-silence

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Give the coordinator the session-level things the alerts need: each worker's and the coordinator agent's
Remote Control link as soon as Remote Control is on, and a way to start build workers and the agent with
the Claude app's own push silenced.

## Design sections this implements

DESIGN §2.2 (link), §2.4 (agent link), §2.7.

## Files

- `src/shell/worker-proc.mjs`, `src/shell/worker-proc.test.mjs`.
- `src/shell/platform.mjs`, its test.
- `src/shell/coordinator-agent.mjs`, its test: `startCoordinatorAgent` takes `env` and passes it to
  `startWorker`; the agent handle exposes `remoteUrl()`.
- `src/shell/fake/platform.mjs`: `workers()` rows carry `remote`, `url` and `lastText` (set by a behaviour)
  so T07 can test against it.

## Interface

```
worker.remoteUrl → string|null        // the last enableRemoteControl session_url; null once switched off
worker.remoteRefused → bool
startWorker({ …, env })               // passed to the SDK as Options.env; absent means inherit
                                      // (Options.env replaces process.env, so callers pass { ...process.env, X })
createPlatform({ …, workerEnv: () => object|null })
                                      // called at each build spawn; its result is merged over process.env
platform.workers()[i] → { …, remote: 'on'|'off'|'refused', url: string|null, lastText: string|null }
                                      // lastText: the worker's last assistant text in its entries (T07's
                                      // report-less `question` wording, DESIGN §2.3)
startCoordinatorAgent({ …, env: () => object|null })   // same contract as workerEnv, read at each (re)start
agent.remoteUrl() → string|null
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
- [ ] The agent started with an `env` returning the variable gets it, on a resume too; `remoteUrl()`
      reads its link.
- [ ] `workers()` rows carry `remote`, `url` and `lastText` (null before any assistant text).

## Done when

- [ ] Tests pass; existing worker-proc, platform and coordinator-agent tests unchanged and green.
- [ ] `plan-run.mjs` has no diff.
