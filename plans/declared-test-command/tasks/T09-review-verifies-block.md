# T09 — review-verifies-block

**Phase:** 3 · **Depends on:** T01 · **Weight:** medium

## Goal

`/pir-review-plan` proves the block works in a fresh copy of the repo, writes it when missing, and
offers the narrow pass that unblocks a plan already reviewed or started. `/pir-work` treats a plan
without the block as not reviewed.

## Design sections this implements

DESIGN §2.6, §2.7.

## Files

- `skills/pir-review-plan/SKILL.md` — Pass 3 fresh-copy verification; a missing block is written,
  measured, and told afterwards; refusal #2 ("Not once building has started") gains the narrow-pass
  exception; Stage 6 unchanged for the full review
- `skills/pir-work/SKILL.md` — the "Has the plan been reviewed?" gate adds the block check

## Interface

Pass 3's verification, written into the skill as the commands to run:

```
git worktree add --detach "$TMP/pir-verify-<slug>" HEAD
( cd "$TMP/pir-verify-<slug>" && <each setup line> && <each test line> )   # each line its own sh -c
git worktree remove --force "$TMP/pir-verify-<slug>"                     # always, pass or fail
```

The narrow pass, when the plan is reviewed or has any task not ⬜ and the block is missing or
malformed: measure, write, verify as above, show the block to the user and wait for their yes, commit
`plan-review(<slug>): setup/test block`. No other file changes; `Plan reviewed:` untouched. With a valid
block, refusal #2 stands as today.

The pir-work gate message: "plans/<slug>/DESIGN.md has no valid setup/test block, so the plan counts
as not reviewed. Run /pir-review-plan <slug>."

## Tests

None automated: both files are skill prose. The review checks the text against DESIGN §2.6 and §2.7,
and T12 exercises the narrow pass once.

## Done when

- [ ] pir-review-plan verifies in a fresh worktree, always removes it, and has the narrow pass.
- [ ] pir-work stops on a missing or malformed block with the message above.
