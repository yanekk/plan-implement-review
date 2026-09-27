# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Flat prose,
at most one bold phrase a row. Whoever appends, compacts (over 60 rows or 15 KB). Never drop a ✅ row or
its date, or anything somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | Plan review: the Editor is 3 lines bare (two borders), 7/9/14 at its cap on 12/24/40 rows; `buildListFrame` has 6 fixed lines besides the footer, so 80×12 fit one run row (DESIGN §2.7). |
| 2026-09-26 | 🔄 | The user first accepted a unique-prefix `@name` on Enter, then reversed it: exact names only (DESIGN §2.5). |
| 2026-09-26 | 📌 | pi-tui 0.87.1 `Editor` wraps long text itself and caps its height at 30% of terminal rows (min 5), scrolling inside; no box-height code needed. |
| 2026-09-26 | 📌 | The `@` pop-up is asynchronous: a Tab sent in the same write as the typed name arrives before suggestions and completes nothing. Pty tests must wait for the pop-up before Tab. |
| 2026-09-26 | ✅ | Prototype direction approved by the user (`prototype/plan-box-mock.mjs`). |
