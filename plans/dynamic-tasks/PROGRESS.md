# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** All tasks ✅. T05's automated half reviewed clean and its live drill run with the
person on 2026-09-22 — worker escalated before adding, addition well-formed, coordinator adopted
and dispatched (FINDINGS.md). The plan is complete.
**Last updated:** 2026-09-22
**Next `pir-work` will:** nothing — every task is ✅. The plan is done.

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
| T03 | worker-add-task | T02 | ✅ | |
| T04 | docs-and-rules | T02 | ✅ | |
| T05 | live-drill | T02, T03, T04 | ✅ | Automated half clean (fact logic correct vs real flow shape, 4 failure modes red, fixture installs deterministically). Live drill run with the person 2026-09-22: worker escalated before adding, addition well-formed, coordinator adopted→dispatched→merged; both facts PASS, main untouched (FINDINGS.md). No fixes. |

**Review queue:** *(empty — every task is reviewed.)*

## Blocked on the user

*(Empty — a good state. T05's live drill was run and verified with the person on 2026-09-22.)*
