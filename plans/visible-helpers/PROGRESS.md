# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T07 (docs).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | |
| T02 | helper-rig-scenario | — | ✅ | |
| T03 | helper-lines | T01, T02 | ✅ | |
| T04 | interrupt-gate | T01 | ✅ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ✅ | |
| T06 | helpers-drill | T03, T05 | ✅ | |
| T07 | docs | T06 | 🔍 | Helpers in human-flow.md (new § Helpers, asking sentence), detached-runs.md (conversation view, keys, esc), README bullet. `npm test` green, no new tests. Deviation: `./install.sh` not run; §5.3 says never while a run is live, and this is one. Run it after `git merge pir/visible-helpers`. |

**Review queue:** T07

## Blocked on the user

Nothing.
