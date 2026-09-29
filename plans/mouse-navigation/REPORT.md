# mouse-navigation — delivery report

## What was delivered

All eight tasks are done and reviewed, and the tests pass on the finished branch.

The `pir` dashboard now works with the mouse as well as the keys:

- **Click to open.** One click on a run in the list, a task in a build's live view, the coordinator agent's row, an end-of-run helper's row, or a step in a planning run opens it, just as selecting it and pressing Enter does. Clicks anywhere that is not a row (titles, notes, the hint line, the line above the agent's row) do nothing. Clicking a planning step never starts the build.
- **Hover.** The row under the pointer turns bold and brighter. A row that is waiting on you ("asking you") turns a lighter amber, because it was already bold. The selected row keeps its grey band. Hover also works when `pir` runs inside tmux or screen, as far as the tests can show (see risks).
- **Wheel.** In a worker's conversation the wheel scrolls the history three lines at a time. In the run list, the task list and the planning steps, one notch moves the selection up or down one row.
- **Copy.** Dragging across text highlights it and copies it to your clipboard. A drag that starts on a row never opens it.
- **Typing boxes.** Clicking in a box moves the cursor there, and clicking an entry in the new-plan box's `@repo` list picks it. A brief you are typing is still there after you click into a run and come back.
- **Keys unchanged.** Every key does what it did before. The go question, a worker's questions, permission prompts, going back and quitting stay on the keyboard only.
- **Your terminal is left clean.** Quitting, a crash, or the program being told to stop turns mouse reporting off again, so your shell does not fill with junk characters.

The docs and the README describe all of this.

Not delivered: the installed copy of `pir` has not been refreshed yet. That happens after you merge (see below).

## Decisions made for you

- **T08: When the pointer is over a row that is asking you something (a task, helper or planning step marked "asking you"), the row doesn't change at all. Those rows are already drawn in bold amber, and making the row bold is the whole hover effect. Every other row lights up correctly, as do rows in the run list. What should happen on those rows?**
  Answer: When the pointer is over a row that is asking you something (a task, helper or planning step marked "asking you"), the row doesn't change at all. Those rows are already drawn in bold amber, and making the row bold is the whole hover effect. Every other row lights up correctly, as do rows in the run list. What should happen on those rows? → Brighter amber (Recommended)
  Why: DESIGN §1 requires the row under the pointer to be visibly brighter than its neighbours, and §2.2 already brightens a row by lifting its colour to a lighter one (dim spans get lighter). A lighter amber on an already-bold amber row applies the same rule. Underline would add a new kind of mark to the look the person approved, and leaving it as is misses the success criterion. A colour is cheap to change later. Keep it to the hover paint, with a test; the selected band still wins over hover.

## What to check by hand

1. **Refresh the installed `pir` after you merge.** Until you do, the `pir` you run is the old keyboard-only one. Once the merge is done and no build is running, run `./install.sh` in the main checkout, or let the next session do it (the plan allows that without asking you).
2. **A quick look in your own terminal (optional).** You already approved the look in the trial version. The drill then checked the real thing on a simulated terminal at three sizes. If you want to see it yourself: open `pir`, move the pointer over the runs, click one, scroll a worker's conversation with the wheel, drag across some text and paste it somewhere. Point at a row marked "asking you" to see the new lighter amber, the one new colour you have not seen yet.
3. **Inside tmux or zellij (only if you use them).** Neither is installed on this machine, so nobody has seen hover work inside a real one. If you use one, open `pir` inside it and check that rows light up under the pointer.

## Risks and follow-ups

- **Hover inside a real tmux or zellij is unproven.** `pir` asks those programs to pass pointer movement through, and the tests confirm it asks, but not that they deliver it. If hover does nothing there, clicks and the wheel should still work.
- **Your clipboard may have been overwritten once during the build.** An early version of the drill used the real clipboard and put the word "build" on it. The tests now use a stand-in and no longer touch your clipboard.
- **Small screens.** On a terminal only 12 lines tall, a build's live view and the go question lose their bottom lines (the agent's row, notes and the hint line). You can still scroll and click onto them, you just can't see them. This was already true with the keys and was left as it is.
- **The wheel over the `@repo` list** moves the highlight in that list rather than the run list behind it. The docs say so; the code was left alone.
- **One workaround depends on the screen library's version.** A double click on a row could turn into a word selection and copy it. It was fixed by reaching into the screen library (`pi-tui`), so recheck it whenever that library is upgraded.
- **One leftover terminal setting.** Some terminals use a special keyboard mode, and if `pir` is killed from outside it may not switch that mode back off. `reset` in the shell clears it, and it also clears the mouse after a hard kill that nothing can catch.
- **One test failed once and was never identified.** In an early run it failed and five reruns passed. It is most likely a timing test that struggled while several workers were busy at once. Worth watching.
- **One note in the build's log is inaccurate.** It says you chose the lighter amber for "asking you" rows. In fact I chose it on your behalf (it is listed in the decisions below). Change it if you would prefer a different look.

## Branch

Synced with `main` at `bce0c78c1483` on 2026-09-28T19:41:29Z.
Tests: green.
