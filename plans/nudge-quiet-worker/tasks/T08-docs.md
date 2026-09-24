# T08 — docs

**Phase:** 2 · **Depends on:** T05, T06, T07 · **Weight:** light

## Goal

Make `/docs`, the canonical account of how parallel mode behaves, describe the nudge as built. The
docs currently state that no coordinator→worker channel exists; that sentence is now wrong, and a
reader debugging a stuck run needs to know what the coordinator does about quiet workers and what the
new log lines and labels mean.

## Design sections this implements

DESIGN §2.1–§2.7, as built. Where the build diverged from DESIGN, document the build and log the
divergence in FINDINGS.

## Files

- `docs/control-folder.md`: rewrite "Messaging is one direction only" (the "no coordinator → worker
  channel at all" paragraph): reports go up by file drop, and the only thing sent down is the fixed
  nudge through the worker's inbox socket. Add `nudge`, `nudge-failed`, `stuck`, `unstuck`,
  `activity-degraded` to the log-kinds list. Mention `PARALLEL_NUDGE_MS` beside `AWAIT_IDLE_TIMEOUT_MS`.
- `docs/run-lifecycle.md`: the nudge step in "Each pass"; the `nudged N×` / `stuck` labels in "The live
  status display".
- `docs/human-flow.md`: "routes nothing" stays true for answers; say the nudge never involves the
  person. Update "Known limitation" to say what the nudge now covers (a worker held before its report)
  and what it still does not (a detached daemon outliving a closed session; a permission prompt).
- `docs/README.md` if it indexes the channel model.

Do not edit any finished plan's DESIGN.md.

## Tests

- [ ] `npm test` stays green (some tests read docs; update them if wording they pin has changed
      deliberately).
- [ ] `grep -rn "no coordinator → worker channel\|cannot send a cross-session message" docs src skills`
      finds nothing.

## Done when

- [ ] The three docs describe the nudge, its eligibility, its labels and its log lines as built.
- [ ] The grep above is empty.
- [ ] Every setting name, log kind and label in the docs matches the code exactly.
