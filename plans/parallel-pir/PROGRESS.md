# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** Plan written, re-scoped onto Claude Code's own primitives, and reviewed before build.
The `Runs` column marks each task `auto` (a worker builds it) or `you` (a person runs it). 12
tasks, 5 phases. Review fixed the colourless test command, a signature and a param name, and
gitignored the control dir; decided the main-branch carve-out (coordinator in its own worktree),
closing the implement session at review, and how a `you` task is marked done.
After review the user revised the `you`-task model (2026-09-07): the coordinator now spawns a
hands-on worker (`pir-verify Txx`) the user drives, folded back without review, instead of surfacing
the task bare. Touched DESIGN, T03, T05, T07, T09, T10, T11.
**Last updated:** 2026-09-08
**Next `pir-work` will:** review T08's code half — real spawn/list/close in platform.mjs and the
spawn-one-scratch.mjs harness. Separately, T08's LIVE one-worker run is a person-run hand-verification,
still pending (command under "Blocked on the user"); its result goes to FINDINGS when done. T11 (planner,
deps T04) is also ready if picked out of order.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified by agent 2026-09-07 (user away, delegated): spawn/message/fresh-review/close all confirmed, artifacts deleted. Corrections: `--bg` task positional not `-p`; worker names slash-free. See FINDINGS. Gates T07/T08. |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI under FORCE_COLOR); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fixed: empty `**Plan reviewed:**` note read as reviewed=true → now not-reviewed, with a test. Parser probed on real PROGRESS.md; reconcile round-trips one line. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean, no fix. Crash-window gaps at review-ready and merge logged to FINDINGS for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path, width and auto/you counts correct; layer-width proxy honest (a dep edge strictly raises depth); `errors` reports unknown deps and cycles. Purity proven. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean after one fix (loop called a method outside T06's interface). Findings logged for T06/parser. 86 tests. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed clean after one fix: `remove` now `--force --force` (git refuses single `--force` on a locked worktree), confirmed on real git. 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format (header on line 1 only, body cannot spoof), same-repo `--cwd` guard, parseAgents, `text` matches loop. resolveSameRepo keeps the coordinator itself — inert, logged for T09. 111 tests. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | 🔍 | Built real spawn/list/close in platform.mjs (createPlatform, injected claude runner); argv, openingInstruction, json parse, same-repo filter unit-tested. 119 tests. spawn-one-scratch.mjs drives the loop, ceiling 1, HALT wired. Deviations: close=session-only, spawn({cwd,name,phase}) per built loop not the T08 sketch; scratch transport observes files (SendMessage bus is T09). LIVE run PENDING. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ⬜ | |
| T10 | Full multi-worker run + kill-switch drill | you | T09 | ⬜ | Hand-verified. Dangerous: full size, last. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04 | ⬜ | Changes the shared method. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** T08 (code half) — real spawn/list/close in platform.mjs plus spawn-one-scratch.mjs.

## Blocked on the user

**Progress-path bug fixed (user-authorised scope exception).** The first live run failed reading
PROGRESS.md at the feature-worktree root; the real plan keeps it at `plans/{slug}/PROGRESS.md`.
Fixed via `progressPathFor` threaded through loop.mjs, both worktrees, the fake worker's commit and
the harness (8d76a73), plus a HEAD-pinned main-prep in the harness (598d7c2). This touched T05's loop
+ fakes and T06's worktree — both reviewed — so the changed code should get a fresh review alongside T08.

**Worker-tracking runaway fixed (user-authorised scope exception).** The second live attempt spawned
~12 real workers at ceiling 1: the id `claude --bg` returns does not match the `id` in `claude agents
--json`. Fixed — the loop now matches workers by their deterministic name (§2.8), takes the authoritative
live id from `claude agents --json` for close, and gives a just-spawned worker a one-pass grace so a
slow-to-appear worker is not respawned into a duplicate; the harness has a circuit-breaker that aborts
if live workers ever exceed the ceiling. Regression test added (bogus spawn id vs listed id). This
touched T05's loop and overlaps T09's deferred worker-identity decision, so the changed loop should get
a fresh review. 120 tests green.

**Skills-distribution gap (found in the live run, decision for T09/T10).** Sessions discover skills from
`~/.claude/skills/`, which holds only the classic set; the parallel skills (`pir-worker`, `pir-verify`,
repo `skills/`) were never installed there, so a worker cannot invoke `pir-worker` and falls back to
`pir-implement`. Harmless for the scratch demo (the harness watches the file, not messages) but a real
multi-worker run needs them installed or synced (FINDINGS 2026-09-09).

**T08 LIVE one-worker run — pending, needs a person.** The code half and both live-run fixes are in and
green; the live half (a real worker spawns, acts on the sent instruction, a fresh session reviews, close
leaves nothing behind) can only be seen by a person (DESIGN §5.1). Run it in a FRESH THROWAWAY CLONE
(the harness self-prepares its main and refuses the real repo):

```
git clone <this-repo-path> ../pir-scratch && cd ../pir-scratch   # fresh throwaway clone
PARALLEL_DRY_RUN=0 node src/shell/spawn-one-scratch.mjs          # ONE worker on plans/scratch, ceiling 1
# watch:  claude agents --json        (exactly ONE worker should ever be live)
# abort:  touch plans/scratch/.parallel/control/HALT
```

Expect: open feature → spawn worker (told `pir-implement T01`) → 🔍 → fresh session reviews (`pir-review
T01`) → ✅ → merge → close → promote to the clone's main; `claude agents --json` and `git worktree
list` end clean, main carries `scratch-ok.txt`. Tell me: did the worker act on the sent instruction,
did the fresh review read with genuinely fresh eyes, did close leave nothing behind, and anything that
differed from the T00 spike. Result goes to FINDINGS with the date.

Other person-run work still ahead: T10 (full multi-worker run + kill-switch drill).
