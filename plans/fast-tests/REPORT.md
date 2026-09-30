# fast-tests — delivery report

## What was delivered

All six tasks are built and reviewed. Nothing planned was left out.

- **The test suite is about four times faster.** A full test run used to take about 4 minutes 40 seconds. On a quiet machine it now takes about 69 seconds. It ran 10 times back to back, and every run passed, taking between 68.7 and 70.4 seconds. The target was under 1 minute 30 seconds.
- **No test was dropped.** The speed comes from running the slowest test files side by side, and from removing waits the product should never have had. Each of the three slowest test files is now several smaller files. The list of test names is the same as before the plan. There is still one test command; nothing was added that skips tests.
- **A real run reacts faster.** The coordinator used to find out some things only when its 5-second timer came round:
  - a worker's question or permission request
  - a worker finishing its turn or exiting
  - a decision from the coordinator agent
  - each step at the end of a run

  Now it acts on these straight away. In a real build, a worker's question should reach your screen almost at once instead of up to 5 seconds late, and the steps at the end of a run no longer wait 5 seconds each. The 5-second timer is still there as a safety net in case an event is missed.
- **The README's testing section** now says the suite takes a little over a minute and explains how the slow tests are laid out.

## Decisions made for you

None.

## What to check by hand

Nothing in this plan needs checking by hand. The automated tests cover the faster reaction, including test runs where the safety-net timer was set to a full minute so that any missed event would have shown up as a stall.

Two things are worth doing after you merge:

- **Make the change live.** Your installed copy of `pir` does not yet have the faster reaction. After merging, and while no build is running, run `./install.sh` in the main checkout.
- **Optional:** on your next real parallel build, watch whether a worker's question appears on the `pir` screen almost as soon as the worker asks it. It used to take up to about 5 seconds.

## Risks and follow-ups

- **Timings depend on a quiet machine.** The 69-second figure was measured with no other test runs going. If another session runs its tests at the same time, both runs slow down noticeably.
- **One timing check in the plan was wrong.** The plan's way of confirming the machine was quiet counted its own check as a test run. T06 found this and measured correctly instead. The check's wording in the plan was not corrected, so a future plan copying it would be misled.
- **The test helper that stands in for the coordinator agent now waits 1.5 seconds before passing a question on.** This is test-only; the real product is unaffected. Some tests used to catch a brief on-screen state only because of the old 5-second delay, and this pause keeps that state visible long enough to check.
- **The progress file was not fully tidied.** Its status line still says nothing has been built. The note that installing waits for your merge was never written under "Blocked on the user". Neither affects how anything works.

## Branch

Synced with `main` at `4a2fc4dc6a04` on 2026-09-29T19:48:41Z.
Tests: green.
