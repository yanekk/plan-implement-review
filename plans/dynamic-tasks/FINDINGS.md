# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. This is
the index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-21 | 📌 | Dispatch needs no change: `decideDispatch` is already pure over the parsed table and the loop re-parses `PROGRESS.md` every pass. The whole feature is adoption at merge; a larger table dispatches for free. |
| 2026-09-21 | 📌 | `mergeTask` protects `PROGRESS.md` by restoring the feature's copy verbatim (worktree.mjs, fake mirror). Adoption replaces that verbatim restore, so both live and restart merge paths get it — both call `mergeTask`. |
