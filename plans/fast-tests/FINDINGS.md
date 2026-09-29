# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | T06 quiet timing: ten `npm test` runs green, 69.0 70.4 69.5 68.9 69.3 69.1 68.9 68.7 68.9 68.9 s; before the plan 4:40. The quiet check `grep -c '[n]ode --test'` matches its own shell line; match `node` as argv[0]. |
| 2026-09-29 | 📌 | Drill checks that a row showed a passing state (`asking coordinator`) relied on the 5 s pass lag. With wake-on-activity the fake agent pauses `DRILL_PASS_DELAY_MS` (1.5 s) before passing a question set (`fake/sessions.mjs`). |
| 2026-09-29 | 📌 | `{ concurrency: true }` on a top-level `test()` only parallelises its subtests; top-level tests in a file stay serial. In-file concurrency needs a wrapping `describe`. Measured in /tmp during planning. |
| 2026-09-29 | 📌 | The `pir` screen's 500 ms refresh (`pir-tui.mjs` `refreshMs`) has no env or flag, so a pty test cannot shorten it; the rigs' 250 ms settle is a per-call option. |
| 2026-09-29 | 📌 | Traced at planning: coordinator drill 120×40 took 46 s with nine waits ending on the full 5 s backstop, about 3 s of it the fake agent's `DRILL_REPORT_DELAY_MS`. Other test runs on this machine skew timings; measure quiet. |
