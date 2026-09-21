# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** Plan just written. Nothing built. The mechanism (T00–T02) is fully headless and
auto-testable; the worker contract and docs (T03–T04) follow; a live drill (T05) closes it.
**Last updated:** 2026-09-21
**Next `pir-work` will:** implement T00 — it has no dependencies and gates the whole chain.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

**The Task cell is the task's kebab slug** — the same name as its `tasks/T{nn}-{slug}.md` file
and, in parallel mode, its worker's agent name.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | |
| T01 | merge-adopts | T00 | ✅ | |
| T02 | dispatch-adopted | T01 | ✅ | |
| T03 | worker-add-task | T02 | ⬜ | worker skills: propose, approve, add; reviewer validates |
| T04 | docs-and-rules | T02 | ⬜ | /docs + CLAUDE.md document worker-introduced tasks |
| T05 | live-drill | T02, T03, T04 | ⬜ | harness fixture + hands-on live run with the person |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — a good state. T05 will need the person for its live drill when it is reached.)*
