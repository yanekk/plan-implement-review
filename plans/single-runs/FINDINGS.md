# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 📌 | `commandsRefusalText` for `no-commands` is one line and names only the missing keys, first sentence included (`has no test commands`). Decided with the user in T01; the task doc gave only the both-missing text. |
| 2026-09-30 | 📌 | The pty end-to-end tests (`plan-rig-planning-drill`, `plan-rig-brief-box`, `plan-rig-mouse`, `conversation-rig`) fail on timing when the load average passes about 35, as when sibling workers run `npm test` together. Green at load 10. |
| 2026-09-30 | 📌 | Orphaned `coordinate.mjs helper` (pid 85261) and fake sessions from worktree `pir-reliable-notifications-T03` have run since 2026-09-28. Not this plan's; left alone. |
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
