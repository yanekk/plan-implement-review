# T09 — launchd-check

**Phase:** 4 · **Depends on:** T05, T06 · **Weight:** medium

## Goal

See the real code under the real launchd, without touching the real login item: a scratch-labelled
agent is registered from a temp folder, answers, is killed and must come back, and is removed. This is
the only proof before the merge that "kill the service and it comes back" holds for `api-service.mjs`.

## Design sections this implements

DESIGN §1 success criteria (the third), §5.1, §5.2, §5.3.

## Files

- `src/shell/harness/service-live-check.mjs` (new), modelled on `harness/real-fetch-check.mjs`
- `src/shell/harness/service-live-check.test.mjs` (new): the sequence against fakes

## Interface

```js
// label 'com.pir.api-service.check'. Everything lives in mkdtemp(tmpdir()/pir-service-check-):
// the home, the plist, nothing under ~/Library/LaunchAgents. The plist runs this checkout's
// api-service.mjs with EnvironmentVariables { PIR_HOME: <that folder> }, so the service takes an
// OS-chosen port and writes its api.json there (DESIGN §2.8).
export async function serviceLiveCheck({ launchctl, get, kill, sleep, tmp, log }) // → { ok, lines, dir }

// node src/shell/harness/service-live-check.mjs → prints each line, exits 0 or 1.
```

The sequence, each step a printed line with its measured time:

1. `serviceOn` with `scratchItem: true` → `api.json` appears, `GET /health` answers with the pid in it,
   `GET /v1/usage` answers 200 with nulls.
2. Wait until the service has been up 11 s (launchd's 10 s minimum runtime), `kill -9` its pid →
   a new pid in `api.json` within 5 s, and it answers.
3. `kill -9` again at once → back within 15 s (the throttled restart).
4. `serviceRefresh` with the same scratch options → a new pid, answering.
5. `serviceOff` with the same options → `api.json` gone, `launchctl print` of the label fails.

`finally`: `launchctl bootout` of the label, then delete the folder, whatever happened. The check
refuses to start if the label is already loaded, and says how to remove it.

## Tests

- [ ] with fake `launchctl`, `get` and `kill`: the five steps run in order and `ok` is true
- [ ] a step that fails (no new pid after the kill) → `ok` false, the later steps skipped, the teardown still run
- [ ] the label already loaded → refuses, registers nothing
- [ ] the folder is gone after a pass and after a failure
- [ ] static: the file never names `com.pir.api-service` without the `.check` suffix and never writes under `Library/LaunchAgents`

## Outside actions

- Temporary login item — `worker`

## Automated checks (the worker runs these)

```
node src/shell/harness/service-live-check.mjs
launchctl print gui/$(id -u)/com.pir.api-service.check    # must fail: nothing left behind
```

Record the printed lines and both exit codes in FINDINGS, dated. If macOS shows a "background item
added" notice, say so in the row: the person will see the same one at the real install.

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] The check ran on this machine and exited 0, and the label is not loaded afterwards.
- [ ] Its result is a dated FINDINGS row, marked worker-driven.
