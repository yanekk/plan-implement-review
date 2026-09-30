# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 🐞 | `npm test` pty drills (`plan-rig-*`, coordinator drill) fail on timing when several workers run the suite at once (load 25 to 40); each file passes alone. T02 saw 1 then 5 such failures. |
| 2026-09-30 | 📌 | T04: `finish` can arrive with tests still running (`dropped` mid-run), so the shell kills the command. A passed check needs `facts.head` or `decideSingleStep` throws. A dropped report's body stays in `state.accepted.body` for T10's footer. |
| 2026-09-30 | 📌 | T04: the spawn `note` is the raw failed setup result. `formatSetupNote` ends by pointing at `plans/{slug}/DESIGN.md`, which a single run lacks; its last line needs single-run wording (settings files) the design has not given. |
| 2026-09-30 | 📌 | T07, T12: DESIGN §2.6 puts a full stop straight after the reports folder path (`…/reports. Starting point`). Built verbatim; watch that a real session does not read the dot into the path. |
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
