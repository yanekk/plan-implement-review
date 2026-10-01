# T06 — single-finisher-alerts

**Phase:** 2 · **Depends on:** T05 · **Weight:** light

## Goal

The person's phone follows a single run's new ending as it follows a build's: the helpers' questions,
the finisher's ready, stuck, finished and gave-up alerts, `not ready` when the run settles red, and the
old `ready to merge` only when the finisher could not start (DESIGN §2.12).

## Design sections this implements

DESIGN §2.12.

## Files

- `src/shell/single-run.mjs` (`alertPass`, `singleNotifyViews`), `src/shell/single-run.test.mjs`
- `src/core/notify.mjs` only if a helper role needs a word (`ROLE` map); no new alert text

## Interface

```js
singleNotifyViews(runState, sessions, { id, remoteOn })
// adds views for the resolve and fix helpers (role words `resolve`, `fix`), and, when runState.finisher is
// present, finisherNotifyView({ slug: name, view: runState.finisher, pending, url, remote }) keyed 'finisher'.
```

End alerts, once each, from the `finish` and settle points: `endAlert({ slug: name, ready: false, reason,
unresolved, base })` when a sync sequence settles red (once per sequence); `singleEndAlert` only on
fallback `failed`; the finisher's gave-up alert on fallback `gave-up`. None on `finished`, `merged`,
`closed` beyond the finisher's own `finished`.

## Tests

- [ ] A helper asking produces one `{name} · resolve` / `· fix` alert and clears on answer.
- [ ] Finisher `awaiting-go` → `{name} · ready for your go` with the step count; `stuck` → `{name} · finisher stuck`; `done` → `{name} · finished`.
- [ ] Red settle → `{name} · not ready` once per sequence; a second red sequence alerts again.
- [ ] `singleEndAlert` sent on fallback `failed` only; not when the finisher takes over.
- [ ] Gave up → `{name} · finisher gave up` with the merge line.
- [ ] No alert at all when notify is not set up (as today).

## Done when

- [ ] The tests above pass with the notify sender stubbed, as the existing single alert tests do.
- [ ] `npm test` green.
