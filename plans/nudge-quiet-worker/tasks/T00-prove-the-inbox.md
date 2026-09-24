# T00 — prove-the-inbox

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

Prove on this machine that a worker's own hooks can put the coordinator's fixed nudge in front of it
(DESIGN §2.1): a note file the coordinator writes, shown to a worker looping on tool calls by a tool hook,
and to an idle worker by an async hook that wakes it. Settle whether the wake works; if it does not, the
idle case falls back to stop-and-resume (DESIGN §2.1) and this task records that. Capture the facts the
rest of the plan is built on: hook loading at spawn, the note's location, how the note and a person's
reply appear in the transcript, and the transcript line shapes. The probe code is throwaway and is
deleted at the end; what survives is FINDINGS rows and a captured transcript fixture.

The slug is kept from the socket design so every cross-reference stays valid; the task no longer
touches any inbox socket (user decision 2026-09-24).

## Design sections this implements

DESIGN §2.1, §2.8 (the questions), §5.3 `hook-probe`.

## Files

- `spike/nudge-probe.mjs`: throwaway, deleted before the task is marked 🔍. Subcommands `spawn`,
  `nudge`, `status`, `teardown`.
- `spike/probe-hook.mjs`: throwaway hook script the probe's `--settings` points at (tool-hook mode and
  wake-watcher mode), the prototype of T04's `src/shell/nudge-hook.mjs`.
- `src/core/fixtures/transcript-sample.jsonl` (new, kept): a trimmed real transcript that contains
  assistant `tool_use` lines, tool results, a background-task notification, a nudge as it appears when a
  hook shows it (tool-hook and wake), and a message typed by the person into the session (DESIGN §2.4,
  §2.8 question 5). T01's tests parse it. It must hold no secrets or tokens.
- `plans/nudge-quiet-worker/FINDINGS.md`: one row per answered question.

## Interface

```
node spike/nudge-probe.mjs spawn     # claude --bg -n pir-nudge-probe --settings <hook json> "<prompt>" in a
                                     # scratch dir under .claude/worktrees/ (trusted, git-ignored);
                                     # prints id, pid, sessionId
node spike/nudge-probe.mjs status    # the probe's claude agents --json row, transcript path and mtime,
                                     # and whether a note file is waiting
node spike/nudge-probe.mjs nudge "<text>"  # write the note file for the probe's sessionId, atomically
node spike/nudge-probe.mjs teardown  # claude stop, claude rm, remove the scratch dir and any note file,
                                     # then confirm the probe is absent from claude agents --json
```

The probe is spawned the way `platform.spawn` spawns workers (`claude --bg -n <name> <prompt>`, no
permission-mode flag) plus the `--settings` hook config, so the answers hold for real workers. It never
connects to `/tmp/cc-socks` or any inbox socket.

## Tests

No automated tests; this is a spike. The kept fixture file is exercised by T01.

## Done when

- FINDINGS.md has a dated row for each question in DESIGN §2.8, each stating what was observed, not
  what was expected, and one row saying which idle-worker path the plan uses (wake or stop-and-resume).
- `src/core/fixtures/transcript-sample.jsonl` exists and holds each line kind listed above.
- `spike/` is deleted, `teardown` confirmed no probe session is left, and `npm test` is still green.

## Outside actions

- hook-probe — `ask`

## Automated checks (the worker runs these)

```
1. spawn with the tool hook and the wake watcher in --settings; confirm from the transcript or a hook
   side-file that both hooks ran (question 1).
2. ask the probe to run a tool-call wait-loop (a Bash check every 20 s, as separate tool calls);
   `nudge "[pir:nudge probe] …say NUDGED and stop the loop…"` → did the next tool call show it, was the
   note file consumed, how is it labelled in the transcript? (questions 2, 3)
3. ask the probe to start a background `sleep 1200` and end its turn; wait until quiet; `nudge` again →
   did the wake watcher start a new turn that shows the note? (question 4)
4. record the note location used and whether it ever appeared in `git status` of the scratch dir
   (question 6)
5. get a person-typed message into the probe (question 5): first try a way a program can produce one;
   if none exists, ask the person to attach to the probe and type one short line. Compare its transcript
   line with the hook-shown nudge and record exactly which fields tell them apart, or that none do.
6. teardown, and confirm.
```

If step 2 shows the tool hook cannot show the note, stop and raise it with the person before writing
anything else: DESIGN §2.8 says the plan returns to them. If step 3 shows the wake does not work, record
it; the idle case uses stop-and-resume (DESIGN §2.1) and no question is needed. If step 5 finds no field
that tells a person's message from a hook-shown nudge or a notification, stop and raise it: DESIGN §2.4
says the un-park rule falls back in that case.
