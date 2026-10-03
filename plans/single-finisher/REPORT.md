# single-finisher — delivery report

## What was delivered

All ten tasks are done and reviewed, and the tests are green.

**Single runs (`@repo/single`) now end the way a build does.** You no longer get a merge command to paste:

- **The latest main is brought in and tested first.** Once the review passes, pir pulls the latest main branch into the change and runs the tests again, so what gets merged is what was tested.
  - If main and the change clash, a helper session settles the clash.
  - If the tests fail, a fix session gets one try.
- **The finisher asks for your Go.** Once the tests pass, the same finisher you know from builds prepares the steps, changes nothing, and asks for your **Go**. Only after your Go does it merge and carry out the rest of your finishing rules. The run then reads `◌ finished`.
- **If main moves before your Go,** pir brings it in and tests again, and the finisher asks afresh. An earlier Go does not count.
- **You can still merge by hand at any time before your Go.** pir notices and ends the run as `◌ merged`.
- **If the tests still fail after the fix try,** the run reads `✗ not ready` and offers no merge. It keeps watching main and tries again when main moves.
- **If the finisher can't start, or gives up,** the run falls back to the old ending: `● ready to merge` with the command to paste.
- **On screen:** the run's steps now show a sync row between review and merge. The merge row is the finisher's: press → on it, or `c`, to answer it. The runs list gains `● syncing`, `● ready for your go`, `● finishing`, `✗ not ready` and `◌ closed`.
- **Phone alerts** cover the new steps the same way they do for builds.
- **The docs and the README** describe the new ending.

Builds behave exactly as before. Fixing a bug found along the way (below) also helped builds.

What was not delivered: nothing in the plan was left out. The project instructions file's own list of commands still describes single runs as handing you the merge command; it was outside this plan's files, so it was left for you.

## Decisions made for you

- **T03: A single run you closed through the finisher, without merging: what should its progress line in the runs list read? (A finished or hand-merged run reads `build ✓ review ✓ sync ✓ merge ✓`.)**
  Answer: A single run you closed through the finisher, without merging: what should its progress line in the runs list read? (A finished or hand-merged run reads `build ✓ review ✓ sync ✓ merge ✓`.) → merge ✗
  Why: DESIGN §2.11 lists progress cells only for finished/merged and red; closed is open. A closed run is final and unmerged, so ✓ would mislead and … would read as still running; ✗ states it plainly beside `◌ closed`. A display string, cheap to change later.
- **T05: Single runs now finish the new way: after review, pir brings the base branch in, hands over to the finisher, your Go merges it, and the run ends 'finished'. All 44 tests of the single-run program pass, along with everything else I ran. But 17 older end-to-end tests drive a single run through the real dashboard screen and wait for the old 'ready to merge' row. The run never reaches that row now, so they time out. The plan gives those test files to T07, the task that redraws the screen for the new ending. T05's checklist also says the whole test suite must be green, so the plan contradicts itself here. What should T05 do with those 17 tests?**
  Answer: Single runs now finish the new way: after review, pir brings the base branch in, hands over to the finisher, your Go merges it, and the run ends 'finished'. All 44 tests of the single-run program pass, along with everything else I ran. But 17 older end-to-end tests drive a single run through the real dashboard screen and wait for the old 'ready to merge' row. The run never reaches that row now, so they time out. The plan gives those test files to T07, the task that redraws the screen for the new ending. T05's checklist also says the whole test suite must be green, so the plan contradicts itself here. What should T05 do with those 17 tests? → Mark them skipped until T07, with these conditions: each skip carries a reason string naming T07 and the old 'ready to merge' row; add one FINDINGS row listing the skipped files/tests and saying T07 must re-enable every one (grep-able, e.g. 'skip: T07'); say it in the PROGRESS note. Only these 17 tests, nothing else skipped.
  Why: T07 owns those rig files (task doc Files) and rewrites them for the new rows, so patching now is work done twice. Leaving them red would make T06 and T09 (and any merge-time test run) see a red suite and chase it under a plan already warning about load flakes. Skipping with a named, logged hand-back to T07 keeps npm test meaningful.
- **T05: With the 17 skipped, the whole suite has exactly one failure left, and it is not one of the 17. It is the practice run (against the fake Claude) of the older live single-run check from the previous plan. It waits for a single run to end 'ready', so it now times out after 2.5 minutes. T10 is the task that extends that same check for the new ending, so the plan puts these files with T10. What should T05 do with this one test?**
  Answer: With the 17 skipped, the whole suite has exactly one failure left, and it is not one of the 17. It is the practice run (against the fake Claude) of the older live single-run check from the previous plan. It waits for a single run to end 'ready', so it now times out after 2.5 minutes. T10 is the task that extends that same check for the new ending, so the plan puts these files with T10. What should T05 do with this one test? → Skip it until T10
  Why: T10's Files own runSingleScenario and its dry pass (it extends it to count 'finished'), so adapting now is edited twice. Same treatment as the 17: reason string naming T10, in the same FINDINGS row and PROGRESS note, T10 re-enables it.
- **T07: When a single run's tests are still red after the fix attempt, what should the merge row in its steps view say? (The sync row above it already says 'not ready · tests red' in red.)**
  Answer: When a single run's tests are still red after the fix attempt, what should the merge row in its steps view say? (The sync row above it already says 'not ready · tests red' in red.) → 'not ready · tests red', red
  Why: DESIGN §2.6 says the merge row and the alert say `not ready` *with the reason*, so the bare 'not ready' falls short of it. Use the same reason the sync row shows (tests red, or clash unresolved for an unresolved merge) and the red style of §2.11's not-ready sync rows. No merge command shown, per T07's rig check.

## What to check by hand

**Already seen working by you (2026-10-03):** a real single run, with real sessions, in a throwaway copy of a project:

- main moved during the build and was brought in;
- you answered Go in pir;
- the finisher merged the change and wrote its FINISHED file;
- the run ended `◌ finished`.

**Still worth a look:**

- **The installed pir is now out of date.** Installs during the run came from single tasks' own copies, and none happened after the last tasks merged. After you merge, run `./install.sh` once and say yes, so your everyday pir has the whole change. Then try one small `@repo/single` in a real repo: it should end with the finisher asking for your Go.
- **The phone path for single runs has not been seen.** Phone alerts aren't set up on this machine. The finisher's phone link also can't work while this Claude account goes through Amazon's service rather than a direct Anthropic login. If you set either up later, check that a single run's "ready for your go" reaches the phone.

## Risks and follow-ups

- **Busy-machine test failures.** The full test suite still sometimes fails a few screen tests when the machine is busy. They pass when rerun on their own, and a rerun passed unchanged at the end of this build. Treat a red run under heavy load with suspicion before chasing it.
- **Resume after main was brought in.** If you stop a single run and resume it just after main was brought in, the finisher has to write fresh steps before a Go counts. The automated drill couldn't fully exercise this path, and the live run didn't hit it. It is the least-tested part of the new ending.
- **A stale question while main is brought in again.** During that, the finisher's old Go question stays on screen in amber as `asking you`, and answering it does nothing. Builds behave the same way. It may confuse a little; a follow-up could hide the question while this happens.
- **A small display gap.** After a helper session has fixed a clash or the tests, the sync row stops showing which helper ran, though → still opens that helper's conversation.
- **To fix:** the project instructions file's command table still says single runs hand you the merge command. One line to update.

## Branch

Synced with `main` at `4fb9924fe406` on 2026-10-03T07:14:11Z.
The tests were red at the end; a worker fixed them.
Tests: green.
