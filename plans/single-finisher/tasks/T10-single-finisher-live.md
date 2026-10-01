# T10 — single-finisher-live

**Phase:** 4 · **Depends on:** T08, T09 · **Weight:** light

## Goal

Prove the new ending once with real sessions: a real single run in a scratch repo whose base moves
during the run, so the sync runs; a real builder, reviewer and finisher; the person gives the `Go`; the
finisher merges and the run ends `finished`. The only part no tool may do is the `Go` itself.

## Design sections this implements

DESIGN §2.2, §2.5, §2.7, §5.1.

## Files

- `src/shell/harness/fixtures/single-finisher-live.mjs` (new), registered in `src/shell/harness/fixtures.mjs`,
  built on `single-run-live` (extend its scratch-repo setup, do not copy it): a scratch repo with
  `.pir/settings.json` (`baseBranch`, `setup`, `test`), a `.pir/rules/on-finish.md` saying "merge into the
  target branch and write a file FINISHED in the main checkout", a prompt for a one-line change, and a
  commit on the base made after the build starts (not touching the same file).
- `src/shell/harness/run.mjs` `runSingleScenario`, extended for this fixture: it counts outcome `finished`
  (not only `ready`) as completed; its answerer (`typed: { '*': spec.reply }`) never answers the finisher,
  so nobody stands in for the person's `Go` (as `finisher-live` does: no answerer on the finisher); it makes
  the base commit once the build has started; and once the finisher waits for the go it prints the
  dashboard command below and the finisher's Remote Control link.
- its checks in `src/shell/harness/assertions.mjs`, and a dry pass with the fake in `run-single.test.mjs`
  or a new `run-single-finisher.test.mjs`, including that the answerer left the go question unanswered.

## Environment (the worker owns this)

```
./install.sh
perl -e 'alarm 1500; exec @ARGV' node src/shell/harness/run.mjs single-finisher-live --into /tmp/pir-single-finisher-live
rm -rf /tmp/pir-single-finisher-live    # teardown; confirm it is gone and this repo's main did not move
```

## Outside actions

- Refresh the installed engine and skills — `ask` (DESIGN §5.3)
- Real single run with a real finisher — `worker` (DESIGN §5.3)
- Scratch teardown — `worker` (DESIGN §5.3)

## Automated checks (the worker runs these)

```
# before the go: the scratch base holds the post-start commit but not pir/<name>; FINISHED absent;
#   pir/<name> has a `sync <base> into pir/<name>` merge commit; the finisher phase is awaiting-go
# after the go: git -C /tmp/pir-single-finisher-live merge-base --is-ancestor pir/<name> <base>;
#   FINISHED present; finisher ledger has a `go` line by person or phone; the run's outcome is finished
```

## Needs a person

The run lives in a scratch pir home, so the person's everyday `pir` does not list it, and there is no
phone alert on this machine (`~/.pir/notify.json` absent). Hand them, in another terminal:

```
PIR_HOME=/tmp/pir-single-finisher-live/.pir-home pir
```

then: open the single run's row, → on `merge`, read the steps, and answer the Go question with "Go"; or
open the Remote Control link the harness printed and answer there. Within the 25-minute seatbelt.

Expect: before your Go nothing is merged; after it the row reads `◌ finished`.
Tell me: did you answer Go, and where (pir or phone)?

## Done when

- [ ] The automated checks pass after the person's Go; FINDINGS has a dated ✅ row.
- [ ] Teardown done; this repo's `main` unchanged by the check.
