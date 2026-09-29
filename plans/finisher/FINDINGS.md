# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** Flat prose. Whoever appends, compacts (over 60 rows or
15 KB). Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | `~/.claude/settings.json` and the repo's `.claude/settings.json` allow `Bash(git merge:*)`; the repo also allows `Bash(./install.sh)`. In `default` mode those skip `canUseTool`, so the finisher's fence needs T00's answer (DESIGN §3.3). |
| 2026-09-29 | 🔄 | Rules lookup: user first chose personal-file-wins, then repo first and paths `~/.pir/{repo}/rules/`, `~/.pir/default/rules/` (DESIGN §2.2). |
