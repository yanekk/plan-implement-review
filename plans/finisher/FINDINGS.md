# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** Flat prose. Whoever appends, compacts (over 60 rows or
15 KB). Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | `src/shell/plan-rig.test.mjs` end-to-end tests (stop mid-review Ctrl+R, planner stopped mid-question, stale `live` header) failed once each in full `npm test` under parallel-run load (T01, T02); green alone and on rerun. Timing flake. |
| 2026-09-29 | 🐞 | T01 review: an expansion in a git part (`$(…)`, `${X:=…}`, `$'…'`, `{a,b}`) smuggled `--output` or `-c` past `isLookOnly`; `git log $(echo --output=/tmp/x)` wrote the file. Now refused. Unquoted globs still expand to existing filenames. |
| 2026-09-29 | 📌 | `finisherVerdict` hands `reservedFor` only `toolName` and `input`, so the SDK's `defaultToNo` and `matchedAskRule` on a `finishing` request never reach it. T04 should pass or check them. |
| 2026-09-29 | 📌 | `pir notify test` sends a real push, so it is not a read-only login check; DESIGN §5.3 uses `test -f ~/.pir/notify.json` instead. |
| 2026-09-29 | 📌 | `~/.claude/settings.json` and the repo's `.claude/settings.json` allow `Bash(git merge:*)`; the repo also allows `Bash(./install.sh)`. In `default` mode those skip `canUseTool`, so the finisher's fence needs T00's answer (DESIGN §3.3). |
| 2026-09-29 | 🔄 | Rules lookup: user first chose personal-file-wins, then repo first and paths `~/.pir/{repo}/rules/`, `~/.pir/default/rules/` (DESIGN §2.2). |
