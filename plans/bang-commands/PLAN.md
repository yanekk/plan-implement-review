# Implementation plan

11 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

Before the build starts, the red `notify-wiring.test.mjs` cases on `main` (DESIGN §4) is fixed on `main`
separately and `main` is merged into this branch; otherwise the end gate fails for a reason outside
this plan.

---

## Shape of the build

- **Riskiest unknown first.** T00 settles whether the hand tool's request reaches `canUseTool` in the
  workers' `auto` mode; T04 and T05 depend on its answer.
- **Headless before pixels.** T01–T05 are proven by unit tests and the fake `claude` before the view
  changes in T06–T07.
- **Prose last.** T09 and T10 describe what was built and seen.

```
Phase 0  ▸  T00                       hand-tool spike
Phase 1  ▸  T01  T02  T03  T04  T05   runner; rules; forwarding; hand rules; hand tool
Phase 2  ▸  T06  T07  T08             bang view; hand view; drill
Phase 3  ▸  T09  T10                  agent rules; docs and README
```

## Phase 0 — The ground

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T00](tasks/T00-hand-tool-spike.md) | hand-tool-spike | — | light |

## Phase 1 — The machinery

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T01](tasks/T01-shell-runner.md) | shell-runner | — | medium |
| [T02](tasks/T02-bang-rules.md) | bang-rules | — | medium |
| [T03](tasks/T03-bang-forwarding.md) | bang-forwarding | T01, T02 | heavy |
| [T04](tasks/T04-hand-rules.md) | hand-rules | T00, T02 | medium |
| [T05](tasks/T05-hand-tool.md) | hand-tool | T00, T03, T04 | medium |

T03 and T05 both edit `person-inbox.mjs` and `worker-proc.mjs`, so T05 follows T03. T04 follows T02
because both edit `stream.mjs`.

## Phase 2 — The screen

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T06](tasks/T06-bang-view.md) | bang-view | T02, T03 | heavy |
| [T07](tasks/T07-hand-view.md) | hand-view | T05, T06 | medium |
| [T08](tasks/T08-bang-drill.md) | bang-drill | T06, T07 | medium |

T07 follows T06 because both edit `conversation.mjs` and `conversation-view.mjs`. T08 reaches every
build task: T06 → T02, T03 → T01; T07 → T05 → T00, T04.

## Phase 3 — The words

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T09](tasks/T09-agent-rules.md) | agent-rules | T05 | light |
| [T10](tasks/T10-docs-readme.md) | docs-readme | T08, T09 | medium |

T10 is the only leaf.

---

## Main path and who wires it

| Step | Built by | Wired by |
|---|---|---|
| `!` in the box, mode and submit | T06 | T06 (`conversation-view.mjs`, already mounted by `pir-tui.mjs` `paintConv`) |
| drop validated | T02 (`person-input.mjs`) | T06 (view's `send`), T03 (forwarder's `drain`) |
| forwarder runs it in the session's folder | T01 (`person-shell.mjs`) | T03 (`person-inbox.mjs`, constructed in `coordinate.mjs`, `plan-run.mjs`, `single-run.mjs`) |
| output into the conversation log | T03 (`worker-proc.mjs` `logEntry`, `platform.log`) | T03 |
| block drawn | T06 (`conversation.mjs`) | T06 |
| result sent to the agent | T02 (`bangMessage`) | T03 |
| Esc stops it | T01, T03 | T06 |
| reap after a host restart | T01 | T03 (each host's start) |
| hand tool offered to the agent | T05 (`worker-proc.mjs`) | T05 (`platform.mjs` spawn, `held-session.mjs`) |
| hand request read, labelled, alerted, reserved | T04 | already wired: `coordinate.mjs` `workerFields`, `sessionAsking`, `notify` read `waitingOn`/`kindPart` |
| hand request pinned, run, edited, declined | T07 | T07 |
| hand request answered with the output | T05 (`person-inbox.mjs`) | T05 |
| agents told when to hand | T09 (skills) | `./install.sh` by the finishing rules after the merge, never inside the run (DESIGN §5.3) |

## Critical path

T01 → T03 → T05 → T07 → T08 → T10, six tasks (T00 → T04 → T05 joins it at T05). The weight is in T03
(three hosts) and T06 (the view).

## Open

Nothing undecided. T00's answer chooses between `canUseTool` directly and a `PreToolUse` `ask` hook in
T05; both are designed (DESIGN §2.6).
