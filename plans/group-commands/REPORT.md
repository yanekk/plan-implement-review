# group-commands — delivery report

## What was delivered

All three tasks are built and reviewed, and the full test suite passes.

- **Steps fold into one line.** In any conversation in `pir` (build workers, end-of-run helpers, the coordinator agent, and the planner and plan reviewer of `pir plan`), a worker's run of tool steps between two messages now shows as one line that counts them by kind, e.g. `▸ Ran 2 shell commands, read 3 files`.
- **Running steps stay visible.** A step still in progress keeps its own line until it finishes, then joins the count.
- **Failures are flagged.** A group containing a failed step ends in red `· N failed`. A step someone said no to reads `· N refused` in grey instead of red. These tags are never cut off, however narrow the window.
- **Click to open.** Clicking a group line opens it to show each step; clicking again folds it. The line brightens under the pointer. Dragging to copy text still works. The line you clicked stays where it was, and if the opened steps would run off the bottom, the view scrolls just enough to show them.
- **Tab is unchanged.** It still shows full detail with every step and its output. Groups you opened are still open when you Tab back, and are forgotten when you leave the conversation.
- The docs and the README describe the new behaviour.

Not delivered, as planned: no key to open one group, no open-all or fold-all, and no memory of open groups between visits.

## Decisions made for you

None.

## What to check by hand

Nothing in this plan is waiting on your hands. A worker drove the real `pir` screen with real clicks at two window sizes and checked it against the approved mock-up.

After you merge, **refresh the installed `pir` by running `./install.sh`** from the main checkout, with no build running. Until then the `pir` you run still shows each step on its own line. To see it working: open any worker's conversation in `pir`, click a `▸` line to open it, click it again to fold it, and press Tab to check that full detail still shows every step.

## Risks and follow-ups

- **An interrupted permission reads as failed.** If you interrupt a worker while it is waiting for your yes or no, that step shows red `· 1 failed`, not `refused`. The plan only counts an explicit no as refused. Whether an interrupt should count as refused too is your call, as a small follow-up.
- **Older logs may show refusals as failed.** Conversations recorded before this change mostly can't tie a refusal to its step, so a no you gave back then will usually read as `failed`. New conversations are fine. The plan accepted this.
- **Install after merging.** The change does not reach the `pir` you run until `./install.sh` is re-run (see above).

## Branch

Synced with `main` at `d495ace75408` on 2026-09-29T06:55:51Z.
Tests: green.
