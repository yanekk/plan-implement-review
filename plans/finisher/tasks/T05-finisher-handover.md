# T05 — finisher-handover

**Phase:** 2 · **Depends on:** T04 · **Weight:** heavy

## Goal

Wire the finisher into the end of a build run: on a green `ready` with the agent on, close the
coordinator agent and start the finisher; drive the run's end from the finisher's phase; end the run
on done, close, or a hand merge; fall back to today's `ready to merge` when the finisher cannot start
or gives up; and survive a pir restart in each phase.

## Design sections this implements

DESIGN §2.1, §2.8, §2.12.

## Files

- `src/shell/coordinate.mjs`: a `startFinisher` factory beside `startAgent` (only when the agent is on),
  `chooseRules` with real `existsSync`, `homedir()` and the engine dir; the `waiting` step of `endPass`
  (and the restart-in-ready path in `endSync`) hands over when `handoff.state === 'ready'`; phases drive
  `finish(by)`; `renderFinished` gains `by: 'finisher'` and `'finisher-gave-up'` wording; `runState`
  carries `finisher` (the `view()`), and `coordinator` is null once the agent is closed for the finisher.
- `src/shell/coordinate.test.mjs` (and the end-sequence tests that live beside it).
- `src/shell/control-run.mjs` / startup clearing: `finisher/status/` cleared at startup like
  `coordinator/decisions/`.

## Interface

```
handoff.finisher: null | 'starting' | 'on' | 'fallback'
waiting step, state ready, agent on, finisher null  → closeAgent(); start finisher; 'on' (or 'fallback')
each pass with finisher 'on': drain()
  accepted done   → finish('finisher')
  accepted close  → finish('closed')
  given up        → handoff.finisher = 'fallback' (today's ready-to-merge wait)
mainContains(branch): phase in {preparing, awaiting-go, stuck} or fallback → finish('merged');
                      phase finishing → ignored (the run ends on done)
mainTip moved, phase not finishing → today's re-sync, then finisher.resynced(mainSha)
```

## Tests

- [ ] Green end with the agent: the agent is closed and the finisher started on the next pass.
- [ ] Red end, and `--no-coordinator`: no finisher; behaviour identical to today (existing tests green).
- [ ] `done` ends the run `finished` with the done summary printed.
- [ ] `close` ends it `finished` with the merge line offered.
- [ ] Hand merge in `awaiting-go` ends it `merged`; in `finishing` it does not.
- [ ] `main` moving in `awaiting-go` re-syncs and sends the finisher back to `preparing`.
- [ ] Finisher fails to start → today's `ready to merge`, `finisher failed to start` in the log.
- [ ] Given up → `ready to merge` fallback; the person can still merge by hand to finish.
- [ ] pir restart in each phase resumes the finisher (not the agent) and keeps the report as is.
- [ ] HALT closes the finisher.

## Done when

- [ ] The tests above pass with the fake platform and fake SDK.
- [ ] A green harness run with the agent (`coordinator: true` scenario) reaches the finisher.
- [ ] `./install.sh` run, and the installed `coordinate.mjs` contains `startFinisher`.
