# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** Mechanism (T00–T02), worker contract and docs (T03–T04) all ✅. T05's automated
half is reviewed clean; only its person-only live drill is left, and it gates ✅.
**Last updated:** 2026-09-22
**Next `pir-work` will:** nothing new — T05 is ⛔ on the person's live drill (see Blocked on
the user). Once the person runs it and it is recorded in FINDINGS.md, flip T05 to ✅.

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
| T05 | live-drill | T02, T03, T04 | ⛔ | Automated half reviewed clean: adoptedAndDispatched fact logic correct against the real flow shape (adopt→spawn→merge, ISO ts ordering), its 4 failure modes go red, fixture installs deterministically (verified by hand, SHA efab31f). No fixes. Now ⛔ on the person for the live drill, which gates ✅. |

**Review queue:** *(empty — T05's automated half is reviewed; the live drill is person-only.)*

## Blocked on the user

T05 live drill (person-only, gates ✅). Run `node src/shell/harness/run.mjs dynamic-task` — it
installs the fixture into a throwaway scratch repo and launches the coordinator seatbelted
(PARALLEL_LIVE=1, ceiling 1, a 30-min wall-clock auto-HALT). When the worker parks asking to add
the farewell task, attach in `claude agents` and approve in its own session. Judge: did it
escalate before adding, was the addition well-formed, did the coordinator adopt and dispatch.
Record dated in FINDINGS.md as ✅. A worker cannot run this — it spawns real paid agents (§5.2).
