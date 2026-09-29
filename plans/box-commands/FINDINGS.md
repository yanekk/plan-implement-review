# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.
Flat prose, at most one bold phrase a row.

**Whoever appends, compacts** once this file passes 60 rows or 15 KB. Never drop a ✅ row or its
date, or anything somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | Worker-driven drill (T05): every listed interaction at 80×24 and 120×40 under a pty: success path, each §2.4 note, each §2.5 head and hint, Esc per pop-up, a no-plan repo, an 18-character slug `· building`. All matched; kept in `plan-rig.test.mjs`. |
| 2026-09-29 | 🔄 | The empty runs list reads `No runs yet — type after @ below to plan or build`, not `…plan something new` (user, T05 drill): the box builds too, and the bare hint already says plan or build. |
| 2026-09-29 | 📌 | Backspace inside the name with text after it opens the repo pop-up mid-line: pi-tui's own `@` trigger, not the reopen rule. A pick keeps `/plan brief`, as §2.2 intends, so it stays. |
| 2026-09-28 | 🔄 | startRun's `no-test-block` note reads `Could not start {slug} in {name}: no setup/test block`, not DESIGN §2.4's `its DESIGN.md has no setup/test block`, which is 95 columns at 18-character names (user, T01). |
| 2026-09-28 | 📌 | pi-tui 0.87.1 Editor: a pick closes the pop-up and nothing reopens it; `/` is dropped from trigger characters. `tryTriggerAutocomplete()` (TS-private) reopens it; a synthetic Tab auto-applies a single suggestion unseen. See DESIGN §3.3. |
| 2026-09-28 | 📌 | A fresh worktree has no `node_modules`; `npm ci` then `npm test` green in about four minutes, `git status` clean. |
