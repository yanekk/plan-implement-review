# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything
only a person can verify. Newest first. Forty words a row, counted. Flat prose.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 📌 | T11 review: on a scratch home with no `api.json`, bare `pir service` prints `registered but not answering` and the off-then-on hint, though nothing is registered and `on` is refused there. Documented in `docs/api-service.md`; wording left as it is. |
| 2026-09-30 | 📌 | T11: `docs/detached-runs.md` § The commands lists neither `pir service` nor `pir notify`, and says any other word is an unknown command. Outside T11's files, left as it is. |
| 2026-09-30 | 📌 | T11, worker-driven: the service started on a scratch home answered every row of the contract as `docs/api-service.md` states it. A `HEAD` gets the 405 and its headers with no body. Folder removed. |
| 2026-09-30 | 🐞 | T10 review: a harness killed from outside left its coordinator and sessions running, with no time limit. Reproduced with a real process tree, fixed, test locks it. Reviewer's live run, worker-driven, exited 0: 8 events, 5 distinct `observed_at`, folder removed. |
| 2026-09-30 | 📌 | T10, worker-driven: `node src/shell/harness/usage-live-check.mjs --into /tmp/usage-live` exited 0 in 90 s. 8 `rate_limit_event`s in 4 logs, all with `unifiedWindows`; 6 distinct `observed_at` over 18 polls; final API equal to the newest event. Folder removed, no worker left. |
| 2026-09-30 | 📌 | T10: the auto-mode classifier refused the live check wrapped in `cd … && … > file` (`Real-World Transactions`). The bare command, matching its `allow` rule in `.claude/settings.json`, ran. Run §5.3 commands exactly as written. |
| 2026-09-30 | 📌 | T08: a before-and-after mtime check of the real `~/.pir/usage.json` would fail during any live run once this is installed. The test refuses only the fake reading, known by five-hour `resets_at` 1790334600 (`USAGE_RESETS` in `plan-rig.mjs`). |
| 2026-09-30 | 🐞 | T09 review: a signal (Ctrl-C, a command timeout) ended the check before its teardown and left `com.pir.api-service.check` loaded. Reproduced on the real launchd, fixed, tests lock it. Reviewer's two full runs exited 0; `launchctl print` exited 113 after each. |
| 2026-09-30 | 📌 | T09, worker-driven: `node src/shell/harness/service-live-check.mjs` exited 0. On 0.2 s; `kill -9` after 11 s up, back in 0.1 s; killed again at once, back in 10.1 s; refresh 0.2 s; off 0.1 s. `launchctl print` of `com.pir.api-service.check` then exited 113. |
| 2026-09-30 | 📌 | T09: no `backgroundtaskmanagement` line in the system log during the check, so macOS showed no background-item notice. The plist sat outside the login-item folder, so this does not predict the real install. Inferred from the log, not the screen. |
| 2026-09-30 | 📌 | T05 review: the service imports shell `atomic-write.mjs` and `index-store.mjs`, as §3.4 prescribes, though DESIGN §2.6 says built-ins and `src/core/` only. What holds is no npm package, enforced by the graph test. T11 should document it that way. |
| 2026-09-30 | 📌 | T05: a comment in `index-store.mjs` holds the word `from` then a quoted phrase, so the boundary `SPECIFIER` pattern reports a bare import. T05's graph walk drops whole-line comments first; T06's walk reaches the same file through `indexDir`. |
| 2026-09-30 | 📌 | T04 review: worker sessions inherit `PIR_RUN=1` and the real `HOME`. A plain `node` script a worker runs with the fake claude emitting a `rate_limit_event` would write the real `~/.pir/usage.json`; only `node --test` or a scratch home stops it. T08, T10. |
| 2026-09-30 | 📌 | T04: `writeFileAtomic` leaves its `.tmp` behind when the rename fails. If `usage.json` is ever a folder, each reading adds one `.tmp` to `.pir`, silently. Not handled; nothing removes them. |
| 2026-09-30 | 📌 | T06 review: `serviceOn`, `serviceOff` and `serviceRefresh` reject when a write fails (an unwritable `~/Library/LaunchAgents`). `service-ctl.mjs` `main` prints one line and exits 1; T07's `pir service` calls them directly and needs its own catch. |
| 2026-09-30 | 📌 | T06: `installedEngine` compares strings. Node resolves symlinks in the running script's path, so with `~/.claude` a symlink `service-ctl.mjs` sees another `scriptPath` and `on` and `refresh` refuse with `run the installed pir`. Not handled. |
| 2026-09-30 | 📌 | T06: the `SPECIFIER` scan followed into `index-store.mjs` fails on a comment there (`from` before a quoted phrase). `service-ctl.test.mjs` strips comments before matching; T05's import-graph test needs the same. |
| 2026-09-30 | 📌 | `homeKind` compares strings. The real home spelled `/users/me`, `/Users/me/.` or through a symlink reads `scratch`, so the test-runner guard does not fire. T04, T05 and T06 should pass `env` and `os.userInfo().homedir` unaltered. |
| 2026-09-30 | 📌 | `npm test` fails on pty drill tests (`plan-rig-*`, `coordinator-drill`, helpers) when several workers run the suite at once: load 40 on 10 cores, a different set each run. Green at load 5. Rerun when quiet before suspecting the code. |
| 2026-09-30 | 📌 | T01: with several workers running `npm test` at once (load average 20 to 48) the pty rig tests time out, different ones each run: `conversation-rig`, `plan-rig-brief-box`, `plan-rig-planning-drill`. Green at load under 10. Re-run before suspecting the change. |
| 2026-09-30 | 📌 | T01: `boundary.test.mjs` matches its import pattern in comments too. The word `from` followed by a quoted phrase in a core file's comment fails as `bare import '…'`. Reword the comment; T02 and T03 write core files. |
| 2026-09-30 | 🐞 | T03: rig tests (`plan-rig-planning-drill.test.mjs`, header `finished, read only` not `live`; `the helpers scenario`) fail some full `npm test` runs under load 20 to 50 from parallel builds, a different one each time. Green alone. Not investigated. |
| 2026-09-30 | 📌 | Plan review, scratch agent: a job exiting 78 is restarted every 10 s. launchd also prints `last exit code = 78: EX_CONFIG` for a program path that does not exist, so the port-taken code became 47. |
| 2026-09-30 | 📌 | `writeFileAtomic` creates the target's folders recursively, so a reading written after a scratch home was deleted recreates that home. T04, T08 and T10 stop their sessions before removing one. |
| 2026-09-30 | 📌 | Not measured at planning: what Login Items shows for the agent, whether `ProcessType` `Background` changes anything, and telling "port held" from "not answering" on a real clash. T09 and the after-merge checklist are where they surface. |
| 2026-09-30 | 📌 | `node --test` sets `NODE_TEST_CONTEXT=child-v8` in each test process and children inherit it. `node file.test.mjs` run directly does not set it, so `homeKind` cannot catch that case. |
| 2026-09-30 | 📌 | `unifiedWindows` was on 389 of 389 `rate_limit_event`s in this repo's conversation logs, both windows every time. The events are 3 % of log lines (389 of 12 425). Login here: `claude.ai`, subscription `max`. |
| 2026-09-30 | 📌 | A launchd agent's environment has `HOME` set and `PATH=/usr/bin:/bin:/usr/sbin:/sbin`: Homebrew's `node` is not on it, so the plist needs the absolute path. Port 47717 was free; ephemeral ports start at 49152. |
| 2026-09-30 | 📌 | launchd, measured with a scratch agent: `kill -9` or `kickstart -k` restarts in 0.2 s after 10 s uptime, else 10 s. `bootout` sends SIGTERM. A second `bootstrap` returns 5; `bootout` of an absent label 3. |
