# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything
only a person can verify — a ✅ row is the entire record that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. This is the
index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-18 | 🐞 | T07 live drill FAILED. `claude agents --json` `pid` is a daemon-supervised `bg-spare`; SIGKILLing it respawns, not crashes. The SIGKILL-the-pid crash model (DESIGN §2.5) can't crash a live coordinator on real `claude`; it survived, a 2nd ran concurrently. Design decision needed on how to simulate a crash. |
| 2026-09-17 | 📌 | T04's HALT refusal + transient-feed clear live in `main`'s LIVE path (after `fileControl`), so they fire only under `PARALLEL_LIVE=1`. A dry preview builds no control and does not refuse a HALTed plan; harmless — no workers, no feeds. T05 docs note this. |
| 2026-09-17 | 🐞 | reconcile left a conflicted ✅ branch at feature-⬜ with no live worker to park it, so decideDispatch re-implemented it the same pass, clobbering reviewed work (§2.6). Now marked ⛔ (skipped by dispatch and resume), branch kept for a person. User decision. |
| 2026-09-17 | 📌 | coordinate.mjs's SIGTERM handler runs teardownRun, which removes task worktrees and branches. So the restart crash must be SIGKILL, not SIGTERM/`claude stop`, or the state to reconcile is gone — and SIGKILL leaves worker sessions alive for reconciliation to reap (DESIGN §2.5). |
| 2026-09-17 | 📌 | The implementer marks `🔍` in the same commit as the code (pir-implement steps 6–7); the reviewer marks `✅` in its own commit. So a committed task-branch glyph is atomic with the work — the basis for reading it as ground truth on restart (DESIGN §2.2). |
| 2026-09-17 | 📌 | `buildAssignments` (loop.mjs) treats a tracked task whose session is not in the live list as dead and removes its branch. So reconciliation must merge `✅` branches directly and give a `🔍` review a real fresh session, never seed a sessionless tracked task (DESIGN §2.5). |
</content>
