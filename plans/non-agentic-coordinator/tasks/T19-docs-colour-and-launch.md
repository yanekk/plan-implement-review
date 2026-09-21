# T19 — docs-colour-and-launch

**Phase:** 5 · **Runs:** auto · **Depends on:** T18 · **Weight:** light

## Goal

Close the two gaps left in `/docs`. A fresh read (2026-09-21) found the docs otherwise current — T08
rewrote them to the plain-command coordinator and T14 updated the merge-conflict account to the attended
model, so the relay/down-channel/pir-coordinate-session language is all correctly described as *removed*.
Two things are missing:

1. **The live display's colours (T16).** `docs/run-lifecycle.md`'s "## The live status display" section
   describes only the in-place render (T15) and never mentions colour.
2. **The global launch command (T18).** The docs still present launching parallel mode as the bare
   `node …/coordinate.mjs {slug}`; the new `pir-coordinate {slug}` command is undocumented.

Fill exactly these; do not re-audit or re-word what is already correct (PM decision, 2026-09-21: fill the
known gaps).

## Design sections this implements

`/docs` is the canonical account of parallel-mode behaviour (DESIGN opening blockquote), so a launch
command and a display change belong here, not in the sealed DESIGN. No DESIGN rule changes.

## Files

- `docs/run-lifecycle.md` — in "## The live status display", add how the board is coloured by task state
  (per-row tint; the amber-bold "asking you" pointer on a parked worker stands out), that colour is a
  paint-time layer gated on a TTY and honouring `NO_COLOR`, and that it degrades to plain, escape-free
  text off a TTY (so the harness/fixtures still read it). Match the shipped behaviour in
  `src/shell/render.mjs` / `src/core/display.mjs` (T16), not the task doc's wording.
- `docs/README.md` and/or `docs/human-flow.md` — document launching parallel mode with
  `pir-coordinate {slug}` (T18), run from inside the target repo, and that the one-time setup is
  `install.sh`. Keep the plain-process framing (a command, not a session).
- Wherever the docs give a user-facing launch instruction as the bare `node …/coordinate.mjs {slug}`,
  make `pir-coordinate {slug}` the primary form (the raw node invocation may stay as the underlying
  mechanism where a reader benefits from knowing it).

**Out of scope (considered, excluded):** the T17 run-scoring distinction (a crashed coordinator scored
`crashed`, not `completed`) is a harness/test-scoring concept, not parallel-mode behaviour a `/docs`
reader acts on, so it is deliberately not added here. Note this in the review so the exclusion is a
recorded decision, not an oversight.

## Interface

Prose only. No code, no interface.

## Tests

- [ ] No code test defends prose. If a docs-touching test exists (a link/reference check, or a test that
      parses a doc), keep it green. The real check is at review: the colour claim matches `render.mjs`
      (T16) and the launch claim matches the shipped `pir-coordinate` command (T18).
- [ ] `npm test` stays green (nothing here should move the count; if it does, something non-doc changed —
      stop and explain).

## Done when

- [ ] `docs/run-lifecycle.md` describes the coloured live display (T16): per-state tint, the stand-out
      parked pointer, TTY-only and `NO_COLOR`-aware, plain off-TTY.
- [ ] The docs name `pir-coordinate {slug}` (T18) as the way to launch parallel mode, with the
      `install.sh` setup step, and no bare-node-only instruction remains as the primary launch guidance.
- [ ] `npm test` is green.
