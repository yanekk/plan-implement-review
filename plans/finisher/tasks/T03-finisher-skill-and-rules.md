# T03 — finisher-skill-and-rules

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The finisher's base definition as an installed skill, the default rules file that `install.sh` puts
in `~/.pir/default/rules/`, and this repository's own finishing rules. The skill is how the session
knows to look first, write the steps, ask the fixed go question, act, and report stuck or done.

## Design sections this implements

DESIGN §2.2, §2.4–§2.7, §2.12.

## Files

- `skills/pir-finisher/SKILL.md` (new): not user-invocable; engaged by the opening instruction.
- `rules/default/on-finish.md` (new): merge `pir/{slug}` into `main` in the main checkout; confirm
  `git merge-base --is-ancestor pir/{slug} main`.
- `.pir/rules/on-finish.md` (new): merge `pir/{slug}` into `main`; run `./install.sh`; confirm the
  installed copy under `~/.claude/pir-engine/src` and `~/.claude/skills/pir-*` matches the repo
  (`diff -rq` on the engine's `src/` and each skill).
- `install.sh`: add `pir-finisher` to `SKILLS`; install `rules/` into the engine copy; seed
  `~/.pir/default/rules/on-finish.md` from `rules/default/on-finish.md` only when absent.
- `src/core/finisher-skill.test.mjs` (new), and the install test that covers `install.sh`
  (`src/shell/launcher.test.mjs` or wherever `SKILLS` is asserted today).

## Interface

The skill must state, each once:

- look only until the go; what look-only allows (DESIGN §2.4 in words, not the list);
- what to check: rules file, main checkout clean and on `main`, `git merge-tree --write-tree` for
  conflicts, tools the rules name present, the report read;
- the `ready` status shape and writing it with `Write` into the status folder, then the go question:
  one `AskUserQuestion`, header `Go`, options `Go` and `Not yet`;
- never treat a chat message as the go;
- after the go: carry out the steps; on failure stop, write `stuck` with what is done and a proposal,
  ask the go question again;
- on success write `done`; on the person's "close the run" write `close`;
- in its replies to the person, plain English (CLAUDE.md).

## Tests

- [ ] The skill contains the `ready`, `stuck`, `done`, `close` shapes and each parses with
      `readStatus` from T01.
- [ ] The skill names the `Go` header and both option labels exactly.
- [ ] `install.sh` into a temp HOME: installs `pir-finisher`, seeds the default rules; a second run
      with an edited default leaves the edit in place.
- [ ] `.pir/rules/on-finish.md` names `./install.sh` and the engine path.

## Done when

- [ ] The three files exist, `install.sh` installs and seeds as above, tests pass.
- [ ] `./install.sh` run here, and `~/.claude/skills/pir-finisher/SKILL.md` and
      `~/.pir/default/rules/on-finish.md` exist afterwards.
