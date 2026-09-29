# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
