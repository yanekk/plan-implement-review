# Implementation plan

16 tasks in 5 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

**Start condition (user decision, 2026-10-02):** start this build only after `pir/single-finisher` is
merged into main. That build rewrites the end of `src/shell/single-run.mjs` and may add suite runs; T09
must queue every suite run that file starts, so it builds on the merged result. Do not run `./install.sh`
while this build runs (DESIGN §5.3).

---

## Shape of the build

- **Rules before shell.** Phase 1 proves the queue's order and staleness, the gate's every step, the
  resume table and every text in core, in milliseconds. The shell tasks then execute decisions already
  known to be right.
- **The queue is one client.** T04 is the only place "one suite at a time" is enforced; the build, its
  end gate, single runs and the screen all go through it, so the rule cannot be bypassed by one caller.
- **Mid-run before restart.** T05 wires the gate in a running build; T06 and T07 add the stop and the
  restart on top of it.
- **The rig exists.** The plan-rig pseudo-terminal rig carries the screen tests; no rig task.
- **Live last.** One paid real run (T16) after the fake-Claude drill and the docs.

```
Phase 1  ▸  T01 T02 T03                     queue rules, gate rules, texts        headless
Phase 2  ▸  T04 T05 T06 T07 T08 T09         queue client, gate, stop, resume,     headless
                                            end gate, single runs
Phase 3  ▸  T10                             worker skills                         headless
Phase 4  ▸  T11 T12 T13                     queue screen, rows, drill             terminal UI
Phase 5  ▸  T14 T15 T16                     fixture, docs, live run               real agents
```

---

## Phase 1 — The rules

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-queue-core.md) | queue-core | — |
| [T02](tasks/T02-task-gate-rules.md) | task-gate-rules | — |
| [T03](tasks/T03-rows-and-alert.md) | rows-and-alert | T01, T02 |

At the end: every queue and gate decision, the resume table, the setting, and every row, note and alert
text are proven in `npm test`; nothing is wired.

## Phase 2 — The machinery

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-queue-client.md) | queue-client | T01 |
| [T05](tasks/T05-build-task-gate.md) | build-task-gate | T02, T03, T04 |
| [T06](tasks/T06-stop-on-third-red.md) | stop-on-third-red | T03, T05 |
| [T07](tasks/T07-retest-on-resume.md) | retest-on-resume | T02, T05 |
| [T08](tasks/T08-queued-end-gate.md) | queued-end-gate | T02, T03, T04 |
| [T09](tasks/T09-single-runs-queue.md) | single-runs-queue | T01, T02, T04 |

At the end: against the fake platform, a build tests every task through the queue, stops on a third
red, retests on resume, queues its end gate; single runs queue; no two suites overlap across processes.

## Phase 3 — The workers

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-worker-skills.md) | worker-skills | T02 |

At the end: the skills tell a parallel worker to run only a subset, wait for pir, and fix only failing
tests; the classic flow is unchanged.

## Phase 4 — The screens

| # | Task | Depends on |
|---|---|---|
| [T11](tasks/T11-queue-screen.md) | queue-screen | T01, T04 |
| [T12](tasks/T12-build-rows-on-screen.md) | build-rows-on-screen | T03, T05, T06 |
| [T13](tasks/T13-queue-drill.md) | queue-drill | T08, T09, T11, T12 |

At the end: the pinned line, the queue view, the rows and the stopped row are driven in a real
pseudo-terminal at three sizes, and the drill has used the whole flow.

## Phase 5 — Proof and docs

| # | Task | Depends on |
|---|---|---|
| [T14](tasks/T14-harness-fixture.md) | harness-fixture | T05, T06, T07, T10 |
| [T15](tasks/T15-docs-readme.md) | docs-readme | T06, T07, T08, T09, T10, T11, T12 |
| [T16](tasks/T16-live-run.md) | live-run | T13, T14, T15 |

At the end: `/docs` and the README describe it as built, and one real build has been seen to follow it.

---

## Main path: who builds, who wires

| Step | Built by | Wired in by |
|---|---|---|
| worker reports, pir enqueues a suite run | T02 rules, T04 client | T05 (`loop.mjs` `applyMessages` and the pass; `coordinate.mjs` constructs the client and reads the limit) |
| one suite at a time on the machine | T01, T04 | T04 (every `poll`) |
| red goes back to the live worker | T02 texts | T05 (`platform.send`) |
| third red stops the build, alert | T02 reason, T03 alert | T06 (`coordinate.mjs`) |
| resume retests | T02 `decideResume` | T07 (`reconcile`) |
| end gate queued | T04 | T08 (`coordinate.mjs`, `loop.mjs` 3f) |
| single runs queued | T04 | T09 (`single-run.mjs`) |
| workers follow the contract | T10 skills | the harness carries `skills/`; the installed copy after merge |
| queue screen | T01 view model | T11 (`pir-tui.mjs`, `list-view.mjs`) |
| rows and stopped row on screen | T03 | T12 (`render.mjs`, `pir-tui.mjs`) |

## Critical path

```
T01 → T04 → T05 → T06 → T12 → T13 → T16
```

T02, T03, T07, T08, T09, T10, T11, T14 and T15 are off it.

Leaves: T16 only.

## Parallel width

16 tasks · longest dependency chain 7 · up to 4 could run at once (`analyzeParallelism`, 2026-10-02).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T04, T05, T11 |
| **Medium** | T01, T02, T06, T07, T08, T09, T12, T13, T14, T15, T16 |
| **Light** | T03, T10 |

T05 is where this will overrun: it changes the pass's report handling, which every hand-off and merge
test runs through. T04's two-process test is the other risk; it must be deterministic under load.

## Decisions still open

None block. The drill (T13) may surface screen choices with two answers; it brings them to the person.
