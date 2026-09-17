# T06 — Update /docs to the new behaviour

**Phase:** 2 · **Runs:** auto · **Depends on:** T01, T02, T03 · **Weight:** medium

## Goal

Bring the behavioural spec in `/docs` up to what the code now does, because `/docs` is the single
source of truth for how parallel mode behaves (CLAUDE.md) and a spec that lags the code is worse
than none. This plan changed four behaviours — the hands-on completion signal, the coordinator not
policing merges, the worker permission mode and receipt loop, and the coordinator-name check — and
each must read in `/docs` as current behaviour, not as a plan.

## Design sections this implements

DESIGN §2.1–§2.7, restated as behaviour (not rationale) in the docs. The docs describe what the
code does; this plan's DESIGN keeps the why.

## Files

- `docs/human-flow.md` — the hands-on completion signal (`verified Txx` + the feed entry) as the
  designed end of a `you` task; the coordinator does not police merges; a you-task has no `answer`
  and no `surface`.
- `docs/run-lifecycle.md` — the worker spawns in the message-accepting permission mode; the
  down-send is confirmed-received, retried, or surfaced.
- `docs/task-state.md` — a verify task's `done` carries the attestation; `verified Txx` accompanies
  its merge.
- `docs/control-folder.md` — the `verified`-kind entry on the surfaced feed; the flow-log
  `verified` tag.
- `docs/README.md` — the coordinator-name convention is checked at startup; the kill switch is the
  user's and the coordinator does not create it; refresh Known limitations (drop what this plan
  fixed, keep what it did not — e.g. the live behaviours only a person verifies).

## Interface

Prose. The one hard rule: describe **current behaviour**, verified against `src/` as it stands
after T01/T02/T03, with any remaining gap under a **Known limitations** heading rather than papered
over (the docs' own contract, `docs/README.md`).

## Tests

Documentation; acceptance is a read-through against the merged code:

- [ ] Each of the four changed behaviours appears in the right doc as current behaviour.
- [ ] The `verified Txx` tag and the `verified`-kind feed entry are documented where the flow log
      and the surfaced feed are described.
- [ ] Known limitations no longer lists anything this plan fixed, and still lists what it did not
      (the live-only checks).
- [ ] No doc still describes the old fire-and-forget down-send or the silent hands-on completion.
- [ ] `plans/parallel-pir/DESIGN.md` is NOT edited (it is sealed history, CLAUDE.md).

## Done when

- The four changed behaviours read correctly in `/docs`, matched to the code after T01–T03.
- Known limitations is current.
- The sealed parallel-pir DESIGN.md is untouched.
