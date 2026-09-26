# T04 — docs

**Phase:** 3 · **Depends on:** T01, T03 · **Weight:** light

## Goal

Bring `/docs` and `README.md` in line with the new asking rule, so the canonical description matches the
code: when a row reads `asking you`, what un-parks it, and that a worker does not report before an
approval.

## Design sections this implements

DESIGN §2.1–§2.3.

## Files

- `docs/human-flow.md` (the asking section and "Answering away from the terminal — Remote Control").
- `docs/run-lifecycle.md` (the `asking` display phase and the stopped clock).
- `docs/control-folder.md` if it describes the un-park.
- `README.md`: one sentence where it describes asking, linking `docs/human-flow.md`.

## Tests

- [ ] `grep -rn "report first" docs README.md` finds no instruction to report before an approval.
- [ ] Every rule in DESIGN §2.1–§2.2 appears in `docs/human-flow.md` or `docs/run-lifecycle.md`.

## Done when

- [ ] `/docs` states the §2.1 predicate, the §2.2 answer/non-answer table as built by T03, and §2.3.
- [ ] `README.md` has the sentence and link.
- [ ] `npm test` green.
