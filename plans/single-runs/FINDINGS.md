# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 🐞 | T04, needs a decision: tests that leave a file git does not ignore make every green run read dirty, so `decideSingleStep` reruns the tests without end and tells nobody. DESIGN §2.4 step 3 names no exit. Found in T02 review. |
| 2026-09-30 | 📌 | T04: a commit the session makes after a green result without reporting is not seen by `decideSingleStep`; the step closes at the idle gate on the tested head. In review that ends `ready` with an untested commit. |
| 2026-09-30 | 📌 | T04: `facts.exited` and `facts.live` must describe the session held now. After a `resumeSession` that a `send` forced, a stale `exited: true` on the next call reads as a crash (`exitCrashed`). |
| 2026-09-30 | 📌 | T04: `finish` can arrive with tests still running (`dropped` mid-run), so the shell kills the command. A passed check needs `facts.head` or `decideSingleStep` throws. A dropped report's body stays in `state.accepted.body` for T10's footer. |
| 2026-09-30 | 📌 | T04: the spawn `note` is the raw failed setup result. `formatSetupNote` ends by pointing at `plans/{slug}/DESIGN.md`, which a single run lacks; its last line needs single-run wording (settings files) the design has not given. |
| 2026-09-30 | 📌 | T12: DESIGN §2.6 puts a full stop straight after the reports folder path (`…/reports. Starting point`). The `pir-single` skill says the stop is not part of the path; watch that a real session obeys. |
| 2026-09-30 | 📌 | `docs/planning-runs.md` says `sessionAsking` is in `plan-run.mjs`; since T03 it is defined in `held-session.mjs` and re-exported from there. T13 should name the new file. |
| 2026-09-30 | 📌 | T03 did not run `./install.sh`: from a task worktree it would put unreviewed code into the engine the live run uses. The engine is installed once `pir/single-runs` is merged. |
| 2026-09-30 | 📌 | A malformed `setup` or `test` makes the whole settings file `bad-settings`, so a plan or build start refuses on it, not only a single run. Follows from the shared `parseSettings`; pinned by a test in T01 review. T13 documents it. |
| 2026-09-30 | 📌 | `commandsRefusalText` for `no-commands` is one line and names only the missing keys, first sentence included (`has no test commands`). Decided with the user in T01; the task doc gave only the both-missing text. |
| 2026-09-30 | 📌 | The pty end-to-end tests (`plan-rig-planning-drill`, `plan-rig-brief-box`, `plan-rig-mouse`, `conversation-rig`) fail on timing when the load average passes about 35, as when sibling workers run `npm test` together. Green at load 10. |
| 2026-09-30 | 📌 | Orphaned `coordinate.mjs helper` (pid 85261) and fake sessions from worktree `pir-reliable-notifications-T03` have run since 2026-09-28. Not this plan's; left alone. |
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
