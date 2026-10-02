# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first. Forty words a row,
counted. A ✅ row is the only record that something was seen working for real; never drop one.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-02 | 📌 | T07's pty rig does not drive the clash (`sync  resolving a clash`) or red-after-fix (`✗ not ready`) runs; they are covered at frame and reducer level only. T08's drill must drive both through the real screen. |
| 2026-10-02 | 🔄 | User decided a red wait's merge row reads `not ready · tests red` (or `· clash unresolved`) in red, the sync row's words; DESIGN §2.11's table named none. |
| 2026-10-02 | 📌 | For T06: singleNotifyViews skips the new `sync` step (`!ROLE[step.id]`), so a helper's asking alert is still to add; the single drill asserts only that no `ready to merge` alert is sent. |
| 2026-10-02 | 📌 | With `COLORTERM=truecolor` in the shell, five pir-tui colour tests fail under `npm test` despite its NO_COLOR; `env -u COLORTERM npm test` is green. Not caused by this plan. |
| 2026-10-02 | 🔄 | User decided T05 skips the `single-run-live` dry pass in harness/run-single.test.mjs, which waits for the old `ready` end (`skip: T10`). T10 must re-enable it. |
| 2026-10-02 | 🔄 | User decided the PROGRESS cell of a single run ended `closed` reads `build ✓ review ✓ sync ✓ merge ✗` (§2.11 named none); `singleProgress` in T03. |
| 2026-10-01 | 📌 | `npm test` in a fresh copy under load average ~23 took 12–13 min and failed twice, different timing-bound tests each time (`plan-run.test.mjs`, `plan-rig-single-row.test.mjs`, live-workers T05); the failing files pass alone. Rerun before believing red. |
| 2026-10-01 | 📌 | `~/.pir/notify.json` does not exist on this machine, so no phone alert is sent during T10 or any drill; the finisher's phone path was verified for builds 2026-09-30 (`plans/finisher` FINDINGS). |
| 2026-10-01 | 📌 | This shell's first `node` is nvm's v22.17.1, below `engines` `>=22.19`; `/opt/homebrew/bin/node` is v26.7.0. `npm test` ran under v22.17.1 at plan time. |
