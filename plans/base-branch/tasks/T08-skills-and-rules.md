# T08 — skills-and-rules

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The instructions sessions follow and the rules this repo installs into projects stop saying `main` where
they mean the base branch, and say where the base is set. Without this, a planner in a dev repo checks its
slug against `main` and a classic session looks for a `main` checkout that does not exist.

## Design sections this implements

DESIGN §2.1, §2.6 (planner slug check), §2.10.

## Files

- `skills/pir-plan/SKILL.md` (Run by pir plan: branch cut from the run's base; slug check `git ls-tree -d "$(git config branch.$(git branch --show-current).pirBase)" plans/{slug}`)
- `skills/pir-review-plan/SKILL.md`, `skills/pir-worker/SKILL.md`, `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md`, `skills/pir-coordinator/SKILL.md`
- `CLAUDE.md` (§ Where sessions run, the parallel-mode paragraphs, `How we work together` table where it says main)
- `src/core/settings.mjs` (`PIR_AUTOMODE_RULE` text, comment)
- `src/core/planning-skills.test.mjs`, `src/core/coordinator-skill.test.mjs`, `src/core/settings.test.mjs`

## Tests

- [ ] planning-skills test asserts the pirBase slug-check line instead of `git ls-tree -d main`
- [ ] coordinator-skill test asserts "never merges into the base branch or pushes"
- [ ] settings test asserts the new rule text

## Done when

- [ ] `grep -nw main skills/*/SKILL.md CLAUDE.md` finds only "main checkout" in the primary-worktree sense
- [ ] CLAUDE.md says where the base branch is set and that pir refuses without it
- [ ] `npm test` green
