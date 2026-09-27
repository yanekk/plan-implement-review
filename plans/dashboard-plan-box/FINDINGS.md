# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Flat prose,
at most one bold phrase a row. Whoever appends, compacts (over 60 rows or 15 KB). Never drop a ✅ row or
its date, or anything somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | T06 drill, worker-driven at 80×12, 80×24, 120×40 under the plan rig: list scrolling and `↑/↓ n more`, the 30% box cap, every §2.5 note, `@plan-implement-review` with no flag, Ctrl+S Ctrl+S over a typed brief. All pass, kept as `plan-rig.test.mjs` cases. |
| 2026-09-27 | 🐞 | T06 drill: a key typed into the box did not disarm a half-pressed chord, so Ctrl+S, typing, then one Ctrl+S stopped a run. `runTui` now clears `armed` and `note` on box keys. |
| 2026-09-27 | 🔄 | T06 drill, user: an armed chord's `⚠` line replaces the typed hint while armed; startPlanRun refusal codes read as words (`it has no local main branch`). DESIGN §2.5, §2.6 amended. |
| 2026-09-27 | 🐞 | T06 drill: the ambiguous-repo note printed absolute paths, cutting the second off at 80 columns. It now writes home as `~`, as the pop-up does. |
| 2026-09-27 | 📌 | T06 drill: the box note staying until `esc` or a start (T05 review row) matches the prototype and the head line corrects itself as the person edits; left as is. |
| 2026-09-27 | 📌 | Pty tests: Enter sent a few milliseconds after text can reach a closing `@` pop-up and be taken as a pick. Settle the screen between typed parts (`typeSettled` in `plan-rig.test.mjs`). |
| 2026-09-27 | 📌 | Plan-rig tests leave `pir-plan-rig-*/repo` folders in the temp dir after cleanup, apparently from a stopped run's processes writing after `rmSync`. Not investigated; outside T06. |
| 2026-09-27 | 📌 | T05 review: a box refusal note stays until `esc` or a start, also after leaving the list and coming back, as in the prototype. The T06 drill may judge whether it should clear sooner. |
| 2026-09-27 | 📌 | T01: `CROSS-REPO-COORDINATION-GAP.md` at the repo root still describes `PARALLEL_ALLOW_HERE=1` as live; outside T01's file list, left alone. The auto-mode classifier blocks removing the guard until the user confirms in session. |
| 2026-09-27 | 📌 | Plan review: the Editor is 3 lines bare (two borders), 7/9/14 at its cap on 12/24/40 rows; `buildListFrame` has 6 fixed lines besides the footer, so 80×12 fit one run row (DESIGN §2.7). |
| 2026-09-26 | 🔄 | The user first accepted a unique-prefix `@name` on Enter, then reversed it: exact names only (DESIGN §2.5). |
| 2026-09-26 | 📌 | pi-tui 0.87.1 `Editor` wraps long text itself and caps its height at 30% of terminal rows (min 5), scrolling inside; no box-height code needed. |
| 2026-09-26 | 📌 | The `@` pop-up is asynchronous: a Tab sent in the same write as the typed name arrives before suggestions and completes nothing. Pty tests must wait for the pop-up before Tab. |
| 2026-09-26 | ✅ | Prototype direction approved by the user (`prototype/plan-box-mock.mjs`). |
