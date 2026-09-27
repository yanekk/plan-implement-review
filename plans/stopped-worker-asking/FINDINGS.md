# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the *entire* record that something was seen
working for real.

**Newest first. Forty words a row, counted, not estimated.** The long version is already in
the commit message that carried the fix. This is the index, not the account.

**What goes here:** what the next session would otherwise rediscover · what you noticed and
left alone under the scope rule · every answer that came back from the user's own hands, dated.

**What does not:** a decision and its reasoning (that is the commit message) · anything the
code or a test now states for itself · a restatement of the row above.

Legend: 📌 fact learned · 🐞 bug found · ✅ verified by hand with the user · ⚠️ left alone (scope).

| Date | | Finding |
|---|---|---|
| 2026-09-27 | ⚠️ | Feature branch red after T01+T02 merged: `loop.test.mjs` "parked: a person message injected into the still-open asking turn…" expects `row: null` after `RESULT`; the real fold now reads stopped → `question` (§2.1). Stale assertion, left for T06. |
| 2026-09-27 | 📌 | Plan review: a trial merge of `pir/real-asking-state` into main conflicts in `src/shell/coordinate.mjs` and `src/shell/harness/run.mjs`, the files T02 and T06 edit. |
| 2026-09-27 | 📌 | Plan review, 24 real logs: no Monitor or background-subagent job anywhere. A foreground Bash auto-backgrounded on timeout appears in `background_tasks_changed` but its `task_started` has `is_backgrounded:false`, so `conversation.mjs`'s background count misses it. |
| 2026-09-27 | 📌 | Planning: `system/background_tasks_changed` carries the full running list, `[]` when the last job ends; only `task_type: local_bash` seen (13 sightings, 12 logs). 12 of 29 turns ended with a job running. Monitor and background subagents unmeasured. |
| 2026-09-27 | 📌 | Planning: `system/post_turn_summary` with `status_category: blocked` appeared after only 1 of 3 asking turns of the real-asking-state T00 worker, so it cannot mark a worker waiting on the person. |
| 2026-09-27 | 🐞 | real-asking-state run, T00: after an un-park the worker asked twice in plain text with no fresh report and read `building` while waiting on the person. The origin of this plan. |
