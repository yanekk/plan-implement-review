# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** Flat prose. Whoever appends, compacts (over 60 rows or
15 KB). Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 🐞 | `npm test` failed three runs in a row on different `src/shell/plan-rig.test.mjs` end-to-end tests (timeouts, exit 241) at load average ~30 from parallel workers; green once load fell to ~10. Docs-only change, so flake, not regression. |
| 2026-09-29 | 📌 | T00 Q5: an `AskUserQuestion` sent on by the hook's `ask` and answered through `startWorker`'s `answer` with `answersResult` logs a `reply` whose `result.updatedInput.answers` is `{"Pick one?":"Blue"}`; the tool result carried the chosen label. |
| 2026-09-29 | 📌 | T00 Q2: the hook also fired for a `Bash` call made by a sub-agent (`Agent` tool) and its deny held. A hook returning `{}` falls through to the settings' rules, so an allow-ruled command then runs unseen. |
| 2026-09-29 | 📌 | T00 Q2: `permissionDecision: 'ask'` from the hook sends allow-ruled `touch` and `git merge` on to `canUseTool`, so `decide` and parking work. Deny reaches the model as `PreToolUse:<Tool> hook error: <reason>`. Q3 and Q4 not measured. |
| 2026-09-29 | 📌 | T00 Q2: SDK `hooks: { PreToolUse: [{ hooks: [cb] }] }` in `default` mode runs for Bash, Read, Write, AskUserQuestion, EnterWorktree, CronCreate, ListAgents, ToolSearch, Agent; its `permissionDecision: 'deny'` stopped allow-ruled `git merge` (DESIGN §3.3). |
| 2026-09-29 | 📌 | T00 Q1 (2.1.284, SDK 0.3.282): in `default` mode with `canUseTool` only, allow-ruled `git merge side` ran without reaching `canUseTool`. Allow-ruled `touch probe.txt` did reach it, unexplained. |
| 2026-09-29 | 📌 | `pir notify test` sends a real push, so it is not a read-only login check; DESIGN §5.3 uses `test -f ~/.pir/notify.json` instead. |
| 2026-09-29 | 📌 | `~/.claude/settings.json` and the repo's `.claude/settings.json` allow `Bash(git merge:*)`; the repo also allows `Bash(./install.sh)`. In `default` mode those skip `canUseTool`, so the finisher's fence needs T00's answer (DESIGN §3.3). |
| 2026-09-29 | 🔄 | Rules lookup: user first chose personal-file-wins, then repo first and paths `~/.pir/{repo}/rules/`, `~/.pir/default/rules/` (DESIGN §2.2). |
