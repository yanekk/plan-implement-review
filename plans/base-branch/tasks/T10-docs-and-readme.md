# T10 — docs-and-readme

**Phase:** 3 · **Depends on:** T08, T09 · **Weight:** light

## Goal

Carry the behaviour into `/docs`, which is canonical for parallel mode, and into the README, so a reader
learns that pir needs a base branch setting, where it goes, what pir fetches and when, and what it will
and will not do to their local branch.

## Design sections this implements

DESIGN §2 throughout, §8.

## Files

- `docs/branch-model.md` (the base branch section: settings, fetch, pirBase; every `main` that means the base), `docs/planning-runs.md`, `docs/run-lifecycle.md`, `docs/coordinator-agent.md` (end of run: fetch, hold, watch), `docs/restart-recovery.md`, `docs/detached-runs.md` (start pre-flight, "unreviewed plan on `main`"), `docs/human-flow.md`, `docs/control-folder.md`, `docs/README.md`
- `README.md`: requirements line (a settings file instead of "a local `main`"), a short "Base branch" section with the two files, the refusal, the fetch and fast-forward behaviour, and a link to `docs/branch-model.md`

## Done when

- [ ] `/docs` describes §2.1–§2.9 as the code now does, and no doc says `main` where it means the base
- [ ] README says what a new repo needs before `pir plan` works, and links the doc
- [ ] `npm test` green (doc-asserting tests, if any, still pass)
