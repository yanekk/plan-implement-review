# T06 — single-alerts

**Phase:** 2 · **Depends on:** T04 · **Weight:** light

## Goal

Phone alerts for a single run, like a build's: an episode while a session asks the person, and one
alert when the run is ready to merge. Share `workerEnv` so the sessions start with the Claude app's own
push silenced when ntfy is configured.

## Design sections this implements

DESIGN §2.10.

## Files

- `src/core/notify.mjs`, `src/core/notify.test.mjs` (`singleEndAlert`)
- `src/shell/notify-config.mjs` (`workerEnv` moved here), `src/shell/coordinate.mjs` (imports it from there)
- `src/shell/single-run.mjs`, `src/shell/single-run.test.mjs` (the alert pass)

## Interface

```js
singleEndAlert({ name, base }) → { title: `${name} · ready to merge`, message: `git switch ${base} && git merge pir/${name}`, tags: ['tada'] }
workerEnv(env, { fs }) → { CLAUDE_CLIENT_PRESENCE_FILE } | null     // moved unchanged
// single-run.mjs: each loop turn, views from the live session → notifyStep → ntfy publish/clear;
// on finish ready → singleEndAlert once; on exit → notifyExit clears.
```

The title of an asking alert is `{name or label} · builder|reviewer`, the message `alertText`'s.

## Tests

- [ ] singleEndAlert text exactly as DESIGN §2.10
- [ ] single-run with a fake ntfy: an asking session sends one alert, the answer clears it; a 15-minute reminder with an injected clock
- [ ] ready sends the end alert once; dropped sends none; no notify.json → nothing sent
- [ ] coordinate's existing notify tests pass with `workerEnv` imported from its new home

## Done when

- [ ] single runs alert as DESIGN §2.10 says, proven with a fake publisher
- [ ] `workerEnv` has one definition
- [ ] `npm test` green
