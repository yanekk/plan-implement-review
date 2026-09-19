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
| 2026-09-19 | 📌 | `claude agents --json` (v2.1.277) reports only `state` (working/done) and `status` (busy) — it cannot distinguish a worker waiting on the person from one mid-build. The worker's own `reports/` signal is what tells the program a task is parked (DESIGN §2.2). |
| 2026-09-19 | 📌 | The foreground CLI already exists: `coordinate.mjs` `main()` loops `runPass` in the foreground, seatbelted by `PARALLEL_LIVE=1`. The "agentic" half was only the message bridge (`createAgentBridge`, outbox/answers/surfaced + SendMessage). This plan is mostly deletion. |
| 2026-09-19 | 📌 | Ctrl-C teardown is already installed: `coordinate.mjs` catches SIGINT/SIGTERM and closes every worker before exit. Kill-and-rebuild (DESIGN §2.6) reuses it; no re-adopt-live-workers code is needed. |
| 2026-09-19 | 📌 | A live crash of an agentic coordinator is untestable (background sessions rotate their process pool each turn — `coordinator-restart-resume` T07). A plain foreground command has a stable pid, so this plan makes kill-and-resume checkable for the first time. |
| 2026-09-19 | 🔄 | Naming reverts to the `/` separator and gains a task-slug field: `{repo} / {plan} / {task} / {slug} / {role}` (DESIGN §2.9). The reason for `·` (SendMessage rejecting `/`) is gone with the down-channel. Launch-time acceptance of a `/` in `claude --bg -n` is confirmed in T09; names with `/` already appear in `claude agents` here. |
| 2026-09-19 | 📌 | Abandoned `coordinator-trust` debris (attestation, coordinator-name-guard, and the completion-signal work) swept into `git stash` "coordinator-trust debris (abandoned; pre non-agentic-coordinator plan)" for a clean, green base. Recoverable if wanted. |
