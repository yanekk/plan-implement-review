# T07 — single-skill

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

The procedure the builder and reviewer sessions follow, as one skill `pir-single` with a builder
section and a reviewer section, installed with the other skills.

## Design sections this implements

DESIGN §2.6 (what the skill binds), §2.7 (the report format, drop command), §2.5 (waiting on pir's tests; past-limit behaviour).

## Files

- `skills/pir-single/SKILL.md` (new)
- `install.sh` (`SKILLS` gains `pir-single`)
- `src/core/single-skill.test.mjs` (new, in the style of `planning-skills.test.mjs`)

## Interface

The skill's sections: what a single run is; where you run (the run's worktree, the `pir/…` branch, the
CLAUDE.md worktree rule does not bind you); scope (only what the prompt asks, ask before widening,
recommend `/plan` if it is too big); the builder (understand, change, commit with a message
`single({name}): <what>`, choose a name and check it is free by the three checks with
`single-{hex4}` also refused, drop `built`); the reviewer (read the diff against the starting commit
and the prompt, fix what has one right answer, ask the person about the rest, commit
`single({name}) review: <what>`, drop `reviewed`); after reporting (wait for pir's word, change
nothing; on red fix and report again; past the limit stop and ask); dropping (only with the person's
agreement: too big, recommend `/plan`; or nothing to change, say what was found); never merge, rebase, push or touch the base; the drop command, in the form the planning
skills use, with `from: "builder"` or `"reviewer"` and the header `[pir:v1 kind=… single=…]`.

## Tests

- [ ] the skill file exists with frontmatter `name: pir-single` and a description saying it is never typed by a person
- [ ] the three report headers it shows parse with `parseSingleReport`
- [ ] it names the red limit as 3 (`RED_LIMIT`) and the reports-folder drop command writes temp-then-rename
- [ ] `install.sh` lists `pir-single` in `SKILLS`

## Done when

- [ ] the skill covers every rule DESIGN §2.6 lists
- [ ] its report examples parse with T02's parser
- [ ] `npm test` green
