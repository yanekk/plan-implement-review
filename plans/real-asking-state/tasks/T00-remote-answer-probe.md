# T00 — remote-answer-probe

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Find out, on this machine, whether pir can tell a turn opened by the person's answer given over Remote
Control from a turn opened by a background job's wake-up. T03 narrows `resumeAnswered` on that signal;
without one it falls back to a skill line. This is a spike: the probe script is deleted afterwards, and
what survives is findings rows and a recorded fixture of real entries.

## Design sections this implements

DESIGN §2.2 (the three candidates and the fallback), §5.2, §5.3 (probe worker row).

## Files

- A throwaway probe script under the job's tmp or a scratch folder, not committed.
- `src/core/fixtures/remote-answer-sample.ndjson` (new): the real conversation-log entries of each case
  below, trimmed to the turns around the answer or wake-up, for T03's tests.
- `plans/real-asking-state/FINDINGS.md`: one row per candidate with its verdict, and the verified-by-hand
  row with the date.

## What to measure

One SDK worker in a scratch repo, started the way `worker-proc.mjs` starts it (`workerOptions`), with
Remote Control switched on (`remoteControl(true)`), plus:

- a `UserPromptSubmit` hook callback in the `query()` options that logs its `source` and `prompt`;
- one run with the replay option on, if the SDK or CLI exposes one headless (find the switch; record if
  none).

Drive these cases, each after the worker has ended a turn with a plain-text question to the person:

1. The person types an answer in the probe's own stdin line, sent `from: 'person'` (control case).
2. The person types an answer on the phone (Claude app, Remote Control).
3. The worker asks with AskUserQuestion; the person picks on the phone.
4. The worker runs a command that needs permission; the person allows it on the phone.
5. The worker started a background Bash job (`node -e "setTimeout(() => {}, 45000)"`; the Bash tool
   refuses a standalone `sleep`, live-workers FINDINGS 2026-09-25) before asking; the job finishes and wakes it.
   The person does not answer.

For each case record: every stream message and hook call from the end of the asking turn to the end of
the next turn, in order, and which of the three candidates (DESIGN §2.2) distinguishes it from case 5.

## Tests

None committed: this is a spike. The fixture file is data for T03's tests.

## Done when

- FINDINGS.md has one dated row per candidate (stream-only, hook `source`, replay) saying whether it
  separates cases 2–4 from case 5, and which T03 should use, or that none does.
- `remote-answer-sample.ndjson` holds the real entries for cases 1, 2 and 5 at least.
- The probe script is deleted and no worker or Remote Control session is left running.

## Environment (the worker owns this)

```
mkdir -p /tmp/real-asking-probe && cd /tmp/real-asking-probe && git init -q
perl -e 'alarm 900; exec @ARGV' node <probe script>        # one worker, Remote Control on
# teardown: the script switches Remote Control off and closes the worker on exit or alarm
pgrep -f real-asking-probe || echo down; rm -rf /tmp/real-asking-probe
```

## Outside actions

- Probe worker, `worker` bin (DESIGN §5.3).

## Needs a person

The worker starts the probe, then asks the person in its session, one case at a time:

- Case 2: "Open the Claude app, find the session named `real-asking-probe`, and type any reply to its
  question." Expect: the probe prints the next turn. Tell me: that you sent it, and roughly when.
- Case 3: "The session is showing a question with options; pick any option on the phone."
- Case 4: "The session is asking to run a command; allow it on the phone."

Only the person's phone can produce Remote Control input. The worker reads and judges the recorded
entries itself.
