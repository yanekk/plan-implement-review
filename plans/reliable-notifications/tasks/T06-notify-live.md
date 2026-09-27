# T06 — notify-live

**Phase:** 3 · **Depends on:** T03, T05 · **Weight:** medium

## Goal

See it on the user's iPhone in a real run: the alert arrives when a real worker starts waiting, its
tap lands on that worker's chat, the reminder comes once, and the Claude app stays quiet. This is the
only proof that the feature fixes what the brief complained about.

## Design sections this implements

DESIGN §1 success criteria, §5.1, §5.3.

## Files

- `src/shell/harness/fixtures/notify-live.mjs` (new), registered where fixtures are registered, with its
  fixture test. One task whose wording is unspecified so the worker drops a `question` report and parks
  (the `human-decision` T01 pattern). Harness timeout 30 min.
- The harness run must read the user's real `~/.pir/notify.json`, so the scenario does not set
  `statusSnapshots`: that is what makes the harness point `PIR_HOME` at a scratch folder
  (`seatbeltEnv`), and without it the coordinator inherits `HOME`. Never print or commit the topic.

## Environment (the worker owns this)

```
PIR_NOTIFY_REMIND_MS=120000 node src/shell/harness/run.mjs notify-live --into /tmp/notify-live
# teardown: the harness tears down on finish or timeout; then confirm no worker is left
touch /tmp/notify-live/plans/notify-live/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/notify-live
```

The reminder is shortened to 2 minutes so the check does not wait 15.

## Automated checks (the worker runs these)

- From the bundle: the worker's log has `remote-control` with a url, then `notified` (`reminder: false`)
  within one pass of the task reading asking; `notified` (`reminder: true`) about 2 minutes later; no
  third; a clear after the answer (the flow-log line T05 writes per clear). Record timestamps.

## Outside actions

- Publish alerts to the user's topic — `worker`. Live harness run — `worker` (DESIGN §5.3).

## Needs a person

Before the run, if `~/.pir/notify.json` does not exist (the installed `pir` has no `notify` verb until this
plan is merged and `./install.sh` re-run, so the worker gives the path of its own worktree):

```
node {worker's worktree}/src/shell/pir.mjs notify
```

Expect: a QR code and a topic. Install ntfy from the App Store, subscribe to the topic (scan, or type it).
Tell me: whether the test alert arrived, and what scanning the QR did.

During the run, when the worker is asking:

Expect: an ntfy alert "notify-live · T01 implement" with the start of the question; a reminder about
2 minutes later; no alert from the Claude app.
Tell me: when each arrived; whether the Claude app also buzzed; where tapping the alert took you (the
Claude app on the worker's chat, or the browser); then answer the question on the phone and say whether
the ntfy alert disappeared by itself.

## Done when

- [ ] Automated checks recorded with timestamps in FINDINGS.md.
- [ ] A dated ✅ verified-by-hand row with the person's answers, each claim kept separate.
- [ ] If the Claude app still buzzed, the task stops and the user decides (PLAN, open decisions).
