# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** Flat prose. Whoever appends, compacts (over 60 rows or
15 KB). Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 🔄 | T07: the live-view footer while the finisher is on is one line per phase, each naming `c`: `◆ finisher preparing · c to watch`, `finishing · c to watch`, `stuck · c to review and say go`, `asking you · c to answer` (user, 2026-09-29). T08 carries it to docs. |
| 2026-09-29 | 📌 | T06 review: a `ready` re-written while `awaiting-go` keeps the first alert's text, so the 15-minute reminder can name the old step count. Only a re-sync (back to `preparing`) starts a new alert. Left as is. |
| 2026-09-29 | 📌 | T05 review: after a `red` or `gave-up` fallback, `finisher/state.json` stays, so a pir restart starts no coordinator agent (`priorFinisher`) and the run waits without one. Left as is. |
| 2026-09-29 | 🔄 | T05: main moving before a go and the re-sync turning red closes the finisher; the run waits red as today and never hands over again (user, 2026-09-29). Not in DESIGN §2.8; T08 carries it to `docs/finisher.md`. |
| 2026-09-29 | 📌 | T05: the done-when harness run with the agent reaching the finisher was not run; the user left the live check to T10. The drills' fake has no `pir-finisher` script, so the finisher idles there; T09 adds one. |
| 2026-09-29 | 📌 | T03 review: `checkStatus` accepts neither `ready` nor `stuck` in phase `stuck`, so a finisher restarted mid-finish, or revising steps while stuck, cannot record new steps; they appear only in its reply. T04/T05 may want pir to record them. |
| 2026-09-29 | 🐞 | T01 review: an expansion in a git part (`$(…)`, `${X:=…}`, `$'…'`, `{a,b}`) smuggled `--output` or `-c` past `isLookOnly`; `git log $(echo --output=/tmp/x)` wrote the file. Now refused. Unquoted globs still expand to existing filenames. |
| 2026-09-29 | 📌 | T04: a go counts only for a go question first seen after the latest accepted ready/stuck; one asked just before `ready` but drained in the same pass still counts. `defaultToNo` in `finishing` now parks (finisher-agent `decide`). |
| 2026-09-29 | 📌 | T00 Q5: an `AskUserQuestion` sent on by the hook's `ask` and answered through `startWorker`'s `answer` with `answersResult` logs a `reply` whose `result.updatedInput.answers` is `{"Pick one?":"Blue"}`; the tool result carried the chosen label. |
| 2026-09-29 | 📌 | T00 Q2: the hook also fired for a `Bash` call made by a sub-agent (`Agent` tool) and its deny held. A hook returning `{}` falls through to the settings' rules, so an allow-ruled command then runs unseen. |
| 2026-09-29 | 📌 | T00 Q2: `permissionDecision: 'ask'` from the hook sends allow-ruled `touch` and `git merge` on to `canUseTool`, so `decide` and parking work. Deny reaches the model as `PreToolUse:<Tool> hook error: <reason>`. Q3 and Q4 not measured. |
| 2026-09-29 | 📌 | T00 Q2: SDK `hooks: { PreToolUse: [{ hooks: [cb] }] }` in `default` mode runs for Bash, Read, Write, AskUserQuestion, EnterWorktree, CronCreate, ListAgents, ToolSearch, Agent; its `permissionDecision: 'deny'` stopped allow-ruled `git merge` (DESIGN §3.3). |
| 2026-09-29 | 📌 | T00 Q1 (2.1.284, SDK 0.3.282): in `default` mode with `canUseTool` only, allow-ruled `git merge side` ran without reaching `canUseTool`. Allow-ruled `touch probe.txt` did reach it, unexplained. |
| 2026-09-29 | 📌 | `src/shell/plan-rig.test.mjs` end-to-end tests flake under a full `npm test` at high load from parallel workers (timeouts, exit 241, stale `live` header); they pass alone and on re-run. Not T00, T01 or T02. |
| 2026-09-29 | 📌 | `pir notify test` sends a real push, so it is not a read-only login check; DESIGN §5.3 uses `test -f ~/.pir/notify.json` instead. |
| 2026-09-29 | 📌 | `~/.claude/settings.json` and the repo's `.claude/settings.json` allow `Bash(git merge:*)`; the repo also allows `Bash(./install.sh)`. In `default` mode those skip `canUseTool`, so the finisher's fence needs T00's answer (DESIGN §3.3). |
| 2026-09-29 | 🔄 | Rules lookup: user first chose personal-file-wins, then repo first and paths `~/.pir/{repo}/rules/`, `~/.pir/default/rules/` (DESIGN §2.2). |
