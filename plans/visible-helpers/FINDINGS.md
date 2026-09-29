# Findings log

What the build taught. Newest first, forty words a row, counted. Whoever appends, compacts (over 60
rows or 15 KB). Never drop a ✅ row or its date, or a term someone would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | T02 review: the `helpers` rig emits A's idle progress for only 200 rounds (~140 s at `stepMs` 700), then A sits frozen but running; the CLI has no `--step-ms`. Its system events reuse fixed `uuid`s. T06 may need longer. |
| 2026-09-29 | 📌 | Plan-review probe, Claude Code 2.1.284: an interrupt while the parent is idle kills its background helper and the helper's own background Bash (`task_updated killed`, `task_notification stopped`) and emits no `result`. That Bash's `task_started` has no `parent_tool_use_id`. |
| 2026-09-29 | 📌 | In `pir plan`, text the planner wrote just before an AskUserQuestion did not reach the person; they asked for the task list again. Put anything the person must read inside the question text. |
| 2026-09-29 | 📌 | Probe, Claude Code 2.1.284: a helper's `canUseTool` carries `agentID` = its `task_id` and arrives before the helper's tool_use frame. A foreground helper sends `task_started` with `is_backgrounded: false`. |
| 2026-09-29 | 📌 | plan-0339 (`finisher`): Esc killed the planner's background helper (`task_updated killed`, `task_notification stopped`); the model saw only "Request interrupted" and later claimed to be waiting for it. Log excerpt in `evidence/`. |
