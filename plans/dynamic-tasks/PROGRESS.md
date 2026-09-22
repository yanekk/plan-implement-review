# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
account is the commit message; writing it twice turns a tracker into a history nobody reads.
**Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** Mechanism (T00–T02), worker contract and docs (T03–T04) all ✅. T05's fixture is
built and the suite is green; its live drill with the person is still unrun (person-only).
**Last updated:** 2026-09-22
**Next `pir-work` will:** review T05's fixture code. The live drill is a separate person-run
verification (see Blocked on the user), not something a session can run for itself.

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
| T05 | live-drill | T02, T03, T04 | 🔍 | dynamic-task fixture built + registered; new fact adoptedAndDispatched (adopt→spawn→merge, task-agnostic); 5 fact tests + spec/determinism tests, 458 green. Automated half only — LIVE DRILL UNVERIFIED, needs the person. No deviations. |

**Review queue:** T05 (fixture code — the automated half).

## Blocked on the user

T05 live drill (person-only, gates ✅). Run the seatbelted coordinator on the installed
`dynamic-task` fixture; when the worker parks asking to add the farewell task, attach in
`claude agents` and approve. Judge: did it escalate before adding, was the addition well-formed,
did the coordinator adopt and dispatch. Record dated in FINDINGS.md as ✅. A worker cannot run
this itself — it spawns real paid agents (DESIGN §5.2).
