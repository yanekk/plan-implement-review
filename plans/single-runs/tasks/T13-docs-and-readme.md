# T13 — docs-and-readme

**Phase:** 4 · **Depends on:** T12 · **Weight:** light

## Goal

Carry the behaviour into the canonical docs and the README: a new `docs/single-runs.md`, the index in
`docs/README.md`, the dashboard box section in `docs/planning-runs.md` (a third command), the control
folder page, the README's user-facing section, and the command table in `CLAUDE.md`. Then install.

## Design sections this implements

All of DESIGN §2, as the code now does it; CLAUDE.md § The README follows every major feature.

## Files

- `docs/single-runs.md` (new): starting one, the settings keys, the steps, red rounds and the baseline, the reports, the screen, alerts, stop/resume/remove, known limitations
- `docs/README.md`, `docs/planning-runs.md` (§ The dashboard box: `/single`, its texts), `docs/control-folder.md` (`.parallel/single/`), `docs/detached-runs.md` (TYPE `single`, its states)
- `README.md`: a short section "Small changes without a plan — `@repo/single`", what it does for the user, the settings lines to add, a link to `docs/single-runs.md`; the workflow table gains the row
- `CLAUDE.md`: the command table gains `@repo/single {prompt}` in `pir`

## Outside actions

- Refresh the installed engine and skills — `worker`

## Tests

- [ ] every text the docs quote (notes, head lines, states, alerts) matches the code's constants
- [ ] `docs/README.md` links `single-runs.md`; README links it

## Done when

- [ ] the docs describe what the code does today, including its limits (no shell command, no base sync)
- [ ] `./install.sh` run and `grep -q single ~/.claude/pir-engine/src/core/planbox.mjs` succeeds, `~/.claude/skills/pir-single/SKILL.md` exists
- [ ] `npm test` green
