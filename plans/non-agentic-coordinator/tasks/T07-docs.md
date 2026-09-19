# T07 — Rewrite /docs and the CLAUDE.md carve-out

**Phase:** 3 · **Runs:** auto · **Depends on:** T04, T06 · **Weight:** heavy

## Goal

Bring the canonical account of parallel mode in line with the shipped behaviour. `/docs` is where
"how parallel mode actually works" lives (per `CLAUDE.md`), so this plan updates `/docs` rather than
the sealed `plans/parallel-pir/DESIGN.md`. Every place that describes an agentic coordinator, a
down-channel, an automatic promotion, or an `auto`/`you` distinction is rewritten to the plain
foreground command, the direct person↔worker exchange, the branch hand-off, and the single kind of
worker. The `CLAUDE.md` parallel-mode carve-out is reworded from "a coordinator session" to a
coordinator command; the classic single-stream rules are untouched.

## Design sections this implements

All of DESIGN §2 — this is where §2 becomes the canonical `/docs` account. Comes after the code
(T01–T04) and the skills (T06) so it describes what shipped, not what was planned.

## Files

- `docs/README.md` — the coordinator is a command, not a session the person talks to.
- `docs/run-lifecycle.md` — driven by the command; no promote step; ends at the branch hand-off.
- `docs/human-flow.md` — the person answers a blocked worker directly in `claude agents`; no
  surface/answers/route relay; remove the `you`/hands-on flow.
- `docs/control-folder.md` — remove `outbox`, `answers`, `surfaced`; keep `reports/` (up-channel) and
  `log`; the kill switch is Ctrl-C, not a `HALT` flag relayed by a session.
- `docs/branch-model.md` — the command runs the feature branch in its own worktree; promotion is the
  person's manual `git merge`.
- `docs/task-state.md` — remove the `Runs` marker section; one kind of worker.
- `docs/restart-recovery.md` — Ctrl-C kills workers; a re-run reaps and rebuilds from committed state.
- `CLAUDE.md` — the "Where sessions run" parallel-mode carve-out (coordinator command, not session)
  and "The files" (drop the `Runs` marker text). Leave the classic-flow rules and the `pir-work`
  routine unchanged.

## Interface

No code. The contract is that no `/docs` file or `CLAUDE.md` section describes the agentic
coordinator, the down-channel/SendMessage relay, automatic promotion, or the `auto`/`you`
distinction, and every claim traces to shipped code (T01–T06).

## Tests

- [ ] `npm test` is green (docs-only change; nothing new to unit-test).

## Done when

- [ ] Every `/docs` file describes the plain-command coordinator, the direct person↔worker model, the
      no-promotion hand-off, and one kind of worker; no stale reference to the agentic coordinator,
      the down-channel, `HALT`-as-relayed, promotion, or `Runs`/`you` remains.
- [ ] The `CLAUDE.md` carve-out is reworded to a coordinator command and the `Runs` marker text is
      gone; the classic-flow rules are unchanged.
- [ ] `npm test` is green.
