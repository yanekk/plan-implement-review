# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything
only a person can verify. Newest first. Forty words a row, counted. Flat prose.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 📌 | `npm test` fails on pty drill tests (`plan-rig-*`, `coordinator-drill`, helpers) when several workers run the suite at once: load 40 on 10 cores, a different set each run. Green at load 5. Rerun when quiet before suspecting the code. |
| 2026-09-30 | 📌 | Plan review, scratch agent: a job exiting 78 is restarted every 10 s. launchd also prints `last exit code = 78: EX_CONFIG` for a program path that does not exist, so the port-taken code became 47. |
| 2026-09-30 | 📌 | `writeFileAtomic` creates the target's folders recursively, so a reading written after a scratch home was deleted recreates that home. T04, T08 and T10 stop their sessions before removing one. |
| 2026-09-30 | 📌 | Not measured at planning: what Login Items shows for the agent, whether `ProcessType` `Background` changes anything, and telling "port held" from "not answering" on a real clash. T09 and the after-merge checklist are where they surface. |
| 2026-09-30 | 📌 | `node --test` sets `NODE_TEST_CONTEXT=child-v8` in each test process and children inherit it. `node file.test.mjs` run directly does not set it, so `homeKind` cannot catch that case. |
| 2026-09-30 | 📌 | `unifiedWindows` was on 389 of 389 `rate_limit_event`s in this repo's conversation logs, both windows every time. The events are 3 % of log lines (389 of 12 425). Login here: `claude.ai`, subscription `max`. |
| 2026-09-30 | 📌 | A launchd agent's environment has `HOME` set and `PATH=/usr/bin:/bin:/usr/sbin:/sbin`: Homebrew's `node` is not on it, so the plist needs the absolute path. Port 47717 was free; ephemeral ports start at 49152. |
| 2026-09-30 | 📌 | launchd, measured with a scratch agent: `kill -9` or `kickstart -k` restarts in 0.2 s after 10 s uptime, else 10 s. `bootout` sends SIGTERM. A second `bootstrap` returns 5; `bootout` of an absent label 3. |
