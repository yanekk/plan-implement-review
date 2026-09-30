# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 📌 | T11, T12: the fake ntfy is `ntfyPublish` and `ntfyClear` in `runSingle`'s deps, which a detached program cannot be given. The pty rig's scratch `PIR_HOME` has no `notify.json`, so a rig run sends nothing. |
| 2026-09-30 | 📌 | T13: the end alert is sent on the `finish` action only. A program killed between writing `outcome: ready` and the send never sends it: `--resume` takes the nothing-to-resume exit. A resumed session's alert reuses seq `pir-{sessionId}-1`. |
| 2026-09-30 | 📌 | T09, T11: a second `startSingle` in one rig names `rig-fix` again; pir refuses the taken name and the build step parks `asking`. Use a fresh rig per single run. Seen in T08 review. |
| 2026-09-30 | 📌 | T10: the screen test in `plan-rig-single.test.mjs` only waits for the `rig-fix` row, which reads `work ◌ finished` today, and asserts the snapshot's runState. Tighten it to `single` and `ready to merge`. |
| 2026-09-30 | 📌 | T09, T11: a rig run's record and control folder carry git's resolved path (`/private/var/…`); `rig.repoDir` does not. Build control-folder paths from `started.record.repoPath`, as `controlOf` in `plan-rig-single.test.mjs` does. |
| 2026-09-30 | 📌 | The fake's `{{reportsDir}}` reads to the end of the line, wrong for a single run's opening. The rig's single scripts drop reports with `sessions.mjs single-report`; `single-run.test.mjs` cuts the folder itself (`REPORT_JS`). |
| 2026-09-30 | 🐞 | T13: `singleChecks` also refuses a `built` name whose `plans/{name}/.parallel/single` exists. A removed run leaves it, and the rename then split the control folder in two. Reproduced by a scratch run, fixed in T04 review, test locks it. |
| 2026-09-30 | 📌 | `plan-run.mjs` has the same rename code: a leftover `plans/{slug}/.parallel/plan/state.json` of a removed planning run reads as this run's folder already moved. Not this plan's file; left alone. |
| 2026-09-30 | 📌 | T10: `resumeRun` does not refuse a finished single record; it spawns `single-run.mjs --resume` as it does for a plan record. Not offering resume on `ready` and `dropped` rows is `canResume`'s job (DESIGN §2.11). |
| 2026-09-30 | 📌 | T09: `startSingleRun`'s `bad-settings` refusal carries `file` and `why` beside `message` (added in T05 review, also on `planPreflight`). Word the box's `its pir settings are broken: {why}` from `why`; `message` is `refusalText`'s full line. |
| 2026-09-30 | 📌 | T13: `README.md`'s skills tree (near `pir-finisher/`) lists every skill folder; `pir-single/` is not in it, and T13's file list does not name that tree. Found in T07 review. |
| 2026-09-30 | 📌 | T13, T05: the command line in flight is recorded in the control folder's `command.json` (pid, startTime); `single-run.mjs` kills it at its next start. `pir` stop reaps `workers.json` only, and DESIGN §6 recovery does not name the file. |
| 2026-09-30 | 📌 | T10: the snapshot step entries are planning's plus `round` and `testingSince`; phases `building`, `reviewing`, `testing`, `asking`, `done`, `failed`, `pending`; the `merge` entry is `ready` or `pending`. `merged` is not in the snapshot. |
| 2026-09-30 | 📌 | T07, T12: `resumeInstruction()` is reused unchanged (DESIGN §2.6) and tells a resumed single session to check "the plan files", which a single run has none of. |
| 2026-09-30 | 🔄 | T13: tests green on the reported commit but the tree dirty: the session gets `leftoverMessage` and the step waits for a new report (user, T04). DESIGN §2.4 step 3 still says rerun; a moved head still reruns. |
| 2026-09-30 | 📌 | A commit or edit after a green result, unreported: `single-run.mjs` re-reads head and status at the idle gate and puts the accepted claim through `singleChecks` again, so the step never closes on an untested commit. |
| 2026-09-30 | 📌 | T10: a dropped report's body stays in `state.accepted.body` of state.json for the footer; the snapshot's runState does not carry it. |
| 2026-09-30 | 🔄 | The failed-setup note of a single run is `formatSingleSetupNote` (single-run.mjs): no plan wording, last line names the setup lines pir runs (user, T04). `formatSetupNote` stays the build's. |
| 2026-09-30 | 📌 | T12: DESIGN §2.6 puts a full stop straight after the reports folder path (`…/reports. Starting point`). The `pir-single` skill says the stop is not part of the path; watch that a real session obeys. |
| 2026-09-30 | 📌 | `docs/planning-runs.md` says `sessionAsking` is in `plan-run.mjs`; since T03 it is defined in `held-session.mjs` and re-exported from there. T13 should name the new file. |
| 2026-09-30 | 📌 | T03 did not run `./install.sh`: from a task worktree it would put unreviewed code into the engine the live run uses. The engine is installed once `pir/single-runs` is merged. |
| 2026-09-30 | 📌 | A malformed `setup` or `test` makes the whole settings file `bad-settings`, so a plan or build start refuses on it too. Follows from the shared `parseSettings`; pinned by a T01 review test. T13 documents it. |
| 2026-09-30 | 📌 | `commandsRefusalText` for `no-commands` is one line and names only the missing keys, first sentence included (`has no test commands`). Decided with the user in T01; the task doc gave only the both-missing text. |
| 2026-09-30 | 📌 | Pty end-to-end tests (`plan-rig-*`, `conversation-rig`) fail under sibling-worker load and pass alone: timing past load average 30; `plan-rig-box-start` once with `ENOTEMPTY` in rig cleanup at load 14. `the helpers scenario drives the real pir screen` fails most often. |
| 2026-09-30 | 📌 | Orphaned `coordinate.mjs helper` (pid 85261) and fake sessions from worktree `pir-reliable-notifications-T03` have run since 2026-09-28. Not this plan's; left alone. |
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
