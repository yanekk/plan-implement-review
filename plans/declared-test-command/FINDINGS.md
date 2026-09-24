# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first. Forty words a
row, counted. The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user
changed.

| Date | | Finding |
|---|---|---|
| 2026-09-24 | 🐞 | A stalled run ends `finished` with `complete` false, so the `pir-tui.mjs` stale note still offers `Hand-off: git merge` on an unfinished branch. Reproduced in T05 review; left open, wording for that state is undecided. |
| 2026-09-24 | 📌 | A red finished run's header still reads `✓ pir/<slug> · n/n done`, styled green (`render.mjs` header rule: green when finished). Only the footer says red. Not in T05's scope. |
| 2026-09-24 | 🐞 | `pir-tui.mjs` prints `Hand-off: git merge …` on every finished frame, red ones included; remote-e2e showed it under the red line. Fixed in T05. |
| 2026-09-24 | 🐞 | Harness fixture DESIGN (`fixtures/common.mjs`) names `npm test` inline, so every harness run ends red with "no test command found"; `handedOffGreenBranch` never checks the gate. Fixed in T10. |
| 2026-09-24 | 🐞 | real-screen-time remote-e2e went red on `no test command found`: commands named inline. Its feature worktree also lacked `server/node_modules`; `make server-test` exited 127 until `npm ci`. Both suites then passed (537, 188). |
| 2026-09-24 | 📌 | Scan of 30 plans across ~/src: 6 have no fenced block `testCommandFrom` finds; my-ender's blocks list a `-v` variant, so the gate runs the suite twice. |
