# T05 — coordinator-alerts

**Phase:** 2 · **Depends on:** T01, T02, T04 · **Weight:** medium

## Goal

Wire the machine into the build run: each pass, turn the live workers into views, run the episode
machine, and fire the publishes and clears, with the conversation showing what the phone was told.
This is the task that makes the feature exist in a real `pir start`.

## Design sections this implements

DESIGN §2.1–§2.6, §3.3.

## Files

- `src/shell/coordinate.mjs`: views after `syncRemote`, `notifyStep`, action runner, `notifyExit` on
  every exit path, `workerEnv` passed to `createPlatform`.
- `src/core/conversation.mjs`, its test: `noteLines` cases `notified` and `notify-failed`.
- `src/shell/coordinate.test.mjs` (or a new `notify-wiring.test.mjs` beside it).

## Interface

```
notifyViews({ plan, workers, stateTasks, wanted, remoteOn }) → views   // exported, shell-side, pure enough to test
runNotifyActions(actions, { readConfig, publish, clear, note, log, now }) → Promise   // main does not await it,
                                                  // except the exit clears (bounded 2 s, DESIGN §3.3)
notifyPass({ platform, stateTasks, notifyState, remote, now, run }) → notifyState
  // one pass: workers() → notifyViews → notifyStep → run(actions). main calls it after the REMOTE-gated
  // syncRemote, every pass, whatever REMOTE is. Extracted because main() builds the real platform and
  // cannot be driven with the fake one.
// log: control.log, one line per publish and clear with worker id, seq and status; never the topic.
//      T06 reads the clears from the flow log.
// notes: platform.note(id, 'notified', { reminder })        → '· alert sent to your phone' / '· reminder sent …'
//        platform.note(id, 'notify-failed', { status, error }) → '· alert not sent: {status or error}'
workerEnv = () => readNotifyConfig() is a config ? { CLAUDE_CLIENT_PRESENCE_FILE: ensurePresenceMarker() } : null
```

`remote` in a view is `refused` if the worker's Remote Control was refused, `off` if `REMOTE` is false,
else `wanted`. `lastText` for a report-less question is the `lastText` field of the worker's `workers()` row (T04).

## Tests

- [ ] Views: a report-parked task, a pending permission, a pending question set each give the right
      kind and message; a worker not in `wanted` gives `waiting: null`; a non-holder worker is excluded.
- [ ] Action runner: no config drops every action and notes nothing; a send notes `notified`; a failed
      send notes `notify-failed` once; a failed clear notes nothing.
- [ ] A clear for an episode whose send is still in flight goes out after the send settles.
- [ ] `notifyPass` over passes with the fake platform and a fake publisher: a worker turning to asking
      yields one send with the fake url as `click`; answered yields one clear; `remote: false` yields a
      send with no click, immediately.
- [ ] Exit clears sent open episodes and waits at most 2 s for them; a source check that `main` runs
      `notifyPass` on every pass and the exit clears on the signal, halt, stall and error paths.
- [ ] The flow-log lines name worker, seq and status and never the topic.
- [ ] `workerEnv` returns null with no config and the variable with one; the marker file exists after.
- [ ] `noteLines` renders both new notes; neither is in `ANSWER_NOTES`.

## Done when

- [ ] Tests pass; existing coordinator tests unchanged and green.
- [ ] No request leaves the process in any test.
