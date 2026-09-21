# T18 — coordinator-launcher

**Phase:** 5 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

Give parallel mode a global launch command. This plan deleted the `pir-coordinate` skill and made the
coordinator a plain foreground program (DESIGN §2.1), but nothing replaced the skill as a user-facing
entry point: after `install.sh` the only way to start parallel mode in a repo is the bare
`node ~/.claude/pir-engine/src/shell/coordinate.mjs {slug}`, and `install.sh` neither ships a shortcut
nor mentions parallel mode in its closing message. Ship a `pir-coordinate` launcher, installed on the
user's PATH, that runs the installed engine against the current repo.

**Keep it a thin wrapper, not a revived session** (DESIGN §2.1). The point of the plan was that the
coordinator is a plain process; `pir-coordinate` is a launcher for that process, nothing more — it adds
no agent, no skill behaviour, no logic of its own beyond finding the engine and passing arguments and
env through. (PM decision, 2026-09-21: a global command, not a re-added skill.)

## Design sections this implements

No sealed DESIGN rule changes. This implements the launch half of the `/docs`-canonical account of
parallel mode (DESIGN opening blockquote: `/docs` is canonical; new launch behaviour is documented
there, in T19 — this task ships the command T19 documents). DESIGN §2.1 binds the shape: a plain
process, so the launcher stays a wrapper.

## Files

- A launcher script shipped in the repo (e.g. `bin/pir-coordinate`) — a thin wrapper that execs
  `node "<engine>/src/shell/coordinate.mjs" "$@"` in the current working directory, passing every
  argument and the environment through unchanged (so `PARALLEL_LIVE`, `PARALLEL_MAX_WORKERS`,
  `PARALLEL_ALLOW_HERE`, `PARALLEL_POLL_MS`, … all reach the engine, and a dry run stays the default
  with `PARALLEL_LIVE` unset — the engine's own contract, coordinate.mjs `main`). `<engine>` is the
  installed engine path, resolved at install time (the `ENGINE_DEST=~/.claude/pir-engine` install.sh
  already uses), NOT relative to the launcher's own location or the cwd.
- `install.sh` — three additions:
  1. **Install the launcher onto a PATH directory.** Recommend `~/.local/bin` (already on this user's
     PATH; `claude` itself lives there). If that directory is absent or not on PATH, fall back to
     `~/.claude/bin` and **print the exact `export PATH=…` step** as a fallback — never silently install
     a command the user cannot invoke (mirror `apply_automode_rule`'s print-the-manual-step pattern,
     install.sh §apply_automode_rule).
  2. **Remove the stale orphan skills.** `pir-coordinate`, `pir-verify`, `pir-parallelize-plan` were
     deleted from the repo (T07) but linger in accounts that installed an earlier version — `install.sh`
     only refreshes the skills in its `SKILLS` array and never removes these, so they persist as
     confusing orphans (they still advertise the old agentic coordinator). `rm -rf` those three from
     `~/.claude/skills`, idempotently.
  3. **Mention parallel mode in the closing message.** The current "Done" / "Skills installed" messages
     name only `/pir-plan`, `/pir-review-plan`, `/pir-work`. Add the one-line parallel launch:
     `pir-coordinate {slug}` (run from inside the target repo), so an installed user learns it exists.
- A light test (see Tests).

## Interface

```
pir-coordinate {slug}            # launch parallel mode against the current repo (dry by default)
PARALLEL_LIVE=1 pir-coordinate {slug} [with PARALLEL_MAX_WORKERS=…]   # a real, seatbelted run
```

Contract: `pir-coordinate` is exactly `node <installed-engine>/src/shell/coordinate.mjs` with `"$@"`
and the ambient environment forwarded. It resolves the engine at its installed path (so it runs from
any repo), changes nothing about the engine's own dry-by-default / `PARALLEL_LIVE=1`-to-spawn contract,
and carries no logic that could drift from the engine.

## Tests

- [ ] A test asserts the shipped launcher script targets the engine entrypoint
      (`src/shell/coordinate.mjs`), forwards `"$@"`, does not hard-code a slug or force `PARALLEL_LIVE`,
      and is marked executable. Keep it a read-of-the-file check; do not execute a real run.
- [ ] The orphan-skill removal names exactly `pir-coordinate`, `pir-verify`, `pir-parallelize-plan`
      (and no live skill). Cover with a shell-level or fixture check if the install logic is testable;
      otherwise assert the intended removal list and the PATH/launch messages are present, and leave the
      live proof to the hand-check below (the T06 pattern).

## Done when

- [ ] `pir-coordinate` is a global command that, after `install.sh`, launches the coordinator against
      the current repo. Its mechanical parts (exec line, arg/env pass-through, removal list, messages)
      are tested; that it actually resolves on PATH and drives a run is a hand-check.
- [ ] `install.sh` installs the launcher, removes the three orphan skills, and names `pir-coordinate`
      in its closing message with the PATH fallback printed when needed.
- [ ] `npm test` is green.
- [ ] **Hand-verification (needs a person):** run `install.sh`, then from a scratch repo run
      `pir-coordinate {slug}` (dry — `PARALLEL_LIVE` unset — so no paid workers) and confirm it starts
      the coordinator and prints its banner. A full live parallel launch reuses T13's proof; this check
      only needs a real shell with the installed PATH, not paid workers. Hand it over per
      `CLAUDE.md § Anything the tests cannot establish`.
