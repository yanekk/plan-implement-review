# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-29 — 11 fixed, 2 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T10 finisher-live.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | prove-the-fence | — | ✅ | |
| T01 | finisher-policy | — | ✅ | |
| T02 | finisher-brief | — | ✅ | |
| T03 | finisher-skill-and-rules | T01 | ✅ | |
| T04 | finisher-session | T00, T01, T02 | ✅ | |
| T05 | finisher-handover | T04 | ✅ | |
| T06 | finisher-alerts | T05 | ✅ | |
| T07 | finisher-row | T05 | ✅ | |
| T08 | finisher-docs | T03, T05, T06, T07 | ✅ | |
| T09 | finisher-drill | T03, T06, T07 | ✅ | Rig scenarios `finisher-notyet`, `finisher-stuck`, `finisher-reserved`, pretend phone `rig.alerts()`; six pty tests, both sizes, worker-driven. Review clean, no fix commit: suite green, re-drove stuck at 80×24, checked the rig's alert pass mirrors coordinate.mjs (sync publish, done after clear). Unrecorded-deviation check: `finisher-notyet` noted. |
| T10 | finisher-live | T08, T09 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
