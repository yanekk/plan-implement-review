# bang-commands — delivery report

## What was delivered

All 11 tasks are built and reviewed, and the full test run is green.

**Running a command yourself.** In any conversation in `pir` that has a typing box (a build worker, the coordinator agent, the finisher, the planner, the plan reviewer, a single run's builder or reviewer), a line starting with `!` now runs as a command in that session's own folder, using your own shell with your aliases. The box turns pink while it starts with `!`, and the output streams into the conversation. When the command ends, the agent gets one message with the command, how it ended and its output (the last 30,000 characters if it is longer), and replies straight away.

- Esc, or Ctrl+C on an empty box, stops your command, not the agent. It now also stops a shell's later steps and its background jobs at once.
- Closing the `pir` screen does not stop a command. It keeps running and the agent still gets the result.
- If `pir` itself dies mid-command, the next start cleans up the leftover command and tells the session it was cut off.
- One command at a time per session. You can still type messages to the agent while one runs.

**An agent handing you a command.** Build workers, the planner and plan reviewer, and a single run's sessions can hand you a ready command with a reason. The row reads `asking you · run a command`, you get a phone alert pointing you back to `pir`, and the command is pinned above the box. Enter runs it, `e` lets you edit it first, `n` declines, or type a reply to decline with your words. The output goes straight back to the agent. The coordinator agent can never answer one of these for you.

**Docs.** The README and `/docs` describe both directions and their limits.

**Not delivered, as planned:** commands that need you to type into them (they sit until you press Esc), `!` from the phone or claude.ai, and the coordinator agent or finisher handing you commands.

**Not live yet:** none of this reaches the `pir` you run until the install that the finishing rules run after the merge.

## Decisions made for you

- **T01: Stop doesn't fully stop a command in your real shell (zsh). When stopped, `long-step; next-step` still runs next-step, and for the first ~2 s Stop does nothing. In bash, background jobs survive Stop. Should Stop also send the 'terminal closed' signal, so zsh and bash quit at once and take their background jobs with them (measured: under 15 ms in all three shells, 3-second force-kill kept as backstop)?**
  Answer: Stop doesn't fully stop a command in your real shell (zsh). When stopped, `long-step; next-step` still runs next-step, and for the first ~2 s Stop does nothing. In bash, background jobs survive Stop. Should Stop also send the 'terminal closed' signal, so zsh and bash quit at once and take their background jobs with them (measured: under 15 ms in all three shells, 3-second force-kill kept as backstop)? → Add terminal-closed (Recommended)
  Why: DESIGN §2.4's intent is that Esc stops the person's command; SIGTERM alone measurably fails that in zsh/bash. Adding SIGHUP alongside SIGTERM, keeping the 3 s SIGKILL backstop, serves the intent better and changes nothing the person sees. Update DESIGN §2.4 and T01's stop line in the same commit and keep a test for `a; b` and the bash background job.
- **T06: T06 (typing ! in the conversation) is built and every test passes. The design didn't give the wording for five things you'll see, so I picked these: (1) When the session closes while your command is still running: "✗ not sent: the session has ended", the same line as when the result couldn't be delivered. (2) When a command's output goes past 1 MB: "· the rest of the output was not kept (over 1 MB)". (3) When a second screen tries to run a command and pir refuses it: "your command was not run: a command is already running (ls)" or "…: the session has ended (ls)". (4) While a command runs, the key hint at the bottom changes "esc interrupt" to "esc stops it", because Esc now stops your command and not the agent. (5) After you press Esc to stop a command, a short "stop sent" line appears, just as "interrupt sent" does today. Keep these as they are?**
  Answer: T06 (typing ! in the conversation) is built and every test passes. The design didn't give the wording for five things you'll see, so I picked these: (1) When the session closes while your command is still running: "✗ not sent: the session has ended", the same line as when the result couldn't be delivered. (2) When a command's output goes past 1 MB: "· the rest of the output was not kept (over 1 MB)". (3) When a second screen tries to run a command and pir refuses it: "your command was not run: a command is already running (ls)" or "…: the session has ended (ls)". (4) While a command runs, the key hint at the bottom changes "esc interrupt" to "esc stops it", because Esc now stops your command and not the agent. (5) After you press Esc to stop a command, a short "stop sent" line appears, just as "interrupt sent" does today. Keep these as they are? → Keep them (Recommended)
  Why: DESIGN §7 leaves wording to the build; all five fit §2.4/§2.8 and the prototype (hint 'esc stops it' matches the approved status line), and T08's drill re-judges the real screen.
- **T07: When an agent hands you a command, it's pinned above the box. With the box empty, Enter runs it, `e` puts it in the box to edit, `n` declines, and typing a reply declines with your words. The catch: a reply that starts with n or e never gets typed. Typing "not now" declines on the first letter, without your words, and the rest ("ot now") goes to the agent as an ordinary message. A reply starting with e opens the edit instead. The task's examples were "no thanks" and "not now", so they can't work as written. The permission prompt already works this way with `n`. What should I do?**
  Answer: When an agent hands you a command, it's pinned above the box. With the box empty, Enter runs it, `e` puts it in the box to edit, `n` declines, and typing a reply declines with your words. The catch: a reply that starts with n or e never gets typed. Typing "not now" declines on the first letter, without your words, and the rest ("ot now") goes to the agent as an ordinary message. A reply starting with e opens the edit instead. The task's examples were "no thanks" and "not now", so they can't work as written. The permission prompt already works this way with `n`. What should I do? → Keep the keys (Recommended)
  Why: DESIGN §7 makes the hand pin mirror the permission prompt so one rule covers both; the approved mock shows these keys. Use a reply like 'later, please' in the tests, fix the task's examples, and log a FINDINGS row so T10 states the n/e limit in the docs.
- **T08: I ran the drill in every kind of session and at every size. All of it matched the design except one line you would see. When an agent hands you a command, the conversation also shows the agent's internal tool step just above the pinned prompt. While it waits, that line reads "⎿ mcp__pir__hand_command printf handed". Once you have answered, it reads "▸ Used mcp__pir__hand_command 1 time". The pinned prompt and the "! T01 asked you to run: …" line already say the same thing in plain words, and the approved mock doesn't show this line. What should happen to it?**
  Answer: I ran the drill in every kind of session and at every size. All of it matched the design except one line you would see. When an agent hands you a command, the conversation also shows the agent's internal tool step just above the pinned prompt. While it waits, that line reads "⎿ mcp__pir__hand_command printf handed". Once you have answered, it reads "▸ Used mcp__pir__hand_command 1 time". The pinned prompt and the "! T01 asked you to run: …" line already say the same thing in plain words, and the approved mock doesn't show this line. What should happen to it? → Hide it (Recommended)
  Why: DESIGN §2.8 already avoids drawing the same event twice (the bang block replaces the 'you ▸' line); the handed-command lines are its plain representation and the mock omits the tool step. Hide it in the grouped view only, keep it in Tab's full detail, with a test.

## What to check by hand

No task has a hands-on half left unchecked. A worker drove every screen itself, in each kind of session and at three window sizes, and judged it against the design and your mock.

After the merge and install, two quick checks are still worth a minute because they run in your real shell rather than the test setup:

1. In any live conversation in `pir`, type `! printf hi` and press Enter. Expect `hi` to appear under the command with a `✓ exit 0` line, and the agent to reply to it.
2. Type `! sleep 30; echo late` and press Esc after a few seconds. Expect `✗ stopped by you` within a moment, and `late` never to appear.

One thing you cannot check from inside `pir`: if you allow a handed command from your phone, `pir` does not run it. The agent is told to ask you in words whether you ran it. That is a stated limit in the docs, not a fault.

## Risks and follow-ups

- **One of the feature's own tests is unreliable.** The test that checks Esc also stops a bash command's background jobs failed about one run in three. The run ended green, but it may fail a future run for no real reason, and it guards exactly the stop behaviour that was improved during this build. It is worth a small follow-up to make it steady.
- **Other tests that fail under load.** Several existing tests time out when the whole suite runs at once and pass alone, including one new `!` test in planning runs. The ten phone-alert tests that were red on `main` before the build were seen failing during the build, once even when run alone, though the final run was green. Expect the odd spurious red until someone looks at these.
- **Replies starting with n or e.** When a handed command is pinned and the box is empty, a typed reply like "not now" declines on the first letter and sends the agent the rest of the word. You kept this to match the permission prompt. The docs say so.
- **Narrow windows.** At 60 columns the hint line under the box is cut off by one character, as the existing hint already is. Only 80 columns and wider are promised to fit.
- **A rare leftover after a crash.** If you stop a command that ignores the stop, and `pir` crashes in the few seconds before the forced kill, that one process may be left running. Very unlikely; left as designed.
- **Small loose ends.** One new package was added, as you approved at plan review. Two code comments still say the engine has two packages when it now has four; the docs are right. The "sent to" end line names the session as its header does (`plan`, `build`, `coordinator`) rather than the design's examples (`planner`, `agent`). And Node on this machine is a little older than the version the project asks for; everything ran on it.

## Branch

Synced with `main` at `3a607f6c45d7` on 2026-10-01T13:56:39Z.
Tests: green.
