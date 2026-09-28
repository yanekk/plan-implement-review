# Findings log

**What the build taught.** Read the rows touching the task you pick up; a ✅ row is the entire
record that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Flat prose,
at most one bold phrase a row. Whoever appends, compacts (over 60 rows or 15 KB). Never drop a ✅ row or
its date, or anything somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-28 | 📌 | Plan review: tmux and zellij are not installed here (only `/usr/bin/screen`), so real-multiplexer hover is unprovable. pi-tui sets non-mouse private modes (1049, 25, 7), so rig assertions check the mouse modes 1000/1002/1003/1004/1006, never an empty `modes()`. |
| 2026-09-28 | 📌 | Plan amended after pir-coordinator merged (`7c59312`): live-view rows are `rowEntries` (tasks, separator, agent row, helpers); the separator is unselectable (`moveRow`), so no hit; `c` stays keyboard-only. Rig sets `coordinator-drill`, `end-helper` cover them. |
| 2026-09-28 | ✅ | Spike `prototype/spike.mjs` run by the user in their own terminal: hover brightens rows and looks right; click opens, wheel moves, drag-copy pastes. Their terminal delivers pointer moves (`?1003h`) to pi-tui 0.87.1. |
| 2026-09-28 | 📌 | Planning pty drive of the spike: a drag starting on a row did not open it; pi-tui's selection copied `auth-rewrite` through the injected `pbcopy`, read back by `pbpaste`. Handlers must leave press/drag/release unhandled. |
| 2026-09-28 | 📌 | pi-tui enables only button-motion (`?1002h`, no hover) under `TMUX`, `STY`, `ZELLIJ`, `TERM=tmux*`/`screen*`. Writing `?1003h` after `tui.start()` restores hover; its stop writes `?1003l`. |
| 2026-09-28 | 📌 | Neither pi-tui nor pir installs exit or signal handlers. A SIGTERM'd `pir` leaves the alternate screen and raw mode today; with the mouse on it would also leave mouse reporting. T04 adds the restore. |
