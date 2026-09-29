# box-commands — delivery report

## What was delivered

All five tasks are built and reviewed, and the tests pass on the build's branch with the latest `main` merged in.

**What the box in the runs list does now:**

- It is a small command line with two commands: `@repo/plan <what to plan>` starts a planning run, and `@repo/start <plan>` starts the build of a reviewed plan, or opens its live view if it is already running.
- A pop-up guides every step. Type `@` and it lists your repos. Pick one and it offers `plan` and `start`. Pick `start` and it lists that repo's plans that can be built, each with how many tasks are done, and "building" beside any that is running now.
- Starting a build from the box lands you in that run's live view, just as typing `pir start` would.
- Anything not spelled exactly starts nothing, and the line under the box says what is wrong: a missing repo, a missing command, an empty brief, or a plan that is not reviewed or already finished.

**What changed for you:** the old spelling `@repo <brief>`, without `/plan`, no longer starts planning. The box now asks you to pick a command. `pir plan` and `pir start` typed in a terminal are unchanged.

**Not delivered, by design:** starting a build without the coordinator agent from the box (use `pir start --no-coordinator` in a terminal), commands other than plan and start, and listing unreviewed or finished plans.

## Decisions made for you

- **T01: One of the new "could not start the build" messages is too wide. The design's text is "Could not start {plan} in {repo}: its DESIGN.md has no setup/test block". With a longish repo name and plan name (18 letters each) that's 95 characters, but the task says every message must fit an 80-column screen, and the screen doesn't trim it, so it would spill onto a second line. You'd almost never see it: the list only offers plans that have that block, so it only shows up if the plan's design file changes between picking the plan and pressing Enter. Which wording should I use?**
  Answer: One of the new "could not start the build" messages is too wide. The design's text is "Could not start {plan} in {repo}: its DESIGN.md has no setup/test block". With a longish repo name and plan name (18 letters each) that's 95 characters, but the task says every message must fit an 80-column screen, and the screen doesn't trim it, so it would spill onto a second line. You'd almost never see it: the list only offers plans that have that block, so it only shows up if the plan's design file changes between picking the plan and pressing Enter. Which wording should I use? → "no setup/test block" (Recommended)
  Why: The 80-column rule (DESIGN §2.5, T01 done-when) is the stronger intent; the shorter wording keeps the meaning and the grep term 'setup/test block', on a rarely seen edge. Log the wording change in FINDINGS.
- **T05: When nobody has started a run yet, the runs list shows one line: "No runs yet — type after @ below to plan something new". The box can now start a build as well, and the hint line at the bottom already says "type @repo to plan or build". The design didn't settle this line. Should it change?**
  Answer: When nobody has started a run yet, the runs list shows one line: "No runs yet — type after @ below to plan something new". The box can now start a build as well, and the hint line at the bottom already says "type @repo to plan or build". The design didn't settle this line. Should it change? → Say plan or build (Recommended)
  Why: Design leaves the empty-list line open; the plan's intent (DESIGN §1, §2.5 bare hint 'type @repo to plan or build', head label renamed to 'new' because 'new plan' no longer fits a build) is that the box does both. One word, fits 80 columns, easily reverted. Log it in FINDINGS.

## What to check by hand

Nothing is waiting on you to confirm it works. A worker drove the whole box in a real terminal at two screen sizes: the quick path to a build, every error message, Esc on each pop-up, a repo with nothing to build, and a long plan name marked building. It all matched the design and the mock-up.

**One step is yours after merging:** the new box only reaches the `pir` you actually use once the installed copy is refreshed. After `git merge pir/box-commands`, with no run going, run `./install.sh` in this repo.

If you want to try it yourself afterwards: open `pir`, type `@` and the first letters of a repo, press Enter, press ↓ to reach `start`, press Enter, then press Enter on a plan. Its build should start and show its live view.

## Risks and follow-ups

- **Relies on a hidden part of the screen library.** Reopening the pop-up after a pick uses something the library does not officially offer. A test pins it, so upgrading that library would fail the tests loudly rather than quietly lose the pop-up.
- **Old habit.** Anyone used to typing `@repo brief` will now get "pick a command" instead of a planning run. That was your decision; it is only a one-time surprise.
- **Small quirk left in:** deleting letters inside a repo name while text follows it pops the repo list up mid-line. Picking from it keeps the rest of your text, so it was left as is.
- **Main moved during the build:** changes on `main` touched the same screen files. A worker resolved the overlaps and the tests pass after merging, but those are the files to look at first if anything on the runs list behaves oddly.

## Branch

Synced with `main` at `1b59d3953f0d` on 2026-09-29T05:04:41Z.
Tests: green.
