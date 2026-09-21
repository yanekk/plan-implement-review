# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** T00, T01, T02 done. The loop now acts on adoption. Worker contract and docs (T03–T04)
follow; a live drill (T05) closes it.
**Last updated:** 2026-09-21
**Next `pir-work` will:** implement T03 or T04 (both depend only on T02, now ✅).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

**The Task cell is the task's kebab slug** — the same name as its `tasks/T{nn}-{slug}.md` file
and, in parallel mode, its worker's agent name.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | |
| T01 | merge-adopts | T00 | ✅ | |
| T02 | dispatch-adopted | T01 | ✅ | Clean, no fix commit. Both merge sites consume mergeTask added/errors; both scenarios and reconcile-site green; dispatch.mjs untouched (confirmed). Probed: conflict path skips adoption, reconcile preserves adopted ⬜ rows, atomic reject adopts nothing. One out-of-scope surface-wording nit logged in FINDINGS. |
| T03 | worker-add-task | T02 | ⬜ | worker skills: propose, approve, add; reviewer validates |
| T04 | docs-and-rules | T02 | ⬜ | /docs + CLAUDE.md document worker-introduced tasks |
| T05 | live-drill | T02, T03, T04 | ⬜ | harness fixture + hands-on live run with the person |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — a good state. T05 will need the person for its live drill when it is reached.)*
