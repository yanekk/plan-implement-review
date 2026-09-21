# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** T00 done, T01 implemented and awaiting review. The merge step now adopts new task
rows; T02 wires the loop to surface and narrate them; T03–T04 add the worker contract and docs;
T05 is the live drill.
**Last updated:** 2026-09-21
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

**The Task cell is the task's kebab slug** — the same name as its `tasks/T{nn}-{slug}.md` file
and, in parallel mode, its worker's agent name.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | |
| T01 | merge-adopts | T00 | 🔍 | mergeTask (real + fake) now adopts via adoptNewTaskRows instead of restoring PROGRESS.md verbatim; returns {ok,added,errors}. Branch copy read from its committed tip (git show). 11 tests, incl. a real/fake byte-identical cross-check placed in worktree.test.mjs. No deviations. |
| T02 | dispatch-adopted | T01 | ⬜ | loop surfaces errors, narrates adopted, both scenarios end to end |
| T03 | worker-add-task | T02 | ⬜ | worker skills: propose, approve, add; reviewer validates |
| T04 | docs-and-rules | T02 | ⬜ | /docs + CLAUDE.md document worker-introduced tasks |
| T05 | live-drill | T02, T03, T04 | ⬜ | harness fixture + hands-on live run with the person |

**Review queue:** T01

## Blocked on the user

*(Empty — a good state. T05 will need the person for its live drill when it is reached.)*
