# T09 — single-finisher-docs

**Phase:** 3 · **Depends on:** T05, T06, T07 · **Weight:** light

## Goal

`/docs` is canonical for how single runs and the finisher behave, and the README follows every major
feature (CLAUDE.md). Carry this plan's behaviour into them, describing what the code does, with its
known limits.

## Design sections this implements

All of DESIGN §2, as built.

## Files

- `docs/single-runs.md`: the intro (no more "hands the person `git merge`"), steps 6+ (sync, helpers, wait,
  finisher), reports (`resolved`, `fixed`), the screen, alerts, stop/resume, control folder, known
  limitations (remove "No finisher"; "No base sync" now applies to build and review only).
- `docs/finisher.md`: "When it comes in" covers single runs; the opening's single variant; the session
  name; known limitations.
- `docs/human-flow.md` (alerts), `docs/control-folder.md` (the single control folder's `finisher/` and new
  logs), `docs/detached-runs.md` (single row states), `docs/README.md` index if needed.
- `README.md`: one or two sentences that a single run now ends with the same finisher and `Go`, linking
  `docs/single-runs.md`.
- `src/shell/single-docs.test.mjs` if it asserts doc text that changed.

## Tests

- [ ] `single-docs.test.mjs` (and any doc test) passes against the new text.

## Done when

- [ ] Every DESIGN §2 rule as built appears in `docs/`, with code pointers to the functions that hold it.
- [ ] README mentions the single-run finisher and links the doc; no doc still says a single run has no finisher.
- [ ] `npm test` green.
