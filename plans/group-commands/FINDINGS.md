# Findings log

**What the build taught.** Read the rows touching the task you pick up. A ✅ row is the entire record
that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Whoever
appends compacts first if this file is over 60 rows or 15 KB. Never drop a ✅ row or its date, or a
term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | A fresh worktree fails `npm test` until `npm ci` runs (no `node_modules`); with it, green in about 3.5 minutes. |
| 2026-09-29 | 📌 | This branch was cut before box-commands merged to `main` (`d495ace`); that merge touched `README.md`, `docs/detached-runs.md` and `pir-tui.mjs`, not the conversation files. T03 edits the docs as they are on the build branch. |
