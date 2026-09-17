# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything
only a person can verify — a ✅ row is the entire record that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. This is the
index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-17 | 📌 | The implementer marks `🔍` in the same commit as the code (pir-implement steps 6–7); the reviewer marks `✅` in its own commit. So a committed task-branch glyph is atomic with the work — the basis for reading it as ground truth on restart (DESIGN §2.2). |
| 2026-09-17 | 📌 | `buildAssignments` (loop.mjs) treats a tracked task whose session is not in the live list as dead and removes its branch. So reconciliation must merge `✅` branches directly and give a `🔍` review a real fresh session, never seed a sessionless tracked task (DESIGN §2.5). |
</content>
