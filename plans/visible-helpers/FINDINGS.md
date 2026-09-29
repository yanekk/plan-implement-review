# Findings log

What the build taught. Newest first, forty words a row, counted. Whoever appends, compacts (over 60
rows or 15 KB). Never drop a ✅ row or its date, or a term someone would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 🔄 | T03: the person chose `1 step`, not `1 steps`, on the helper line. |
| 2026-09-29 | 📌 | T03: the parent's `⎿ Agent` step line shows the tool result's last line, which is Claude's "agentId: … (internal ID - do not mention to user…)" text. Unchanged here. |
| 2026-09-29 | 📌 | T03: `openScreen.waitFor` needs output quiet for `settleMs`; a running helper repaints every `stepMs`, so e2e on the `helpers` rig needs `settleMs` below `stepMs` (used 100 vs 400). |
| 2026-09-29 | 🐞 | T04 review: `stoppedByInterrupt` kept an idle-parent interrupt's window open until the next turn's `result`, sweeping in helpers the agent stopped itself. Fixed: the next `out message` closes the window too. |
| 2026-09-29 | 📌 | T02 review: the `helpers` rig emits A's idle progress for only 200 rounds (~140 s at `stepMs` 700), then A sits frozen but running; the CLI has no `--step-ms`. Its system events reuse fixed `uuid`s. T06 may need longer. |
| 2026-09-29 | 🐞 | T01 review: `helpersOf` listed a nested helper (its Agent call in a helper frame) as a second helper; fixed, it now rolls up per DESIGN §2.1. The T01 doc's "one per local_agent task_started" means top-level only. |
| 2026-09-29 | 📌 | Plan-review probe, Claude Code 2.1.284: an interrupt while the parent is idle kills its background helper and the helper's own background Bash (`task_updated killed`, `task_notification stopped`) and emits no `result`. That Bash's `task_started` has no `parent_tool_use_id`. |
| 2026-09-29 | 📌 | In `pir plan`, text the planner wrote just before an AskUserQuestion did not reach the person; they asked for the task list again. Put anything the person must read inside the question text. |
| 2026-09-29 | 📌 | Probe, Claude Code 2.1.284: a helper's `canUseTool` carries `agentID` = its `task_id` and arrives before the helper's tool_use frame. A foreground helper sends `task_started` with `is_backgrounded: false`. |
| 2026-09-29 | 📌 | plan-0339 (`finisher`): Esc killed the planner's background helper (`task_updated killed`, `task_notification stopped`); the model saw only "Request interrupted" and later claimed to be waiting for it. Log excerpt in `evidence/`. |
