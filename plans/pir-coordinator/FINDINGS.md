# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify: a ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts** when this file is over 60 rows or 15 KB. Never drop a ✅ row or its
date; never drop what somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-28 | ✅ | T09 live run `run.mjs pir-coordinator` PASS: agent answered T01 from DESIGN; T02 push denied as the person's; T02 passed, Remote Control on after the pass; user answered on the phone and confirmed pointer and late appearance; main-sync conflict resolved; REPORT.md committed. |
| 2026-09-28 | 📌 | T09: `capture.mjs` now copies `control/coordinator/ledger.jsonl` and reads `steps.json` into the bundle; not in the task's file list, needed for the facts. |
| 2026-09-27 | 📌 | T11 drill: while the `tests-fix` helper runs, the footer still reads `preparing: syncing main, writing the report`. Wording not T11's; left. `./install.sh` still to run once the feature branch holds T11. |
| 2026-09-27 | 📌 | T10: the `tests-fix` worker (role `fix`) sits in `state.tasks` beside `main-sync` (`HELPERS` in `coordinate.mjs`); T11's row must cover both. A restart in a red `ready` spawns a fresh fix attempt, then rewrites the footer. |
| 2026-09-27 | 🔄 | T07: red tests at the end get one fix worker, like a main-sync conflict; still red after it ends `not ready` (user). Added T10 end-tests-fix, blocks T09. Replaces labelling the red end on the dashboard. |
| 2026-09-27 | 🔄 | T07: the main-sync (and T10 tests-fix) worker gets a row in `pir` so a passed-on question is answerable there, not only on the phone (user). Added T11 end-helper-row, blocks T09. |
| 2026-09-27 | 🐞 | T07 drill fixed: agent header read `coordinator  worker <id>` (now `agent`); a label over 24 columns pushed its row's clock out of line; `preparing the hand-off…` was cut at 80 columns (now `preparing: syncing main, writing the report`). |
| 2026-09-27 | 📌 | T07: the run view's title reads `● running` while the run waits in `ready to merge`, as it did for `asking you` before this plan; the footer says ready. Left. |
| 2026-09-27 | 📌 | Pre-existing: the watch hint without the agent (`↑↓ pick a task · … · esc quit`) is cut to `esc` at 80 columns. Not this plan's screen. |
| 2026-09-27 | 📌 | T06 review: the agent's conversation is headed `coordinator  worker <id>`, and a run whose agent hand-off is red lists as `running`, not as waiting on the person. Both left for the T07 drill to judge. |
| 2026-09-27 | 📌 | T06 shows `runState.handoff` but gives the `main-sync` worker no row or key: a question the agent passes on from it is reachable only on the phone, not in `pir`. Needs a task or T07/T08 decision. |
| 2026-09-27 | 📌 | T05: the plan rig drives the end to `ready` through the real `pir` (fake agent `coordinatorScript`); the finished path and `renderFinished` in `main()` are not. T06 should show `runState.handoff` and the `main-sync` worker (role `sync`). |
| 2026-09-27 | 📌 | T04 and T05 engine changes are not installed: `./install.sh` is not run from a task branch while a run is live. Run it once the feature branch holds them, before any live check (T09) uses the installed `pir`. |
| 2026-09-27 | 📌 | `pir start` usage text is pinned by tests and does not mention `--no-coordinator` (T04 left it). T08's docs and README must carry the flag. |
| 2026-09-27 | 🐞 | The agent's session is not in `workers.json`, so a SIGKILLed coordinator leaves it running; `reapRecorded` never finds it. Teardown and HALT close it (T04). |
| 2026-09-27 | 🐞 | `worker-proc` canUseTool logs no `matchedAskRule`, so `reservedFor` never sees it; the settings match alone carries the ask bin (T04). Harmless while CLI 2.1.283 sends none. |
| 2026-09-27 | 📌 | `coordinator-agent.test.mjs` hung once under the full suite (a fake-claude child alive 11 min); passed alone and on rerun. Watch for a close/exit race under load. |
| 2026-09-27 | 🔄 | Agent fence (T00): in `default` mode `EnterWorktree` (made a worktree and branch), `CronCreate` and `ListAgents` ran without `canUseTool`. User chose a `tools` allowlist (Read, Glob, Grep, Write, Skill), measured to hold; DESIGN §3.4 updated. T03 passes `tools` through `startWorker`. |
| 2026-09-27 | 📌 | CLI 2.1.283, `default` (T00 case 3): a Write to the absolute drop folder reached `canUseTool` ("Path is outside allowed working directories") and landed; a cwd Write was denied. Read/Glob/Grep in cwd and Skill without `allowed-tools` skip the gate. |
| 2026-09-27 | 📌 | A cwd under `/tmp` reaches the CLI as `/private/tmp`; tool paths arrive in that form, so the gate must compare realpaths. |
| 2026-09-27 | 📌 | CLI 2.1.283, `auto` (T00 case 2): `rm -rf ./scratch-dir` and `git reset --hard` ran with no `canUseTool` call; the classifier allowed both. The agent never sees them; plan unchanged (§2.4). |
| 2026-09-27 | 📌 | CLI 2.1.283, `auto` (T00 case 1): `git push origin HEAD` under `permissions.ask ["Bash(git push:*)"]` reached `canUseTool` with no `matchedAskRule`, `decisionReason` or `defaultToNo`; without the rule it ran unasked. T01's settings match carries the ask bin alone. |
| 2026-09-27 | 📌 | The runs list now reads `asking you` for a build while `askingCount` (`display.mjs`) is non-zero. T06 must make it count only person-held asks, or coordinator-held ones turn the run amber. |
| 2026-09-27 | 📌 | SDK 0.3.282 custom tools (`createSdkMcpServer`, `tool()`) need peers `zod` ^4 and `@modelcontextprotocol/sdk` ^1.29, not installed here. Hence decision files (DESIGN §2.3). |
| 2026-09-27 | 📌 | SDK 0.3.282 `CanUseTool` options carry `matchedAskRule {source, toolName, ruleContent}` for asks forced by a `permissions.ask` rule, and `defaultToNo`. CLI 2.1.283 sent neither in T00's probes. |
| 2026-09-27 | 🔄 | The person first wanted the agent to merge, then chose "leave merging to me": the agent prepares the branch and hands over (DESIGN §2.9). |
