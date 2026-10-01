# single-runs — delivery report

## What was delivered

**Small changes without a plan.** You can now type `@repo/single <what to change>` in pir's box. pir sets the change up on its own branch, runs the project's setup, and starts a builder session that makes and commits the change and picks a short name for it. pir then runs the tests itself. After that a fresh reviewer, who never saw the change being written, checks it and fixes what it finds, and the tests run again. When everything is green the row reads `ready to merge` and you get the usual merge line to run yourself. Once your merge lands, the row turns `merged`.

- **Where the commands come from.** A project names its setup and test commands in the same settings file that names its base branch, with your own per-machine file able to override either one. A project without them is refused before anything is created, and the message names the file and the line to add. This repo has its own entries.
- **When the tests fail**, pir sends the failure back to the session that caused it. The first time, it also checks whether the tests already failed before the change, and says so. After three failed rounds the session stops and asks you.
- **Other things that work as you'd expect:** the steps view (build, review, merge), questions shown as `asking you`, phone alerts when a session waits on you and when the change is ready to merge, and stop, resume and remove as for a planning run. A builder can call the change off with your agreement, for example when it is too big and should be a plan.
- **Docs.** The docs, the README and the project instructions describe the new command.

**Proven:** the whole flow with stand-in sessions on screen at three window sizes (worker-driven), and once with real Claude. That real run fixed a small bug in one commit in about 40 seconds; the reviewer found nothing to change and the run ended `ready`.

**Not delivered:**
- **The new code is not installed yet**, so the `pir` on this machine does not offer single runs until it is (see below).
- There is no `pir single` command to type in a terminal; the box is the only way in, as planned.

## Decisions made for you

- **T01: T01 (settings-commands) adds to the settings-file code from the base-branch plan, but that code isn't on this branch yet. The base-branch build is still going (5 of its 10 tasks unfinished) and hasn't been merged into main or into this plan's branch. This plan's design says its build waits for that merge. How should I proceed? If you say nothing, I'll keep waiting here and build nothing.**
  Answer: T01 (settings-commands) adds to the settings-file code from the base-branch plan, but that code isn't on this branch yet. The base-branch build is still going (5 of its 10 tasks unfinished) and hasn't been merged into main or into this plan's branch. This plan's design says its build waits for that merge. How should I proceed? If you say nothing, I'll keep waiting here and build nothing. → Stop, wait (Recommended)
  Why: DESIGN (top) and PLAN start condition, user 2026-09-29: the build starts only after pir/base-branch is merged into main and main into pir/single-runs. Build nothing on T01, do not merge pir/base-branch, do not write a standalone reader. Stopping or restarting the run is the person's, from the pir dashboard.
- **T01: Which wording should pir use when a project is missing its setup or test command for a single run?**
  Answer: Which wording should pir use when a project is missing its setup or test command for a single run? → One line, only what is missing (Recommended)
  Why: The T01 task doc says the no-commands text 'names only the missing keys' and its test says 'names both files and only the missing keys'; saying setup is missing when only test is would contradict that. One line matches base-branch's existing refusalText lines, which are each a single line, and the box shows its own short wording (DESIGN §2.1).
- **T04: When pir's tests pass but leave stray files in the working folder (so it never reads as clean), what should pir do instead of rerunning the tests for ever? / What should the builder be told on its last line when the setup step failed before it started?**
  Answer: When pir's tests pass but leave stray files in the working folder (so it never reads as clean), what should pir do instead of rerunning the tests for ever? → Tell the session (Recommended); What should the builder be told on its last line when the setup step failed before it started? → Name the actual lines (Recommended)
  Why: Q1: DESIGN §2.4 step 3 names no exit (FINDINGS 2026-09-30, 'needs a decision'). Telling the session matches how every other failed check is handled (§2.7: a message from pir naming what failed and what to do; pir never commits for a session) and keeps §2.12's rule that green is only taken on a clean tree at the tested head; accepting the pass breaks that rule and 'count it as red' tells the session its tests failed when they passed. The small change to singleflow.mjs (T02, reviewed) is approved as part of T04 and is reviewed with it; keep it to this one exit, with a unit test, and do not let the message loop without end: if the tree is still dirty with the same leftovers after the session reports again, the session asks the person. Q2: the run stores its commands in state.json at the start (§2.2), so naming the actual setup lines is always true for this run, while the settings files may have been edited since; the build note points at plans/{slug}/DESIGN.md, which a single run does not have (FINDINGS 2026-09-30).
- **T09: Two 'Could not start the change…' messages are wider than an 80-column window and get cut off. How should they be shown?**
  Answer: Two 'Could not start the change…' messages are wider than an 80-column window and get cut off. How should they be shown? → Wrap to a second line (Recommended)
  Why: DESIGN §2.1 gives these words verbatim and T09's done-when asserts every §2.1 text verbatim, so shortening them goes against the design; §1's success criterion needs the refusal to name the file, and the bad-settings line carries {why}, which is the part a cut-off line loses. Wrapping keeps the design's words at 80 columns with no test relaxed. Keep the wrap to the note line only (existing one-line notes must paint as before), and drill it at 80×24 and 120×40.
- **T13: The single-runs docs, README and CLAUDE.md are written, and all tests pass. The last step in the task is to install the new code so `pir` actually uses it. The catch: installing from here swaps the program every `pir` run on this machine uses, including the build running right now, for a branch that hasn't been merged into main yet. An earlier task in this plan held off for exactly this reason, and your finishing rules already install after the merge. What should I do?**
  Answer: The single-runs docs, README and CLAUDE.md are written, and all tests pass. The last step in the task is to install the new code so `pir` actually uses it. The catch: installing from here swaps the program every `pir` run on this machine uses, including the build running right now, for a branch that hasn't been merged into main yet. An earlier task in this plan held off for exactly this reason, and your finishing rules already install after the merge. What should I do? → Wait for the merge (Recommended)
  Why: Installing from a task branch would put unmerged, unreviewed code under the live build and every other pir run on this machine; T03 held off for the same reason (FINDINGS 2026-09-30) and the engine is installed once pir/single-runs is merged. Mark the install half of T13's done-when as waiting for the merge in PROGRESS.md, not done. I could not find a finishing-rules file in this repo that installs after the merge, so also name './install.sh after the merge, then grep -q single ~/.claude/pir-engine/src/core/planbox.mjs and check ~/.claude/skills/pir-single/SKILL.md exists' in the Notes cell so it is not lost.

## What to check by hand

- **Install after you merge.** Run `./install.sh` from the main checkout, then type `@` in pir's box. `single` should be listed third, as "change something small". Nothing in this repo installs it for you after the merge, as far as I could find.
- **Try one real small change in a project you care about.** First add `"setup"` and `"test"` lines to that project's `.pir/settings.json` (or to your own `~/.pir/{repo}/settings.json`). Then ask for something tiny, like a typo fix. Watch that the row goes building → testing → reviewing → `ready to merge`, run the merge line it gives you, and check that the row then turns `merged`.
- **Phone alerts were never sent for real.** The test runs had no phone set up. If you use phone alerts, one small change will show whether the "ready to merge" alert arrives.
- **Whether a real builder makes good changes** can only be judged in use. The one real run was a trivial bug fix.

## Risks and follow-ups

- **The tests have no time limit.** A test run that never ends leaves the row on `testing` with its clock running until you stop the run. This was decided and is in the docs.
- **Stray files after green tests.** When tests pass but leave uncommitted files behind, the session is asked to commit them or have them ignored, instead of pir rerunning the tests forever. That was decided for you during the build. The design document still describes the old behaviour, but the docs describe the new one.
- **A broken settings file now blocks more than single runs.** A badly written setup or test entry also stops planning and builds from starting in that project, because all three read the same file.
- **Small rough edges, left alone:**
  - The failed-tests message points to a log file at a location that stops existing once the change is renamed.
  - A resumed session is told to check "the plan files", which a small change doesn't have.
  - If pir is killed at exactly the moment a run finishes, the "ready to merge" phone alert is never sent.
  - If you delete the branch after merging and restart pir, the row goes back to `ready to merge`.
  - In a 60-column window some hint lines are cut mid-word. That happens for plans and builds too.
- **Possible doc leftovers.** Earlier in the build, two docs pages still quoted the old two-command box texts, and one still listed only plan and build runs. Those notes were left for the docs task, and nobody has re-checked them since it finished.
- **On-screen tests are timing-sensitive.** They sometimes fail when many workers run tests at once, and pass when run alone.
- **Not from this plan:** a leftover helper process and stand-in sessions from another plan (`reliable-notifications`) have been running since 28 September.

## Branch

Synced with `main` at `e0f187fdea6d` on 2026-10-01T07:03:03Z.
Tests: green.
