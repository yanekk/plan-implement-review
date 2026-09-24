# Findings log

**What the build taught.** Read the rows touching the task you pick up. Newest first. Forty words a
row, counted. The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user
changed.

| Date | | Finding |
|---|---|---|
| 2026-09-24 | 📌 | `coordinator.defer` removes a task's worktree without killing a running `t.setup`. No production caller today, so left alone; a future caller should kill the setup first. |
| 2026-09-24 | 🐞 | A stalled run ends `finished` with `complete` false, so the `pir-tui.mjs` stale note still offers `Hand-off: git merge` on an unfinished branch. Reproduced in T05 review; left open, wording for that state is undecided. |
| 2026-09-24 | 📌 | A red finished run's header still reads `✓ pir/<slug> · n/n done`, styled green (`render.mjs` header rule: green when finished). Only the footer says red. Not in T05's scope. |
| 2026-09-24 | 📌 | Since T03, harness fixture plans lack a block, so every harness run is refused at start until T10 adds it. Not in `npm test`; harness runs are live only. |
| 2026-09-24 | 📌 | `launch.startRun` reads gates from `cwd`, not the main checkout (§2.2); `pir` run inside a worktree reads that worktree's DESIGN.md while the coordinator reads main's. Pre-existing for the review gate; left. |
| 2026-09-24 | 📌 | `startLines` spawns detached, so a setup line outlives its coordinator unless killed (reproduced: `sleep` outlived node exit 130). T07 kills handles on HALT and in `teardownRun` (stop, SIGINT, error); a SIGKILL or crash still orphans it. |
| 2026-09-24 | 📌 | `parseTestBlock` needs line 1 exactly `---`: a UTF-8 BOM or a closing `--- ` with trailing space gives `no front-matter block`. Spec-literal, kept; T03 may want to hint at it. |
| 2026-09-24 | 🐞 | `pir-tui.mjs` prints `Hand-off: git merge …` on every finished frame, red ones included; remote-e2e showed it under the red line. Fixed in T05. |
| 2026-09-24 | 🐞 | Harness fixture DESIGN (`fixtures/common.mjs`) names `npm test` inline, so every harness run ends red with "no test command found"; `handedOffGreenBranch` never checks the gate. Fixed in T10. |
| 2026-09-24 | 🐞 | real-screen-time remote-e2e went red on `no test command found`: commands named inline. Its feature worktree also lacked `server/node_modules`; `make server-test` exited 127 until `npm ci`. Both suites then passed (537, 188). |
| 2026-09-24 | 📌 | Scan of 30 plans across ~/src: 6 have no fenced block `testCommandFrom` finds; my-ender's blocks list a `-v` variant, so the gate runs the suite twice. |
