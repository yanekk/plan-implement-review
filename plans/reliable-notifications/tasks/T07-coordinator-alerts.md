# T07 — coordinator-alerts

**Phase:** 2 · **Depends on:** T01, T02, T04, T05 · **Weight:** medium

## Goal

Wire the alerts into the build run: each pass, turn the workers that are the person's into views, run the
episode machine and fire the publishes and clears; send the end-of-run alert once; start workers and the
agent with the Claude app silenced. The conversations show what the phone was told. This is the task that
makes the feature exist in a real `pir start`.

## Design sections this implements

DESIGN §2.1–§2.8, §3.3.

## Files

- `src/shell/coordinate.mjs`: `handoffView()` gains `unresolved`; views after `syncRemote`, `notifyStep`, the action runner, the end-of-run
  alert, `notifyExit` on every exit path, `workerEnv` passed to `createPlatform` and `env` to
  `startCoordinatorAgent`.
- `src/core/conversation.mjs`, its test: `noteLines` cases `notified` and `notify-failed`.
- `src/shell/coordinate.test.mjs` (or a new `notify-wiring.test.mjs` beside it).

## Interface

```
notifyViews({ plan, workers, stateTasks, heldByAgent, why, remoteOn }) → views
  // exported, shell-side; waiting from waitingFor(...).holder === 'person', message via alertText with
  // why.get(worker id) ?? null
runNotifyActions(actions, { readConfig, icon, publish, clear, note, log, now }) → Promise
  // main does not await it, except the exit clears (bounded 2 s, DESIGN §3.3)
notifyPass({ platform, coordinator, notifyState, remote, now, run }) → notifyState
  // one pass: workers() → notifyViews → notifyStep → run(actions). main calls it after the REMOTE-gated
  // syncRemote, every pass, whatever REMOTE is. Extracted because main() builds the real platform and
  // cannot be driven with the fake one.
endAlertPass({ r, coordinator, slug, sent, send }) → sent
  // fires endAlert once when r.handoff?.state first reads 'ready' or 'red' (handoffView carries state, not
  // step; settle() sets both), never on a pass with r.finished; red reason r.testsReason?.reason;
  // unresolved r.handoff.unresolved (handoffView gains it: handoff.sync?.state === 'unresolved');
  // click = coordinator.agent?.remoteUrl()
// Without the agent: the r.complete branch sends endAlert and awaits it, bounded 2 s, before returning.
// log: control.log, one line per publish and clear with worker id (or `end`), seq and status; never the topic.
// notes: platform.note(id, 'notified', { reminder })        → '· alert sent to your phone' / '· reminder sent …'
//        platform.note(id, 'notify-failed', { status, error }) → '· alert not sent: {status or error}'
//        the end alert notes on the agent's conversation when there is one
workerEnv = () => readNotifyConfig() is a config ? { CLAUDE_CLIENT_PRESENCE_FILE: ensurePresenceMarker() } : null
```

`remote` in a view is `refused` if the worker's Remote Control was refused, `off` if `REMOTE` is false,
else `wanted`. `lastText` for a report-less question is the `lastText` field of the worker's `workers()` row
(T04).

## Tests

- [ ] Views: a report park passed on, a reserved permission, a timed-out question set, each give the right
      kind and prefix; a worker the agent holds gives `waiting: null`; a non-holder worker is excluded;
      a helper worker gets its helper title.
- [ ] Action runner: no config drops every action and notes nothing; a send notes `notified`; a failed
      send notes `notify-failed` once; a failed clear notes nothing; every publish carries the icon.
- [ ] A clear for an episode whose send is still in flight goes out after the send settles.
- [ ] `notifyPass` over passes with the fake platform, a fake agent and a fake publisher: a question the
      agent answers yields nothing; the same question passed on yields one send with the fake url as
      `click` and the `passed` prefix; answered yields one clear; `remote: false` yields a send with no
      click, immediately.
- [ ] End alert: sent once when the handoff first reads ready or red, not again on a later pass or a
      re-sync, and not on a pass with `r.finished` (a restart finding main already merged); an unresolved
      main-sync sends the merge-with-main message; without the
      agent, sent and awaited on the complete pass.
- [ ] Exit clears sent open episodes and waits at most 2 s for them; a source check that `main` runs
      `notifyPass` on every pass and the exit clears on every exit path: the signal handlers (classic
      teardown and the detached stop), halt, runaway, stall, error, the no-agent complete and the agent's
      `r.finished`. The signal handlers currently call `process.exit` at once, so they await the clears
      (bounded 2 s) before exiting.
- [ ] The flow-log lines name worker, seq and status and never the topic.
- [ ] `workerEnv` returns null with no config and the variable with one; the marker file exists after;
      the agent is started with the same.
- [ ] `noteLines` renders both new notes; neither is in `ANSWER_NOTES`.

## Done when

- [ ] Tests pass; existing coordinator tests unchanged and green.
- [ ] No request leaves the process in any test.
