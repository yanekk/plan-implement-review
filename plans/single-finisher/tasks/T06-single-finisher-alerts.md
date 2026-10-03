# T06 — single-finisher-alerts

**Phase:** 2 · **Depends on:** T05 · **Weight:** light

## Goal

The person's phone follows a single run's new ending as it follows a build's: the helpers' questions,
the finisher's ready, stuck, finished and gave-up alerts, `waiting` when the sync is held, `not ready` when the run settles red, and the
old `ready to merge` only when the finisher could not start (DESIGN §2.12).

## Design sections this implements

DESIGN §2.12.

## Files

- `src/shell/single-run.mjs` (`alertPass`, `singleNotifyViews`), `src/shell/single-run.test.mjs`
- `src/shell/single-run.mjs`'s `ROLE` map gains `resolve` and `fix`; `src/core/notify.mjs` gets no new alert text

## Interface

```js
singleNotifyViews(runState, sessions, { id, remoteOn })
// adds views for the resolve and fix helpers (role words `resolve`, `fix`), and, when runState.finisher is
// present, finisherNotifyView({ slug: name, view: runState.finisher, pending, url, remote }) keyed 'finisher'.
```

`finisherNotifyView` covers `awaiting-go`, `stuck` and a parked request only. `finished` and `finisher gave up`
are one-shots built with `finisherAlert`, as `finisherOneShot` (`coordinate.mjs`) sends them for builds.

End alerts, once each, from the `finish` and settle points: `endAlert({ slug: name, ready: false, reason,
unresolved, base })` when a sync sequence settles red (once per sequence); `singleEndAlert` only on
fallback `failed`; `holdAlert({ slug: name, hold })` when the sync is held, once per reason, reusing
`holdAlertPass` (`coordinate.mjs`); the finisher's gave-up alert on fallback `gave-up`. None on `finished`, `merged`,
`closed` beyond the finisher's own `finished`.

## Tests

- [ ] A helper asking produces one `{name} · resolve` / `· fix` alert and clears on answer.
- [ ] Finisher `awaiting-go` → `{name} · ready for your go` with the step count; `stuck` → `{name} · finisher stuck`; `done` → `{name} · finished`.
- [ ] Held sync → one `{name} · waiting` with the reason; the same reason held again sends nothing; a new reason alerts again.
- [ ] Red settle → `{name} · not ready` once per sequence; a second red sequence alerts again.
- [ ] `singleEndAlert` sent on fallback `failed` only; not when the finisher takes over.
- [ ] Gave up → `{name} · finisher gave up` with the merge line.
- [ ] No alert at all when notify is not set up (as today).

## Done when

- [ ] The tests above pass with the notify sender stubbed, as the existing single alert tests do.
- [ ] `npm test` green.
