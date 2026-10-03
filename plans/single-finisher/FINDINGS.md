# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first. Forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-03 | ✅ | Verified by hand with the user: live single-finisher-live run, main moved mid-build and synced in, the person answered Go in pir (this checkout's `pir.mjs`), the finisher merged, wrote FINISHED, the row ended `◌ finished`. All seven facts PASS. |
| 2026-10-03 | 📌 | Remote Control is refused while `CLAUDE_CODE_USE_BEDROCK` is set (`remote-control-failed` note), so no finisher link is printed and the phone path cannot be checked on this machine. |
| 2026-10-03 | 📌 | single-run-live's facts (`single-ready`, `base-untouched`) can no longer pass live: single runs end on the finisher's go. Its dry pass is replaced by single-finisher-live's in run-single.test.mjs; the fixture is left as the base it extends. |
| 2026-10-03 | 🐞 | A resumed finisher appended to its log with no `resumed` note, so the conversation view opened it read only and its go was unanswerable after Ctrl+R. Fixed in `finisher-agent.mjs` `launch()`; builds shared it. Test in `finisher-agent.test.mjs`. |
| 2026-10-03 | 🔄 | User decided a clockless step row too wide for the frame ends at a word with `…` (the fallback merge row at 60 columns read `git merge pir/r`). `fitWords` in `pir-tui.mjs`; the Hand-off note keeps the whole command. |
| 2026-10-03 | 📌 | While a re-sync runs before the go, the finisher's old go question stays open, so the merge row reads `◆ finisher  asking you` in amber; the person's answer to it does not count. Same in builds. |
| 2026-10-03 | 📌 | A resume after a `merged` sync calls `resynced` (§2.10), so a resumed finisher must write a fresh `ready` before a go counts. The fake cannot; the drill's stop/resume runs on an up-to-date sync. T10 should watch it live. |
| 2026-10-03 | 📌 | Once the sync settles, its row's role reads `—` even after a resolve or fix helper ran; → still opens that helper's conversation. |
| 2026-10-02 | 📌 | CLAUDE.md's command table row for `@repo/single` still says pir "hands over the merge command"; single runs now end with the finisher and `Go`. Outside T09's files; left for the person. |
| 2026-10-02 | 📌 | T07's pty rig does not drive the clash (`sync  resolving a clash`) or red-after-fix (`✗ not ready`) runs; they are covered at frame and reducer level only. T08's drill must drive both through the real screen. |
| 2026-10-02 | 🔄 | User decided a red wait's merge row reads `not ready · tests red` (or `· clash unresolved`) in red, the sync row's words; DESIGN §2.11's table named none. |
| 2026-10-02 | 📌 | For T06: singleNotifyViews skips the new `sync` step (`!ROLE[step.id]`), so a helper's asking alert is still to add; the single drill asserts only that no `ready to merge` alert is sent. |
| 2026-10-02 | 📌 | With `COLORTERM=truecolor` in the shell, five pir-tui colour tests fail under `npm test` despite its NO_COLOR; `env -u COLORTERM npm test` is green. Not caused by this plan. |
| 2026-10-02 | 🔄 | User decided T05 skips the `single-run-live` dry pass in harness/run-single.test.mjs, which waits for the old `ready` end (`skip: T10`). T10 must re-enable it. |
| 2026-10-02 | 🔄 | User decided the PROGRESS cell of a single run ended `closed` reads `build ✓ review ✓ sync ✓ merge ✗` (§2.11 named none); `singleProgress` in T03. |
| 2026-10-01 | 📌 | `npm test` in a fresh copy under load average ~23 took 12–13 min and failed twice, different timing-bound tests each time (`plan-run.test.mjs`, `plan-rig-single-row.test.mjs`, live-workers T05); the failing files pass alone. Rerun before believing red. |
| 2026-10-01 | 📌 | `~/.pir/notify.json` does not exist on this machine, so no phone alert is sent during T10 or any drill; the finisher's phone path was verified for builds 2026-09-30 (`plans/finisher` FINDINGS). |
| 2026-10-01 | 📌 | This shell's first `node` is nvm's v22.17.1, below `engines` `>=22.19`; `/opt/homebrew/bin/node` is v26.7.0. `npm test` ran under v22.17.1 at plan time. |
