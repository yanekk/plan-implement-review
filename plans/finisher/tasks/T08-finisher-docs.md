# T08 — finisher-docs

**Phase:** 3 · **Depends on:** T03, T05, T06, T07 · **Weight:** light

## Goal

Make `/docs` and the README say what the code now does: the finisher, its rules files, the go, what it
may do before and after, its alerts and row, and the changed end of a run with the agent.

## Design sections this implements

All of DESIGN §2; the docs describe the built behaviour, checked against the code, not this DESIGN.

## Files

- `docs/finisher.md` (new): when it comes in, the rules lookup, phases, the fence, the go, status files,
  the end of the run, alerts, the row, storage, failure, known limitations (§2.12's repo-name clash,
  anything T00 found).
- `docs/coordinator-agent.md`: § The end of the run and § Ready to merge say the finisher takes over on
  green with the agent on; the agent is closed then.
- `docs/human-flow.md` § Phone alerts: the finisher's alerts.
- `docs/control-folder.md`: the `finisher/` paths.
- `docs/README.md`: the component and the document index.
- `README.md`: what the finisher does for a user and how to write `.pir/rules/on-finish.md` or
  `~/.pir/{repo}/rules/on-finish.md`, with a link to `docs/finisher.md`.

## Done when

- [ ] Every behaviour in `docs/finisher.md` names the function that implements it, and each was checked
      against the code.
- [ ] The README has a section a new user can act on (where the rules file goes, what the go is).
- [ ] No doc still says a green run with the agent ends only in `ready to merge`.
