# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first, forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-01 | 📌 | T12 live run, worker-run with real Claude: `single-run-live` PASS in 40 s. Builder fixed `addAll` in one commit as `fix-add-all-off-by-one`; reviewer committed nothing; `ready`, index kind single under the name, nothing left running. Scratch removed. |
| 2026-10-01 | 📌 | The harness answerer sent `go ahead` to the live reviewer between its `reviewed` report and `finished: ready`; `holdPlanReplies` did not hold it. The run was unaffected. A planning run's last session can get the same. |
| 2026-10-01 | 📌 | The live builder said its fix was committed on `pir/fix-add-all-off-by-one` before pir renamed `pir/single-6986`. Wording only; the report and checks were right. |
| 2026-10-01 | 🐞 | T11 drill, worker-driven, 80×24, 120×40, 60×20: whole flow, dropped, taken, beside plan and builds, stop and resume. Fixed: a step's clock cut at 60 columns (`0:1`); a merged run's merge row still said the merge was yours. Tests lock both. |
| 2026-10-01 | 📌 | At 60 columns the list's counts line and every view's key-hint line are cut at the edge, mid-word (`Ctrl+X remo`, `stop thi`). Planning runs and builds too; no rule in DESIGN. Left alone. |
| 2026-10-01 | 📌 | The red-round message names its log under the run's first folder (`plans/single-{hex4}/…/tests-1.log`); after the rename that path no longer exists. Correct when sent; stale when read back in the conversation. |
| 2026-09-30 | 🐞 | T10 review drill, worker-driven: `single-dropped` at 80×24 and 120×40, list, steps view, `c`, `→` on each step, Ctrl+R, Ctrl+X. `→` on a dropped run's review row promised a reviewer. Fixed in `singleNoSessionNote`, test locks it. |
| 2026-09-30 | 📌 | The armed `Ctrl+S` and `Ctrl+X` lines name a single run by its id (`single-02c3`) while its row shows the label; only the resume line uses `displayName`. A planning run does the same. Left alone. |
| 2026-09-30 | 📌 | T10 drill, worker-driven: list and steps view of `single-happy` and `single-red` at 80×24 and 120×40, `→` on merge, `c`. Nothing clipped. Fixed: a full label lost its closing quote at 80 columns. |
| 2026-09-30 | 📌 | The merged check asks about `refs/heads/pir/{name}` and keeps its yes in memory. A branch deleted after the merge reads `ready to merge` again once `pir` restarts. Not decided in DESIGN §2.8. |
| 2026-09-30 | 📌 | T13: `PIR_DASHBOARD_STATE` now publishes `run.kind` `single`, and a builder as role `implement`. `docs/detached-runs.md` still says `"plan" \| "work"`. |
| 2026-09-30 | 📌 | T11: the rig's sessions and test line are instant. `pace()` in `plan-rig-single-row.test.mjs` adds sleeps to the scripts file and a slower test line in the scratch home's settings, so a state stays on screen. |
| 2026-09-30 | 📌 | T09 review drill, worker-driven, both sizes: broken JSON and no-base notes, a 200-character prompt, ← and → from the builder's conversation. No overflow. T10: before the rename the conversation header and the list row show `single-{hex4}`, not the quoted label. |
| 2026-09-30 | 🔄 | A box note wider than the screen wraps at a word, up to three lines (`NOTE_ROWS`, list-view.mjs), for every note (user, T09). DESIGN §2.1's `no setup/test commands` note is 84 characters at a 4-letter repo name. |
| 2026-09-30 | 📌 | T09 drill, worker-driven: `@repo/single` in the rig at 80×24 and 120×40: pop-up, Tab, refusals, the builder's question answered, the follow. No overflow. `starting the builder…` passed too fast to see; it is unit-tested. |
| 2026-09-30 | 📌 | T13: `docs/planning-runs.md` and `docs/detached-runs.md` still say two commands and quote the old `/plan or /start` texts. `BARE_HINT_SUFFIX` and `EMPTY_LIST_BOX` still read `to plan or build`; DESIGN §2.1 does not reword them. |
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
| 2026-09-30 | 📌 | DESIGN §2.6 puts a full stop straight after the reports folder path (`…/reports. Starting point`). Both real T12 sessions dropped into the right folder. |
| 2026-09-30 | 📌 | `docs/planning-runs.md` says `sessionAsking` is in `plan-run.mjs`; since T03 it is defined in `held-session.mjs` and re-exported from there. T13 should name the new file. |
| 2026-09-30 | 📌 | T03 did not run `./install.sh`: from a task worktree it would put unreviewed code into the engine the live run uses. The engine is installed once `pir/single-runs` is merged. |
| 2026-09-30 | 📌 | A malformed `setup` or `test` makes the whole settings file `bad-settings`, so a plan or build start refuses on it too. Follows from the shared `parseSettings`; pinned by a T01 review test. T13 documents it. |
| 2026-09-30 | 📌 | `commandsRefusalText` for `no-commands` is one line and names only the missing keys, first sentence included (`has no test commands`). Decided with the user in T01; the task doc gave only the both-missing text. |
| 2026-09-30 | 📌 | Pty end-to-end tests (`plan-rig-*`, `conversation-rig`) fail under sibling-worker load and pass alone: timing past load average 30; `plan-rig-box-start` once with `ENOTEMPTY` in rig cleanup at load 14. `the helpers scenario drives the real pir screen` fails most often. |
| 2026-09-30 | 📌 | Orphaned `coordinate.mjs helper` (pid 85261) and fake sessions from worktree `pir-reliable-notifications-T03` have run since 2026-09-28. Not this plan's; left alone. |
| 2026-09-29 | 📌 | Planned on `main` before base-branch landed; its settings files, `prepareBase` and hand-off text are cited by that plan's task-doc names. Read the merged code first. |
| 2026-09-29 | 📌 | `npm test` takes about 5 minutes on this machine, which is why the baseline test run happens only on the first red (DESIGN §2.5). |
| 2026-09-29 | 📌 | The harness already has a fixture named `single` (a one-task plan build). The live fixture here is `single-run-live`. |
