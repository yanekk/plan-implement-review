# finisher — delivery report

## What was delivered

All 11 tasks are built and reviewed, and the tests on the branch are green after `main` was merged in.

**What you get:** when a build run with the coordinator agent finishes green, pir now closes the coordinator agent and starts a **finisher** in its place. The finisher:

- reads your finishing rules. It uses the first of: the project's own rules, your rules for that project, or the default rules. The default is "merge the branch into `main` and confirm it landed".
- looks around without changing anything. Until you say go, pir itself blocks every command that is not on a short look-only list, even ones your Claude settings normally allow (such as `git merge`).
- writes out the exact steps it will take, alerts your phone "ready for your go", and asks one fixed question: **Go** or **Not yet**. You answer it in pir's screen or on your phone.
- after your Go, carries the steps out and ends the run as finished. It still has to ask you for anything destructive or anything in your ask list.
- if a step fails, stops, explains what is done and what is not, proposes a fix, alerts your phone and waits for a new Go.

**On screen:** the finisher gets the coordinator agent's pinned row, with its phase shown and `c` to open its chat. The bottom line names the phase and what `c` does. The runs list shows such a run as `ready for your go`.

**Fallbacks:**
- If the finisher cannot start or gives up after repeated crashes, the run falls back to today's "ready to merge" with the merge command.
- A red run, or a run started with `--no-coordinator`, ends exactly as before.

**This repository** now has its own rules: merge, run `./install.sh`, and check that the installed copy matches.

The docs and README describe all of this.

**Not delivered:** nothing planned was left out.

## Decisions made for you

- **T05: While the finisher waits for your go, main moves (say, another run merges). pir merges main back into the branch, as it does today. What should happen if the branch then fails its tests, or main can't be merged in? The plan says the finisher only ever sees a ready branch, but it doesn't cover a branch that goes bad under it.**
  Answer: While the finisher waits for your go, main moves (say, another run merges). pir merges main back into the branch, as it does today. What should happen if the branch then fails its tests, or main can't be merged in? The plan says the finisher only ever sees a ready branch, but it doesn't cover a branch that goes bad under it. → Close finisher (Recommended)
  Why: Design leaves it open. DESIGN §2.1 says the finisher only ever sees a ready branch and a red run ends exactly as today; closing the finisher and falling to today's red wait keeps both true with no new go-refusal logic. 'Ignore' breaks the success criteria. Record it in FINDINGS and the task's commit.
- **T05: The code is done, installed, and every automated test passes, including a new set that walks a pretend run through each ending: done, close, a merge by hand, give-up, failing to start, and a pir restart in each phase. The task also asks for one real run to confirm a live build reaches the finisher. That means real Claude sessions in a throwaway repo: 3 workers, the coordinator agent and the finisher, for about 15–20 minutes, with a 20-minute cut-off. It uses your plan's usage allowance, not paid API calls. The plan has no approved entry for this run, so it's your call.**
  Answer: The code is done, installed, and every automated test passes, including a new set that walks a pretend run through each ending: done, close, a merge by hand, give-up, failing to start, and a pir restart in each phase. The task also asks for one real run to confirm a live build reaches the finisher. That means real Claude sessions in a throwaway repo: 3 workers, the coordinator agent and the finisher, for about 15–20 minutes, with a 20-minute cut-off. It uses your plan's usage allowance, not paid API calls. The plan has no approved entry for this run, so it's your call. → Leave it for T10 (Recommended)
  Why: No DESIGN §5.3 row covers a real multi-session harness run in T05, so running it unapproved is not ours to do; T10 runs a real finisher on a scratch repo and will show the same hand-over. Mark the Done-when item unverified in PROGRESS and add a FINDINGS row pointing to T10.
- **T07: Once the finisher takes over, what should the bottom line of the build's live view say when it is NOT waiting for your go (while it prepares, is stuck, asks you for a yes, or is finishing)? The design only gives the waiting line: "◆ finisher ready · c to review and say go". Left as it is, the line would still say "ready to merge · git merge …", which is wrong because the finisher does the merge.**
  Answer: Once the finisher takes over, what should the bottom line of the build's live view say when it is NOT waiting for your go (while it prepares, is stuck, asks you for a yes, or is finishing)? The design only gives the waiting line: "◆ finisher ready · c to review and say go". Left as it is, the line would still say "ready to merge · git merge …", which is wrong because the finisher does the merge. → One line per phase (Recommended)
  Why: DESIGN §2.11 gives only the waiting footer; extending the same shape to every phase follows its intent (the row's phase names, every state reachable through c) and never shows a hand-merge command the finisher is about to run. Cheap to change later. Record it in FINDINGS.

## What to check by hand

Nothing is outstanding. The one check only you could do, the go answered on your phone, was done by you on 2026-09-30. On a throwaway repo:

- the ready alert opened the finisher's chat;
- you answered Go there;
- nothing was merged before your Go;
- the finisher merged and the finished alert arrived.

**After you merge this branch, run `./install.sh`.** Nothing here reaches the `pir` you actually use until you do.

If you want to see it once on a real project, the next green build run with the coordinator agent will hand over to the finisher by itself. Watch for the "ready for your go" alert.

## Risks and follow-ups

- **The phone link only works from your own terminal.** When a phone check was run from a worker's restricted session, Remote Control failed every time; phone alerts still sent. A normal pir run from your terminal is fine.
- **A small change to the plan, settled during the build:** if `main` moves while the finisher waits and the branch then fails its tests, the finisher is closed. The run waits as a failed run does today, and the finisher does not come back for that run. You would merge by hand once it passes.
- **Known quirks, left alone on purpose:**
  - if the finisher rewrites its plan while you are deciding, the 15-minute reminder can still quote the old number of steps;
  - a stuck finisher shows as `asking you` in the runs list rather than `ready for your go`;
  - its chat ends by calling it "the worker";
  - after certain fallbacks, a restart of pir brings the run back without a coordinator agent.
- **A finisher that is stuck cannot record revised steps formally.** They appear only in its message to you, so read the chat before a second Go.
- **A test that flakes under heavy load:** one end-to-end screen test sometimes times out when many workers run tests at once. It passes on re-run.
- **Folder name clash:** a repo named `default` or `runs` shares its rules folder with pir's own files. This is a known limit you accepted.

## Branch

Synced with `main` at `0e775d2eb007` on 2026-09-30T06:06:25Z.
The tests were red at the end; a worker fixed them.
Tests: green.
