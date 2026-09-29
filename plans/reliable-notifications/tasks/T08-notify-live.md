# T08 — notify-live

**Phase:** 3 · **Depends on:** T03, T06, T07 · **Weight:** medium

## Goal

See it on the user's iPhone in a real run with the coordinator agent on: a question the agent passes on
buzzes the phone with pir's icon and the reason, the tap lands on that worker's chat, the reminder comes
once, a question the agent answers does not buzz, the Claude app stays quiet, and the ready-to-merge alert
arrives at the end. This is the only proof that the feature does what the brief asked.

## Design sections this implements

DESIGN §1 success criteria, §5.1, §5.3.

## Files

- `src/shell/harness/fixtures/notify-live.mjs` (new), registered in `FIXTURES`
  (`src/shell/harness/fixtures.mjs`), with its fixture test. Model it on `pir-coordinator`
  (`fixtures/pir-coordinator.mjs`): `coordinator: true`, two independent tasks at ceiling 2. T01 asks a
  question DESIGN answers (the agent answers it: no alert expected). T02 drops a `question` report on a
  point the project rules file tells the agent to pass on (the alert expected). No `answerPending`: the
  person answers T02 on the phone. `mergeWhenReady: true`, so the end alert fires and the run finishes.
  Harness timeout 30 min.
- `src/shell/harness/scenario.mjs`, `run.mjs` and their tests: a scenario option `realNotify: true` that
  sets `PIR_NOTIFY_CONFIG` to the user's `{HOME}/.pir/notify.json` in the run's environment and passes
  `PIR_NOTIFY_REMIND_MS` and `PIR_NOTIFY_ICON` through from the harness's own environment. Why: the
  harness points `PIR_HOME` at a scratch folder whenever `statusSnapshots` is on, which would hide the real
  config. Never print or commit the topic.

## Environment (the worker owns this)

```
git push origin pir/reliable-notifications      # §5.3 ask: the icon must be online; the prompt is the user's yes
PIR_NOTIFY_REMIND_MS=120000 PIR_NOTIFY_ICON=https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png node src/shell/harness/run.mjs notify-live --into /tmp/notify-live
# teardown: the harness tears down on finish or timeout; then confirm no worker is left
touch /tmp/notify-live/plans/notify-live/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/notify-live
```

Before the push, `curl -sI` the icon URL is expected to 404; after, 200. The reminder is shortened to 2
minutes so the check does not wait 15. After the check, say the way back for the pushed branch
(`git push origin --delete pir/reliable-notifications`) and leave it: the default icon URL points at this
branch (DESIGN §2.5), so deleting it takes the icon offline. Say that when naming the way back.

## Automated checks (the worker runs these)

- From the bundle: T01's log has no `notified`. T02's log has `remote-control` with a url, then
  `notified` (`reminder: false`) within one pass of `coordinator-pass T02` in `control.log`; `notified`
  (`reminder: true`) about 2 minutes later if not yet answered; no third; a clear after the answer (the
  flow-log line T07 writes). The agent's log has `notified` after the report is committed. Record
  timestamps.

## Outside actions

- Push the feature branch — `ask`. Publish alerts to the user's topic — `worker`. Live harness run —
  `worker` (DESIGN §5.3).

## Needs a person

Before the run, if `~/.pir/notify.json` does not exist (the installed `pir` has no `notify` verb until this
plan is merged and `./install.sh` re-run, so the worker gives the path of its own worktree):

```
node {worker's worktree}/src/shell/pir.mjs notify
```

Expect: a QR code and a topic. Install ntfy from the App Store, subscribe to the topic (scan, or type it).
Tell me: whether the test alert arrived, and what scanning the QR did.

During the run, when T02's question is passed on to you:

Expect: an ntfy alert "notify-live · T02 implement", `Agent passed it on: asks: …`, with pir's icon; a
reminder about 2 minutes later if you wait; no alert for T01; no alert from the Claude app. At the end,
"notify-live · ready to merge".
Tell me: when each arrived; whether the icon showed and whether it looks right; whether the Claude app also
buzzed; where tapping the question alert took you (the Claude app on the worker's chat, or the browser);
then answer the question on the phone and say whether the ntfy alert disappeared by itself; and where
tapping the ready-to-merge alert took you.

## Done when

- [ ] Automated checks recorded with timestamps in FINDINGS.md.
- [ ] A dated ✅ verified-by-hand row with the person's answers, each claim kept separate.
- [ ] If the Claude app still buzzed, or the icon did not show, the task stops and the user decides (PLAN,
      open decisions).
