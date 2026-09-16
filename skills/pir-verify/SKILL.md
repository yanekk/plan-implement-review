---
name: pir-verify
description: The hands-on procedure a parallel-mode worker runs for a `you` task — a spike or a hand-verification drill whose result is a person's judgement, not code. The worker owns everything mechanical around the check — it brings the stack up and seeds it, runs whatever automated checks a machine can decide, and tears it down and confirms it is down — and the person judges only what a person can. The worker presents the task's judgement-only "Needs a person" block, records the machine result it observed and the person's judgement as two separate confirmations into FINDINGS.md on the task branch, never rounding an ambiguous reply up, tears the environment down, marks the task done, and reports to the coordinator. Produces no code and no review session.
user-invocable: false
---

# verify

You have been sent `pir-verify Txx` by your coordinator. Task Txx is a **`you` task** (DESIGN §2.6):
its completion is a person's judgement with no deliverable a worker could produce — a spike, or a
hand-verification drill against real agents, real branches or a real device. **You own everything
mechanical around the check; the person owns the judgement.** You bring the execution environment up
and seed it, run whatever automated checks a machine can decide against it, hand the person a running
thing to look at, and after they have judged it you tear the environment down and confirm it is down.
The user talks to you directly, which is what keeps the exploration in your context and out of the
coordinator's.

**The line between you and the person is judgement, not "any command."** Standing the environment up,
running an automated test, and tearing the environment down are all mechanical, so they are yours
(DESIGN §2.6) — an automated test has a machine-decidable answer, so you run it and record what you
saw, you do not push it onto the person. What is *not* yours: the judgement itself — looking at the
running thing and deciding whether it is right — and, above all, **spawning real paid agents against
real branches, or watching a real agent run.** An agent must not spawn real paid agents on its own,
and only a person can watch a real run (DESIGN §5.2). Never spawn a real agent. Bring the environment
up, run the automated checks, present the judgement, let the user judge.

**Guaranteed teardown is your seatbelt.** Bringing a live environment up is only safe because you tear
it down and confirm it down before you finish (DESIGN §2.6, §5.2). A `you` task is not done until the
environment is confirmed down. If you cannot confirm teardown, you do **not** mark the task done — you
escalate (below), and leaving the environment up for the person is the last resort, said out loud, never
the silent default.

## The procedure

1. **Read the task doc in full** — `plans/{slug}/tasks/T<NN>-*.md`. It carries up to three things a
   hands-on task needs, and you keep them separate:
   - an **"Environment (the worker owns this)"** section, if the check needs a stack stood up: the
     bring-up + seed command and the teardown command, with their seatbelts (`DESIGN.md § Environment`
     names this project's seatbelts). These are yours to run.
   - an **"Automated checks (the worker runs these)"** section, if there is any check a machine can
     decide — install a driver, run an end-to-end test. These are yours to run too, and yours to
     record the machine result of; they are never handed to the person.
   - a **"Needs a person"** block: what the person must *judge*, what to expect, and what only a person
     can answer. This is what you present — never the environment commands and never an automated test.

   If the task doc has no "Needs a person" block at all, message the coordinator (`kind: question`) that
   the `you` task does not say what to judge, and wait.

2. **Bring the environment up and seed it** — run the task's setup command(s) and confirm the stack is
   actually up before you hand off (the page loads, the service answers). Do this yourself; it is
   mechanical. If bring-up fails, do not present a broken thing for judgement — message the coordinator
   (`kind: decision`) with the failure and wait (step 8). If the task has no environment section, skip
   straight to step 3, or, if there are no automated checks either, to step 4.

3. **Run the automated checks yourself and record the machine result.** For each command in the task's
   "Automated checks" section — install the driver, run the end-to-end test against the stack you just
   brought up — run it and note the exact result you observed: pass or fail, and the output. This is a
   machine-decidable answer, so it is yours to establish, not the person's; you never hand an automated
   test to the person to run. Hold that machine result for the record (step 6). If a check fails, do
   not present the thing as working — that failure is the finding: record it faithfully and escalate
   (step 8), a failing check is not a done task. If the task has no automated-checks section, skip to
   step 4.

4. **Present the judgement to the user and wait.** One block, in plain English, exactly as `CLAUDE.md`
   frames a handover — the environment is already up and the automated checks already run, so this is
   only what a machine cannot answer: what they look at and decide.

   ```
   Needs you — I cannot see this from here:

     <what to look at / the judgement, with its seatbelt if it carries one>

   Expect: <what should happen>
   Tell me: <the one or two things only a person can answer>
   ```

   Then **stop and wait** for the user to judge it and report back. Do not make the judgement yourself.
   Do not proceed on a guess. Do the rest of this procedure only once the answer is in.

   **Never round an ambiguous reply up.** If what the user says does not clearly cover the judgement you
   asked — a terse "full pass" to a two-part question, an answer that could mean the smaller or the
   larger claim — you re-ask for the part that is missing and record only what they explicitly confirm.
   A genuine ambiguity is resolved by asking, never by choosing the bigger reading (`CLAUDE.md`). Never
   fold the person's reply together with the machine result you already have; they are two separate
   facts and stay separate (step 6).

5. **Tear the environment down and confirm it is down.** Once the user has reported, run the teardown
   command and confirm the environment is actually down (e.g. `docker compose ps` shows no running
   services). This clears your session — you go idle, the coordinator's idle-gate clears, and the task
   is not left holding a worker busy on the user's absence. If there was no environment section, there
   is nothing to tear down.

   **If you cannot confirm teardown**, do not mark the task done. Message the coordinator
   (`kind: decision`) with what is still running and that you could not bring it down, and wait; the
   environment is left for the person only as a last resort, said out loud.

6. **Record two separate confirmations in `FINDINGS.md` on your task branch**, newest first, with the
   date — a `✅ verified by hand with the user` row (DESIGN §2.6; `CLAUDE.md` legend). The row holds
   **two distinct facts, never merged**: the machine result you observed running the automated checks
   (step 3), and the person's judgement in the person's own terms (step 4). Write what the machine
   established and what the person established, so the row says who established each. Never inflate the
   person's reply toward the machine's, or the machine's toward the person's. **Forty words, counted.**
   This row is the entire record that the thing was ever seen working for real, so it is never dropped
   later, only shortened, and it keeps any term a later session would grep for — a flag, an error
   string, a path. If either half showed a failure, record it just as faithfully; a `you` task that
   showed a defect is a finding, not a done task — see step 8.

7. **Mark the task row `✅` in `PROGRESS.md` on your task branch**, and write in its Notes cell what
   the machine established and what the user judged, on what date (sixty words, flat prose). A `you`
   task has no automated half to be green in `npm test`: the recorded machine result and judgement
   *are* the evidence. Commit — `Txx: verified <what>` — on your task branch.

8. **Message the coordinator `done`** (`kind: done`) and stop. There is **no review session** — there
   is no code for a second session to review; the person's judgement is the result (DESIGN §2.6). The
   coordinator merges your task branch into the feature branch and reconciles the row.

   If the user could not complete the check, or either the automated check or the click-through
   revealed a problem, or you could not confirm teardown, do **not** mark the task `✅`. Message the
   coordinator (`kind: decision`) with what happened and wait; a `you` task the user defers is marked
   `⛔` and its dependents wait (DESIGN §2.6).

## What you do not do

- No code, no tests — a `you` task has no code deliverable.
- No review hand-off — you go straight from hands-on to done.
- No judgement made by you — the user judges the running thing; you record.
- No automated test pushed onto the person — a machine-decidable check is yours to run and record;
  the person is asked only what a machine cannot answer.
- No merged or inflated record — the machine result and the person's judgement are two separate
  confirmations, and an ambiguous reply is re-asked, never rounded up to the bigger claim.
- No real-agent spawn — DESIGN §5.2's hard line stands; standing up a stack and running a test are
  mechanical, spawning a paid agent against a real branch is not.
- No task marked done with the environment still up — teardown-confirmed-down comes first, or you escalate.
- No folding your worktree back to the feature branch — the coordinator owns the merge and teardown of it.

Your task branch and the base-rule carve-out are the same as any worker's: see the `pir-worker`
contract. You are in a worktree on `pir/{plan}-T{nn}` by design; do not stop on contact with it.
