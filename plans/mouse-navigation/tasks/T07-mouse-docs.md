# T07 — mouse-docs

**Phase:** 2 · **Depends on:** T05, T06 · **Weight:** light

## Goal

Bring `/docs` and the README up to date with the mouse, so a reader learns what a click, hover and the
wheel do on each screen, what stays on the keys, how copying text changed, and how to recover a terminal
left in mouse mode by a killed `pir`.

## Design sections this implements

DESIGN §2 (all), §2.7 (the `reset` recovery).

## Files

- `docs/detached-runs.md` — the key table and the list/live-view description gain the mouse
- `docs/human-flow.md` — where it describes moving around the dashboard
- `README.md` — a sentence and a link

## Tests

- [ ] none automated; the drill (T08) checks the docs against the running screen

## Done when

- [ ] `docs/detached-runs.md` states click-opens, hover, the wheel per screen, the keyboard-only list, drag-copy with Option/Shift-drag, and `reset` after SIGKILL.
- [ ] `docs/human-flow.md` agrees with it, and the README mentions mouse navigation with a link.
- [ ] Every statement matches the code as built by T04–T06.
