# T04 — dashboard-model

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The pure heart of the dashboard: the list model (rows and counts from resolved run views) and the
keyboard reducer that drives navigation, Esc semantics and the two-press stop/remove confirm. The
front-end (T12) is the terminal painting and the OS calls around this; every rule a person could
check — which run opens, when the confirm is armed, that a running run cannot be removed — lives
here so it is tested in milliseconds, not judged by eye.

## Design sections this implements

DESIGN §2.3 (the dashboard), §2.6/§2.7 (stop and remove, the chords), §3.2 (dashboard.mjs).

## Files

- `src/core/dashboard.mjs` — new.
- `src/core/dashboard.test.mjs` — new.

## Interface

```
buildDashboard(views) → { rows, counts }
  views: [{ slug, state, repo, progress:{done,total}, workers }]   // state from classifyRun (T01)
  rows:  same, in display order (input order preserved)
  counts: { running, finished, crashed, stopped, total }

dashboardReducer(ui, event) → { ui, intent }
  ui = { view:'list'|'watch', sel, openSlug, armed }   // armed: null | { action:'stop'|'remove', slug }
  event = { type, ... }:
    {type:'down'} {type:'up'}                 move selection, clamped
    {type:'select', index}                    set selection (a click)
    {type:'open'}                             list → watch on the selected run
    {type:'back'}                             watch → list; list → intent 'quit'
    {type:'ctrlS'}                            arm/confirm stop on the selected (or open) run
    {type:'ctrlX'}                            arm/confirm remove on the selected run
  intent = null | {type:'quit'} | {type:'stop', slug} | {type:'remove', slug}
```

Rules the reducer encodes (all citable from tests):
- `ctrlS` on a non-running run yields no arm and no intent (nothing to stop); `ctrlX` on a running
  run yields no arm (stop it first).
- First matching `ctrlS`/`ctrlX` sets `armed`; a second identical press (same action, same run)
  emits the intent and clears `armed`; any other event clears `armed` first.
- `back` from `list` emits `{type:'quit'}`; from `watch` returns to `list`.
- The reducer holds no run data beyond the `views` length it is told about; it takes the current
  `views` (or their length) so it can clamp selection and look up the selected slug.

Reason the reducer is separate from `buildDashboard`: the list content is a projection of state,
the navigation is a state machine, and keeping them apart is what lets each be tested without the
other (mirrors the `display.mjs`/`render.mjs` split).

## Tests

- [ ] `buildDashboard` counts each state and preserves row order.
- [ ] down/up clamp at the ends; `select` sets the index.
- [ ] `open` moves to `watch` with `openSlug` set; `back` returns to `list`.
- [ ] `back` in `list` emits `{type:'quit'}`.
- [ ] `ctrlS` on a running run arms; second `ctrlS` emits `{type:'stop', slug}` and disarms.
- [ ] an intervening `down` between the two `ctrlS` presses cancels the arm (no intent).
- [ ] `ctrlX` on a finished/crashed/stopped run arms; second emits `{type:'remove', slug}`.
- [ ] `ctrlS` on a non-running run: no arm, no intent. `ctrlX` on a running run: no arm, no intent.
- [ ] `ctrlS` while in `watch` on a running open run arms and confirms the open run.

## Done when

- [ ] Navigation, Esc semantics and both two-press confirms are pure and fully tested.
- [ ] A running run cannot produce a `remove` intent; a non-running run cannot produce a `stop` intent.
- [ ] `npm test` passes, boundary test still green.
