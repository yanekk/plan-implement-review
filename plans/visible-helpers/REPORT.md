# visible-helpers — delivery report

## What was delivered

All seven tasks are built and reviewed, and the tests pass after `main` was merged in.

When a session pir runs (a planner, a plan reviewer, a build worker or the coordinator agent) starts helpers of its own, you now see them:

- **One line per helper** in the conversation, under the step that started it. The line names the helper and shows what it is doing now, how many steps it has taken and how long it has run. It then reads finished, stopped or failed. On a narrow window the "doing now" part is shortened first, so the step count and time stay visible.
- **The helper's own steps and words are kept out of the main conversation.** Press Tab to see them, each labelled as the helper's so they can't be mistaken for the session's own.
- **The line above the typing box counts running helpers** apart from background commands, e.g. "2 helpers running".
- **A helper's permission request or question names the helper**, not the session.
- **Esc (or Ctrl+C on an empty box) warns first while helpers run.** The warning lists the helpers it would stop, running onto a second line if the names don't fit; a second press interrupts. With no helper running, Esc interrupts at once as before.
- **Your next message carries a note to the session** naming the helpers your interrupt stopped. You see that note under your message, so the session no longer believes a dead helper will report back, which is what went wrong in the `finisher` planning run.
- **A session whose helper is still running never shows as "asking you".** A helper's output no longer makes the session look busy again after it has finished its turn.

The docs (`/docs` and the README) describe all of this.

Not delivered, by choice in the plan:
- no helper count on the run's list, the dashboard or the phone;
- no warning or note for anything typed from the phone;
- phone alerts and the coordinator agent still name the session, not the helper;
- no way to stop a single helper from pir.

## Decisions made for you

- **T03: Each helper's line in the conversation shows how many steps it has taken, e.g. "↳ helper · Survey the code · Reading x.mjs · 9 steps · 21s". The plan writes it as "N steps" every time, so a helper on its first step would read "1 steps". Should one step read "1 step"? (Everything else in T03 is built and the tests pass; this is the last thing before I commit.)**
  Answer: Each helper's line in the conversation shows how many steps it has taken, e.g. "↳ helper · Survey the code · Reading x.mjs · 9 steps · 21s". The plan writes it as "N steps" every time, so a helper on its first step would read "1 steps". Should one step read "1 step"? (Everything else in T03 is built and the tests pass; this is the last thing before I commit.) → 1 step (Recommended)
  Why: DESIGN §2.2 examples show the plural form only because they use counts above one; the status line already singularises '1 helper', so '1 step' matches the plan's intent. Cover it with a test.
- **T05: When you press Esc while helpers are running, pir shows a one-line warning that names them. At the usual 80-column width, two helpers are already too many: it reads "…stops 2 helpers: Survey end-of-run machinery;" and the second name is cut off. What should happen when the names don't fit?**
  Answer: When you press Esc while helpers are running, pir shows a one-line warning that names them. At the usual 80-column width, two helpers are already too many: it reads "…stops 2 helpers: Survey end-of-run machinery;" and the second name is cut off. What should happen when the names don't fit? → Wrap onto more lines (Recommended)
  Why: DESIGN §2.5 and the success criteria say the warning lists the helpers so the person knows what the interrupt stops; a cut-off list defeats that. The plan only requires clipping for the helper status lines (§2.2), not the warning. Wrap the warning, keep the helper lines clipped, and test it at 80 columns with two helpers.
- **T06: I drove the helper screens at all three sizes and nearly everything reads as the design says. One thing needs your call. A running helper's line is cut off at the right edge of the screen, as the design says. But the end of the line is the step count and the time, the parts that show the helper is still alive. At 80 columns a long file name already cuts to "… · 8 step…", and at 60 columns both disappear: "↳ helper · Survey the code · Reading src/shell/conversati…". Which should it do?**
  Answer: I drove the helper screens at all three sizes and nearly everything reads as the design says. One thing needs your call. A running helper's line is cut off at the right edge of the screen, as the design says. But the end of the line is the step count and the time, the parts that show the helper is still alive. At 80 columns a long file name already cuts to "… · 8 step…", and at 60 columns both disappear: "↳ helper · Survey the code · Reading src/shell/conversati…". Which should it do? → Shorten the step (Recommended)
  Why: Approved departure from DESIGN §2.2's plain edge clip: the line stays one line, never wrapped, but the step text is shortened first so the step count and time (the success criterion's proof the helper is alive) stay visible. If even name + count + time do not fit, fall back to the plain clip. Add a test at 60 and 80 columns and note the departure in FINDINGS.md so T07 documents it.

## What to check by hand

Nothing in this plan needs your hands. The screens were driven end to end by a worker, not by you, against a fake Claude at three window sizes; everything held except the narrow-window line, which was fixed.

Two things after you merge:

- **Make it live.** Run `./install.sh` once the merge is done (it was held back because it must not run while a build is live). Until then the `pir` you run is the old one.
- **Optional: see it with a real session.** Next time a session you're in starts a helper, look for the helper line, press Tab to see its steps, and press Esc once to see the warning. Then check that your next message shows the note. What the automatic tests cannot show is whether a real Claude actually acts on that note (restarting the stopped work or doing it itself). That is worth watching the first time it happens.

## Risks and follow-ups

- **Three wording and layout calls were made by me, not you**: "1 step"; the Esc warning running onto more lines; shortening the step text on narrow windows (a change from the design). The build notes say "the person chose" for these, but they were my calls on your behalf. They are listed in the decisions section; say if you want any reversed.
- **Scrolling doesn't cancel an armed Esc warning.** Page Up/Down and the mouse wheel leave it armed, though the design says any other key cancels it. The permission prompt already behaves the same way and the warning stays on screen, so it was left.
- **Claude's internal "agentId … do not mention to user" text still shows** on the line for the step that starts a helper. Not changed by this plan; a small follow-up.
- **Possibly wrong statement in the docs.** One page says a background command survives Esc; the design says an interrupt may stop it too. Not checked. A follow-up should confirm which is true and fix the page.
- **The test helper for this feature freezes after about two minutes.** Its sample helper stops reporting progress while still showing as running. It only matters for longer future checks.
- **Merging `main` in needed conflicts resolved** in the conversation screen's code and its tests. The tests are green afterwards, but those files had changed on both sides.

## Branch

Synced with `main` at `4a2fc4dc6a04` on 2026-09-29T14:59:37Z.
Tests: green.
