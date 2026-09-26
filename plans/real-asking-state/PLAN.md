# Implementation plan

6 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Probe first.** T00 measures whether a Remote Control answer can be told from a background wake-up;
  T03 is built on its answer, or falls back to a skill line with the person's say-so.
- **Headless before live.** T01–T03 are proven in `npm test` with the fake worker; the only paid run
  is T05, at the end, bounded by ceiling 2 and a 15-minute timeout.
- **Prose after the machine.** The docs (T04) follow T01 and T03, so they describe what was built.

```
Phase 1  ▸  T00  T01  T02             probe, skill line, waiting predicate     parallel
Phase 2  ▸  T03                        answer-only un-park                      needs T00, T02
Phase 3  ▸  T04 → T05                  docs, then the live check
```

## Phase 1 — Probe and the parts that need no probe

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-remote-answer-probe.md) | remote-answer-probe | — |
| [T01](tasks/T01-worker-contract.md) | worker-contract | — |
| [T02](tasks/T02-waiting-predicate.md) | waiting-predicate | — |

T02 is its own wirer: it adds `waitingOn` and switches the three callers in `coordinate.mjs` to it.

## Phase 2 — Narrow the un-park

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-answer-only-unpark.md) | answer-only-unpark | T00, T02 |

T03 wires its own change into `resumeAnswered` (`loop.mjs`) and, if T00's signal needs capturing,
`worker-proc.mjs`.

## Phase 3 — Document and see it live

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-docs.md) | docs | T01, T03 |
| [T05](tasks/T05-live-asking-check.md) | live-asking-check | T04 |

T05 reaches every task through T04 → T01 and T04 → T03 → T00, T02. It is the only leaf.

---

## Critical path

```
T00 → T03 → T04 → T05
```

T02 is as long as T00 into T03. T01 is off the critical path.

## Sizing

T00 medium (needs the person's phone), T02 and T03 medium, T01 and T04 light, T05 medium (paid run and
the person's phone).

## Parallel width

6 tasks, longest chain 4, up to 3 can run at once (T00, T01, T02).

## Open

- No terminal-driving end-to-end test or drill is planned: no screen is drawn or changed, only when
  existing labels apply, and that is asserted on the run state (DESIGN §4). Plan review may disagree.
- T03's body depends on T00; if T00 finds no signal, T03 is replaced with the fallback after asking the
  person.
