# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** T01 reviewed clean; the merge step adopts new task rows. T02 wires the loop to
surface and narrate them; T03–T04 add the worker contract and docs; T05 is the live drill.
**Last updated:** 2026-09-21
**Next `pir-work` will:** implement T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

**The Task cell is the task's kebab slug** — the same name as its `tasks/T{nn}-{slug}.md` file
and, in parallel mode, its worker's agent name.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | |
| T01 | merge-adopts | T00 | ✅ | Reviewed clean, no fix. Tests force ⬜ over the branch's 🔍/✅, hold single-line fields byte-identical, and cross-check real vs fake. Probed the PROGRESS-only-conflict and clean-merge paths (both overwrite from the pre-merge feature copy) and git show's untrimmed blob. Suite green. (8 new test blocks, not the commit's "11".) |
| T02 | dispatch-adopted | T01 | ⬜ | loop surfaces errors, narrates adopted, both scenarios end to end |
| T03 | worker-add-task | T02 | ⬜ | worker skills: propose, approve, add; reviewer validates |
| T04 | docs-and-rules | T02 | ⬜ | /docs + CLAUDE.md document worker-introduced tasks |
| T05 | live-drill | T02, T03, T04 | ⬜ | harness fixture + hands-on live run with the person |

**Review queue:** empty

## Blocked on the user

*(Empty — a good state. T05 will need the person for its live drill when it is reached.)*
