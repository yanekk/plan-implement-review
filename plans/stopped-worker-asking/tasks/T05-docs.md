# T05 — docs

**Phase:** 3 · **Depends on:** T03, T04, T06 · **Weight:** light

## Goal

Carry the stopped-worker rule into `/docs` and `README.md`, so a reader learns that a worker which
stops to ask reads `asking you` with or without a report, and when it does not (a background job still
running). This completes the feature, so the README update belongs here.

## Design sections this implements

DESIGN §2.1–§2.4, §2.6.

## Files

- `docs/human-flow.md`: where it says when a row reads `asking you`, add the stopped case, the
  background-job exception, mistaken stops reading asking, and the planning-step reading.
- `docs/task-state.md` if it states when a task reads asking.
- `docs/planning-runs.md`: the planning step's `asking` reading.
- `README.md`: one or two sentences where it describes `asking you`, pitched at a user, with the link
  to `docs/human-flow.md`.

## Tests

- [ ] None automated. Every behaviour claim is checked against the code as merged (T02, T03) and T06's
      findings row.

## Done when

- [ ] Each file above states the rule as built, with no claim the code does not make.
- [ ] `README.md` mentions it and links to `/docs`.
- [ ] `npm test` is green.
