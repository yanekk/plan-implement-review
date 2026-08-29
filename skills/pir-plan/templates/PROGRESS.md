# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message you are about to
write, and writing it twice is what turns a tracker into a history nobody reads. **Whoever
writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`
*(Replaced by that session with the date and its verdict. `pir-work` reads this line and
refuses to build while it says "not yet": an unreviewed plan copies its defects into every
task built from it, and no later review catches them.)*

**Status:** *(two or three sentences: what is done, what is in flight, what is blocked.
Rewritten each session, never appended to.)*
**Last updated:** {date}
**Next `pir-work` will:** *(one line — which task, and why it and not another. The table
below is the authority; if the two disagree, trust the table.)*

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | {name} | — | ⬜ | |
| T01 | {name} | T00 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A deviation needing a paragraph needs the commit message: name
it here and point there.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed — its detail
is in the commit and the file is read in full by every session from here on.

**Review queue:** *(empty)*

## Blocked on the user

*(Anything waiting on a person: what it is, the exact command, what to look for. Empty is a
good state and should say so.)*
