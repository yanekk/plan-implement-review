# T12 — single-live

**Phase:** 4 · **Depends on:** T07, T11 · **Weight:** medium

## Goal

One real single run with real Claude sessions through a harness fixture, in a scratch repo: a small
seeded defect, a builder that fixes it, pir's tests, a reviewer, and `ready`. It is the only proof that
real sessions follow the `pir-single` skill and its report format.

## Design sections this implements

DESIGN §5.1 (first row), §5.2, §5.3 (the live-run row).

## Files

- `src/shell/harness/fixtures/single-run-live.mjs` (new), registered in `src/shell/harness/fixtures.mjs`
- `src/shell/harness/run.mjs` if it needs a path that starts a single run instead of a build
- `src/shell/harness/fixtures.test.mjs` (the fixture is well-formed; no live run in `npm test`)

## Interface

The fixture seeds a scratch repo with `.pir/settings.json` (`setup: []`, `test: ["node --test"]`), one
source file with an off-by-one and a test that catches it, and starts `startSingleRun('fix the failing
test in add.mjs')` with the answerer replying to any question with a canned "go ahead". It asserts: the
run finishes `ready`; the branch has a builder commit and the test passes on it; the index entry is
`kind: 'single'` under the builder's name; no session is left running.

## Environment (the worker owns this)

```
claude auth status        # must report loggedIn: true
perl -e 'alarm 1200; exec @ARGV' node src/shell/harness/run.mjs single-run-live --into /tmp/pir-single-live
rm -rf /tmp/pir-single-live    # teardown; confirm the folder is gone and `ps` shows no session from it
```

The harness copies the project's skills into the scratch project. If an installed
`~/.claude/skills/pir-single` shadows it, run `./install.sh` from this worktree first (§5.3) so both
are the same.

## Outside actions

- Real single run for the live check — `worker`
- Scratch teardown — `worker`
- Refresh the installed engine and skills — `worker`

## Automated checks (the worker runs these)

```
the fixture's assertions above, recorded pass/fail with the run's duration, in FINDINGS.md
```

## Done when

- [ ] one real run finished `ready` under the builder's name, recorded in FINDINGS.md with the date
- [ ] the scratch folder is gone and no session survived
- [ ] `npm test` green
