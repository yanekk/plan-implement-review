# T10 — docs-readme

**Phase:** 3 · **Depends on:** T08, T09 · **Weight:** medium

## Goal

Make `/docs` and `README.md` say what the build does, as built and seen in the drill, and make it live
with `./install.sh`. `/docs` is canonical for how parallel mode behaves, and a feature missing from the
README does not exist for a new reader.

## Design sections this implements

DESIGN §2, §8 (the limits), CLAUDE.md "The README follows every major feature".

## Files

- `docs/human-flow.md` — a section "Running a command yourself — `!`" and "A command an agent hands
  you", including the Remote Control limit and that the coordinator agent never answers one.
- `docs/detached-runs.md` — the conversation view paragraph and the key-binding table (`!`, Esc/Ctrl+C
  while a command runs, ↵/e/n on a handed command).
- `docs/control-folder.md` — `shells/` in each control folder (build, planning, single).
- `docs/coordinator-agent.md` — the hand request is reserved for the person.
- `docs/planning-runs.md`, `docs/single-runs.md` — one line each: `!` and handing work there too.
- `docs/README.md` if it indexes these pages; `README.md` — a short user-facing paragraph and link.
- `src/shell/single-docs.test.mjs` or other doc tests, if they pin edited text.

## Outside actions

- `./install.sh` — `worker`

## Tests

- [ ] doc tests that pin wording still pass, updated where the wording changed on purpose.

## Done when

- [ ] Every behaviour of DESIGN §2 and every limit of §8 is in `/docs`, and the README has a sentence and a link.
- [ ] `./install.sh` ran and `grep -n hand_command ~/.claude/pir-engine/src/shell/worker-proc.mjs` finds the tool.
