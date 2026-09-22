# prototype — pir run-control dashboard

Mock of the `pir` CLI experience, confirmed with the user on 2026-09-22. The user then made its
semantic colours and interaction model **binding** on the build (DESIGN §2.11, §7): T12 implements
this look and these keys rather than redesigning them. Exact terminal spacing stays the builder's —
a real terminal is not this browser mock.

`index.html` — open in a browser. Fake data, nothing real is spawned.

The direction it settled:
- `pir <slug>` starts a plan detached and drops straight into that run's live view.
- `pir` on its own opens a full-screen dashboard listing every run on the machine (across repos).
- A run is selectable (arrow keys or click); opening one shows the live task block — the same
  `docker compose up`-style display `pir-coordinate` paints today (src/core/display.mjs).
- Esc backs out of a run to the list; Esc again quits `pir`.
- Finished and crashed runs are openable too, showing their last painted frame.
- Stop and remove are chorded and double-confirmed like `claude agents`: Ctrl+S twice to stop
  (immediate), Ctrl+X twice to remove a finished/crashed/stopped record.
- No PID column in the list.
