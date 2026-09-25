# Implementation plan

19 tasks in 5 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

**Build route: parallel** (user 2026-09-24, plan review; classic was recommended). The run is driven by
today's installed `--bg` engine, which this plan rewrites, so nothing is installed for real until the person
merges `pir/live-workers` to main (DESIGN §5). During the build: install checks (T10, T15) run
`HOME=/tmp/pir-live-workers-home ./install.sh`, which writes only under that HOME; live checks (T13, T18) run the new
engine from the task worktree (`node <worktree>/src/shell/pir.mjs`, after `npm ci` there), and
`installFixture` carries that worktree's `skills/` into the scratch repo. Merge conflicts in
`loop.mjs`/`coordinate.mjs` go through today's copy-and-paste path. After the merge, one `./install.sh` makes
it live. The run starts only after `declared-test-command` is merged (PROGRESS.md).

## Shape of the build

- **The unknown goes first.** T00 drives one real worker through a real skill-driven task over the line
  and draws pi-tui once, before any design rests on either.
- **Pure before shell, shell before screen.** Phase 1 proves the protocol, the conversation model and the
  person's inputs in `npm test`; Phase 2 wires them to real processes against a fake `claude`; Phase 3
  draws a surface over logic already known to be correct.
- **The line before its users.** The coordinator switches to live workers (T05) before anything sends on
  the line (T07, T08), and orphan reaping (T06) lands with it, since a live child can outlive its parent.
- **Same screen before new screen.** T11 moves the existing views to pi-tui with no visible change, and
  only then do T12 and T13 add to it, so a regression and a new feature are never judged together.

```
Phase 0 ▸ T00                      prove the ground: real worker over the line, pi-tui   throwaway
Phase 1 ▸ T01 T02 T03 T10          protocol, conversation model, person input, packages   pure, npm
Phase 2 ▸ T04 T05 T06 T07 T08 T09  worker process, live platform, reap, inbox, conflict, asking   shell, fake claude
Phase 3 ▸ T11 T12 T13              port, task selection, conversation view                screen, a person
Phase 4 ▸ T14 T15 T16 T17 T18      worker contract, sunset, harness, docs, live run         real agents, a person
```

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-prove-live-worker.md) | prove-live-worker | — |

T00 gates §2.1 (does the pir-worker skill carry a real task through the Agent SDK in auto mode, report
file included), §2.4 (is the `result` event a usable idle signal across a whole task), §2.12 (does a worker
exit on stdin EOF once its turn ends), and §2.11 (does pi-tui install and draw on this machine). A no on
the first three sends the plan back to the user; a no on pi-tui reopens the library decision.

## Phase 1 — The rules, headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-stream-protocol.md) | stream-protocol | T00 |
| [T02](tasks/T02-conversation-model.md) | conversation-model | T01 |
| [T03](tasks/T03-person-input.md) | person-input | T01 |
| [T10](tasks/T10-runtime-deps.md) | runtime-deps | T00 |

End: every log entry reads, every value pir hands the SDK builds, activity and pending requests derive,
the conversation renders to styled lines, and the grant matcher decides, all in `npm test`; pi-tui and
the SDK install pinned and import from `src/shell/`.

## Phase 2 — The live line

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-worker-process.md) | worker-process | T01, T10 |
| [T05](tasks/T05-live-platform.md) | live-platform | T04 |
| [T06](tasks/T06-reap-workers.md) | reap-workers | T04, T05 |
| [T07](tasks/T07-person-inbox.md) | person-inbox | T03, T05 |
| [T08](tasks/T08-conflict-to-worker.md) | conflict-to-worker | T05 |
| [T09](tasks/T09-asking-kinds.md) | asking-kinds | T05, T08 |

End: the coordinator drives fake-`claude` workers through the real SDK end to end, forwards the person's drops, sends the
conflict fix, reaps orphans, and its snapshot says which kind of answer each asking worker wants.

## Phase 3 — The screen

| # | Task | Depends on |
|---|---|---|
| [T11](tasks/T11-screen-on-pi-tui.md) | screen-on-pi-tui | T10 |
| [T12](tasks/T12-task-selection.md) | task-selection | T09, T11 |
| [T13](tasks/T13-conversation-view.md) | conversation-view | T02, T07, T12 |

End: `pir` looks as before, a task row opens its worker, and the conversation view reads, types,
interrupts, answers permissions and question sets.

## Phase 4 — Finish and see it for real

| # | Task | Depends on |
|---|---|---|
| [T14](tasks/T14-worker-contract.md) | worker-contract | T05 |
| [T15](tasks/T15-sunset-pir-coordinate.md) | sunset-pir-coordinate | T10 |
| [T16](tasks/T16-harness-conversations.md) | harness-conversations | T05, T06 |
| [T17](tasks/T17-docs.md) | docs | T06, T07, T08, T13, T14, T15 |
| [T18](tasks/T18-live-run.md) | live-run | T08, T13, T14, T16, T17 |
| [T19](tasks/T19-conversation-view-rig.md) | conversation-view-rig | T13 |
| [T20](tasks/T20-conversation-view-feel.md) | conversation-view-feel | T19; blocks T18 |

T15 depends on T10 only because both rewrite `install.sh`, and T09 on T08 because both change the display
and the footer (`display.mjs`, `render.mjs`); serialising each pair avoids a certain conflict.

## Critical path

```
T00 → T01 → T04 → T05 → T08 → T09 → T12 → T13 → T17 → T18
T00 → T10 → T04                        (light, beside T01; the SDK must be installed before T04)
T00 → T10 → T11 → T12                  (the screen branch meets it at T12)
```

Off the path: T02, T03, T06, T07, T10, T11, T14, T15, T16 slot in wherever convenient.

Leaves: T18 only. Every other task feeds T13, T17 or T18.

## Parallel width

19 tasks · longest dependency chain 10 · up to 5 could run at once (`analyzeParallelism` over the
PROGRESS table). The widest moments are T02, T03, T04, T11 once T01 and T10 are done, and T06–T08, T14 after T05.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T05, T11, T13, T16 |
| **Medium** | T00, T01, T02, T04, T07, T17, T18 |
| **Light** | T03, T06, T08, T09, T10, T12, T14, T15 |

T05 will overrun if the loop's name-matching and grace logic assume `claude agents` in more places than
the survey found. T11 will overrun if pi-tui's renderer cannot reproduce a hand-painted frame byte for
byte; the rule is "looks the same", not "same bytes", so near enough is judged by the person.

## Decisions still open

- None. Build route and build order settled at plan review.
