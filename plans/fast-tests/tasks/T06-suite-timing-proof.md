# T06 — suite-timing-proof

**Phase:** 2 · **Depends on:** T01, T02, T03, T04, T05 · **Weight:** medium

## Goal

Prove the whole plan against its success criteria: `npm test` green and under 1:30, ten times in a row on
a quiet machine, with every test still present. Before measuring, harden what flakes when nine pty files
run at once, and settle the file concurrency. This is the plan's final deliverable.

## Design sections this implements

DESIGN §1 success criteria, §2.5, §2.6 (the missed-target path), §5 (measuring time).

## Files

- `src/shell/plan-rig*.test.mjs`, `src/shell/coordinator-drill*.test.mjs`,
  `src/shell/conversation-rig*.test.mjs` and their helper modules — only to replace a fixed `pause()` that
  waits for the screen with a wait on the screen condition, or to raise a limit with its measured reason.
- `package.json` — `--test-concurrency=N` in `scripts.test`, only if nine files at once is not reliable.
- `README.md` "Running the tests" — the command if it changed, and one or two sentences on why the pty
  suites are several files (they run side by side) and roughly how long a quiet run takes.

## Interface

None.

## Tests

- [ ] The whole suite's sorted test-name list equals the one on `main` before this plan (2,098 tests on
      2026-09-29, plus any tests T01 and T02 added, which are listed by name in the commit).
- [ ] `PARALLEL_POLL_MS=60000 node --test 'src/shell/coordinator-drill*.test.mjs'` green.
- [ ] Each `pause()` replaced is covered by the same test still passing.

## Done when

- [ ] Ten back-to-back `time npm test` runs on a quiet machine (DESIGN §5 check before and after each) are
      all green and each under 1:30. The ten times go in the commit and one line in FINDINGS.md.
- [ ] The test-name comparison above is empty, shown in the commit.
- [ ] README "Running the tests" is updated as above.

If after hardening a quiet run is still over 1:30, do not trim any wait: stop and put the choice to the
person (DESIGN §6), with the measured times and which files set the finish.

## Needs a person

Only if the machine is never quiet. The worker checks for foreign `node --test` processes itself and waits
for a quiet window. If none comes within about 30 minutes, it asks:

```
Other sessions keep running test suites on this machine, and the timing proof needs about
15 quiet minutes. Can you pause or finish the other builds for that long?
```

Expect: the person says when the machine is free.
Tell me: when to start the ten runs.
