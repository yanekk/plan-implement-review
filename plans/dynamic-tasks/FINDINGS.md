# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. This is
the index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-22 | ✅ | T05 live drill run (`node src/shell/harness/run.mjs dynamic-task`): worker proposed the farewell task and waited, person approved, then added T02 (add-only, deps T01); coordinator adopted→dispatched→merged. Both facts PASS, main untouched. Confirmed in the run bundle. |
| 2026-09-21 | 🐞 | `bad-plan-change` surface sets `task` to the rejected new task (e.g. T03), so renderSurface prints "The worker on T03" though T03 has no worker — the introducer does. Full reason still shown. coordinate.mjs, out of T02 scope, not fixed. |
| 2026-09-21 | 📌 | Fake worker gained `addRows` (fake/platform.mjs): an implementer also commits given PROGRESS.md rows onto its branch at 🔍, so a loop test drives a worker-introduced task, valid or malformed. Loop records `adopt`/`bad-plan-change` from mergeTask. |
| 2026-09-21 | 📌 | adoptNewTaskRows trusts a branch's own new rows are unique and acyclic: a duplicate new number, or a new task with a self/cyclic dep, is adopted as-is (doubled row or undispatchable task). Needs a malformed branch; human-gated; not fixed. |
| 2026-09-21 | 📌 | Dispatch needs no change: `decideDispatch` is already pure over the parsed table and the loop re-parses `PROGRESS.md` every pass. The whole feature is adoption at merge; a larger table dispatches for free. |
| 2026-09-21 | 📌 | `mergeTask` protects `PROGRESS.md` by restoring the feature's copy verbatim (worktree.mjs, fake mirror). Adoption replaces that verbatim restore, so both live and restart merge paths get it — both call `mergeTask`. |
