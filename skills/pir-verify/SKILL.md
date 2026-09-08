---
name: pir-verify
description: The hands-on procedure a parallel-mode worker runs for a `you` task — a spike or a hand-verification drill whose result is a person's observation, not code. The user runs the live/seatbelted commands; the worker presents the task's "Needs a person" block, records what the user reports into FINDINGS.md on the task branch, marks the task done, and reports to the coordinator. Produces no code and no review session.
user-invocable: false
---

# verify

You have been sent `pir-verify Txx` by your coordinator. Task Txx is a **`you` task** (DESIGN §2.6):
its completion is a person's actions with no deliverable a worker could produce — a spike, or a
hand-verification drill against real agents or real branches. **The user runs the live commands; you
do not.** You are the scribe. The user talks to you directly, which is what keeps the exploration in
your context and out of the coordinator's.

**You never run the live/seatbelted commands yourself, and you never spawn real agents.** An agent
must not spawn real paid agents against real branches on its own, and only a person can watch a real
run (DESIGN §5.2). Running the dangerous thing to save the user the trouble is exactly what the
seatbelt stands against. Present it; let the user run it.

## The procedure

1. **Read the task doc in full** — `plans/{slug}/tasks/T<NN>-*.md` — and find its "Needs a person"
   block: the exact command with its seatbelt (a time limit, a dry-run flag, a scratch account or
   repo — `DESIGN.md § Environment` names this project's seatbelts), what should happen, and what only
   a person can answer. If the task doc has no such block, message the coordinator (`kind: question`)
   that the `you` task does not say what to run, and wait.

2. **Present it to the user and wait.** One block, in plain English, exactly as `CLAUDE.md` frames a
   handover:

   ```
   Needs you — I cannot see this from here:

     <the exact command, with its seatbelt>

   Expect: <what should happen>
   Tell me: <the one or two things only a person can answer>
   ```

   Then **stop and wait** for the user to run it and report back. Do not run it. Do not proceed on a
   guess. Do the rest of this procedure only once the answer is in.

3. **Record what the user reports into `FINDINGS.md` on your task branch**, newest first, with the
   date — a `✅ verified by hand with the user` row (DESIGN §2.6; `CLAUDE.md` legend). **Forty words,
   counted.** This row is the entire record that the thing was ever seen working for real, so it is
   never dropped later, only shortened, and it keeps any term a later session would grep for — a
   flag, an error string, a path. If the user reports a failure, record that just as faithfully; a
   `you` task that showed a defect is a finding, not a done task — see step 5.

4. **Mark the task row `✅` in `PROGRESS.md` on your task branch**, and write in its Notes cell what
   the user verified and on what date (sixty words, flat prose). A `you` task has no automated half to
   be green: the recorded observation *is* the evidence. Commit — `Txx: verified <what>` — on your
   task branch.

5. **Message the coordinator `done`** (`kind: done`) and stop. There is **no review session** — there
   is no code for a second session to review; the person's observation is the result (DESIGN §2.6).
   The coordinator merges your task branch into the feature branch and reconciles the row.

   If the user could not complete the check, or it revealed a problem, do **not** mark the task `✅`.
   Message the coordinator (`kind: decision`) with what happened and wait; a `you` task the user
   defers is marked `⛔` and its dependents wait (DESIGN §2.6).

## What you do not do

- No code, no tests — a `you` task has no code deliverable.
- No review hand-off — you go straight from hands-on to done.
- No live command run by you — the user runs them; you record.
- No folding your worktree back to the feature branch — the coordinator owns the merge and teardown.

Your task branch and the base-rule carve-out are the same as any worker's: see the `pir-worker`
contract. You are in a worktree on `pir/{plan}-T{nn}` by design; do not stop on contact with it.
