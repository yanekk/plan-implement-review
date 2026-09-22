# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** Mechanism (T00–T02), docs (T04) and the worker prose contract (T03) all done. Only
T05 remains — the hands-on live drill with the person.
**Last updated:** 2026-09-22
**Next `pir-work` will:** implement T05 — its deps (T02, T03, T04) are all ✅; it needs the person
for the live drill.

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
| T03 | worker-add-task | T02 | ✅ | Clean, no fix commit. Checked the three skills' prose line by line against adoptNewTaskRows and mergeTask: add-only, deps on existing (incl. same-change), forced ⬜, atomic reject, collision surfaced not renumbered, only PROGRESS.md fold-protected so PLAN/FINDINGS conflict on the ordinary path. Suite green; install.sh clean (temp HOME), seven skills installed. |
| T04 | docs-and-rules | T02 | ✅ | |
| T05 | live-drill | T02, T03, T04 | ⬜ | harness fixture + hands-on live run with the person |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — a good state. T05 will need the person for its live drill when it is reached.)*
