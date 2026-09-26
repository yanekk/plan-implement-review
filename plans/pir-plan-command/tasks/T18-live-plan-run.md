# T18 — live-plan-run

**Phase:** 3 · **Depends on:** T14, T16, T17 · **Weight:** heavy

## Goal

The feature, delivered for real: a real planner and a real reviewer, driven by `pir plan` in a scratch
repo, produce a reviewed plan on `pir/{slug}`, and the build started from the go ends green with the
`git merge` hand-off. It is the only proof that the skills, the reports and the planning program work
together with real Claude, and the only task that spends model time.

## Design sections this implements

DESIGN §1 success criteria, §5.1 first row.

## Files

- Whatever the run shows is broken, each fix with a test in the suite it belongs to.
- `FINDINGS.md`, `PROGRESS.md`.

## Environment (the worker owns this)

```
S=$(mktemp -d /tmp/pir-plan-command-live.XXXX)       # a trusted scratch path (see live-workers §5.2 note)
cp -R skills/pir-plan skills/pir-review-plan "$HOME/.claude/skills/"   # ask: the live sessions load the
                                                    # installed skill, which shadows the harness's copy
grep -l "Run by pir plan" "$HOME"/.claude/skills/pir-plan/SKILL.md "$HOME"/.claude/skills/pir-review-plan/SKILL.md
# the engine runs from this worktree (the harness), so nothing else is installed
# after: rm -rf "$S"; confirm no process from workers.json or the index entry is alive
```

## Automated checks (the worker runs these)

```
node src/shell/harness/run.mjs plan-command --into "$S"
```

Record: the plan slug, how many answerer replies it took, planner and reviewer durations, the build's
task count and duration, the assertion results, and the end state. A failure is diagnosed from the
captured bundle, fixed with a test, and the run repeated.

## Outside actions

- Planning skills live for T18 — `ask`
- Live plan-command run (T18) — `ask`

## Done when

- [ ] One run with every T17 assertion green, recorded in `FINDINGS.md` with its date and numbers.
- [ ] Every defect it found is fixed with a test, and `npm test` is green.
- [ ] Scratch removed and no process of the run left alive.
- [ ] The installed planning skills are the branch's (grep above); the way back is noted in `FINDINGS.md`.
