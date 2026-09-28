# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.
Flat prose, at most one bold phrase a row.

**Whoever appends, compacts** once this file passes 60 rows or 15 KB. Never drop a ✅ row or its
date, or anything somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-28 | 📌 | pi-tui 0.87.1 Editor: a pick closes the pop-up and nothing reopens it; `/` is dropped from trigger characters. `tryTriggerAutocomplete()` (TS-private) reopens it; a synthetic Tab auto-applies a single suggestion unseen. See DESIGN §3.3. |
| 2026-09-28 | 📌 | A fresh worktree has no `node_modules`; `npm ci` then `npm test` green in about four minutes, `git status` clean. |
