# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen working for
real.

**Newest first. Forty words a row, counted.** The long version is in the commit that carried the fix.
This is the index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-19 | 📌 | T04: dropping the `runs` field from parseProgress and the verify path broke tests in coordinate.mjs/test, fixtures.test, planner-templates.test — no task owned them. User decided to fold those green-keeping fixes into T04. |
| 2026-09-19 | 📌 | T03 review: on a complete run the hand-off prints twice — once in the painted display footer, once as the trailing `renderHandoff` line. Harmless; which to keep is a by-eye call for T09's render pass. |
| 2026-09-19 | 📌 | T03: `buildDisplay` returns `{ branch, summary, rows, footer }` — a top-level `branch` past the task's `{summary,rows,footer}` sketch. The renderer shows the run branch on every paint, but the footer carries a branch only in handoff/red states, so the summary line cannot source it there. |
| 2026-09-19 | 📌 | T03: `coordinator.defer()` is now caller-less — the answers feed that drove it went with the down-channel (§2.2). Kept (not on §2.2's removal list); the conflict/extend paths are handled by the person directly now (§2.8), so a later task may drop it. |
| 2026-09-19 | 📌 | T02: worker names are now `/`+slug but `coordinatorName` stays `·` and `parseAgentName` reads both. Forced: `run.mjs` matches the coordinator by exact `·` string and the harness still emits `·`. T05 removes `coordinatorName`, the `verify` role, and the dual-separator tolerance. |
| 2026-09-19 | 🐞 | T01 review: `r.promoted` is now undefined but two standalone drills still read it — `spawn-one-scratch.mjs:266` and `src/shell/harness/run.mjs`. Neither runs in the test suite; a live drill never reports done. Out of T01 scope; sweep in T05's harness rework. |
| 2026-09-19 | 📌 | T01: the run no longer merges to `main` — it stops at a green `pir/{slug}` and prints `git merge` for the person. `worktree.promote()` removed. The system's one irreversible act is gone, so a bad run leaves `main` untouched (DESIGN §2.4). |
| 2026-09-19 | 📌 | `claude agents --json` (v2.1.277) reports only `state` (working/done) and `status` (busy) — it cannot distinguish a worker waiting on the person from one mid-build. The worker's own `reports/` signal is what tells the program a task is parked (DESIGN §2.2). |
| 2026-09-19 | 📌 | The foreground CLI already exists: `coordinate.mjs` `main()` loops `runPass` in the foreground, seatbelted by `PARALLEL_LIVE=1`. The "agentic" half was only the message bridge (`createAgentBridge`, outbox/answers/surfaced + SendMessage). This plan is mostly deletion. |
| 2026-09-19 | 📌 | Ctrl-C teardown is already installed: `coordinate.mjs` catches SIGINT/SIGTERM and closes every worker before exit. Kill-and-rebuild (DESIGN §2.6) reuses it; no re-adopt-live-workers code is needed. |
| 2026-09-19 | 📌 | A live crash of an agentic coordinator is untestable (background sessions rotate their process pool each turn — `coordinator-restart-resume` T07). A plain foreground command has a stable pid, so this plan makes kill-and-resume checkable for the first time. |
| 2026-09-19 | 🔄 | Naming reverts to the `/` separator and gains a task-slug field: `{repo} / {plan} / {task} / {slug} / {role}` (DESIGN §2.9). The reason for `·` (SendMessage rejecting `/`) is gone with the down-channel. Launch-time acceptance of a `/` in `claude --bg -n` is confirmed in T09; names with `/` already appear in `claude agents` here. |
| 2026-09-19 | 📌 | Abandoned `coordinator-trust` debris (attestation, coordinator-name-guard, and the completion-signal work) swept into `git stash` "coordinator-trust debris (abandoned; pre non-agentic-coordinator plan)" for a clean, green base. Recoverable if wanted. |
