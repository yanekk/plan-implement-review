# T00 — prove-the-inbox

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

Prove on this machine that a plain Node program can post a message into a real `claude --bg` worker
through its inbox socket, and capture the facts the rest of the plan is built on: delivery, labelling,
socket location, and the transcript line shapes. Nothing else in this plan is worth building if the
post does not reach the worker. The probe code is throwaway and is deleted at the end; what survives
is FINDINGS rows and a captured transcript fixture.

## Design sections this implements

DESIGN §2.8 (the six questions), §2.1, §5.3 `inbox-probe`.

## Files

- `spike/nudge-probe.mjs`: throwaway, deleted before the task is marked 🔍. Subcommands `spawn`,
  `post`, `status`, `teardown`.
- `src/core/fixtures/transcript-sample.jsonl` (new, kept): a trimmed real transcript that contains
  assistant `tool_use` lines, tool results, a background-task notification, and a received probe
  message. T01's tests parse it. Strip anything that is not needed; it must hold no secrets or tokens.
- `plans/nudge-quiet-worker/FINDINGS.md`: one row per answered question.

## Interface

```
node spike/nudge-probe.mjs spawn     # claude --bg -n pir-nudge-probe "<prompt>" in a scratch dir under
                                     # .claude/worktrees/ (trusted, git-ignored); prints id, pid, sessionId
node spike/nudge-probe.mjs status    # the probe's claude agents --json row + transcript path and mtime
node spike/nudge-probe.mjs post "<text>"   # node:net connect to the socket, write one JSON line
                                     # {"type":"user","message":{"role":"user","content":text}}, no auth
                                     # line, print whatever the server writes back and the close reason
node spike/nudge-probe.mjs teardown  # claude stop, SIGTERM the pid, claude rm, remove the scratch dir,
                                     # then confirm the probe is absent from claude agents --json
```

Run `post` from a process that is not the probe's child. The probe must be spawned the same way
`platform.spawn` spawns workers (`claude --bg -n <name> <prompt>`, no permission-mode flag), so the
delivery answer holds for real workers.

## Tests

No automated tests; this is a spike. The kept fixture file is exercised by T01.

## Done when

- FINDINGS.md has a dated row for each of the six questions in DESIGN §2.8, each stating what was
  observed, not what was expected.
- `src/core/fixtures/transcript-sample.jsonl` exists and holds each line kind listed above.
- `spike/` is deleted, `teardown` confirmed no probe session is left, and `npm test` is still green.

## Outside actions

- inbox-probe — `ask`

## Automated checks (the worker runs these)

```
1. spawn a probe that runs `sleep 1200` in the background and ends its turn; wait for it to go quiet;
   `status` → record status/state and transcript mtime (question 3's precondition).
2. post "[pir:nudge probe] …reply with the word NUDGED…" → did a new turn start? what lines were
   appended to the transcript, and how is the message labelled? (questions 1, 2, 3)
3. post again while the probe runs a tool-call wait-loop you asked it to run (e.g. a Bash check
   every 20 s, as separate tool calls) → read between tool calls? (question 4)
4. compare the pid across turns and the socket path under /tmp/cc-socks* (question 5)
5. teardown, and confirm.
```

If step 2 shows the message was refused, or held for approval, stop and raise it with the person
before writing anything else: DESIGN §2.8 says the plan returns to them in that case.
