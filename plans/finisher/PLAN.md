# Implementation plan

11 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The fence is proven before anything relies on it.** This machine's settings pre-approve
  `git merge` and `./install.sh`, so a gate in `canUseTool` alone would not see them (DESIGN §3.3).
  T00 measures which fence holds; T04 is built on its answer.
- **The rules are pure and tested before the session exists.** Phases, the look-only list, go
  recognition and status shapes are T01, exhaustively tested with no process.
- **The dangerous thing small first.** The live check (T10) merges into a scratch repo's `main`,
  never this one's.

```
Phase 0  ▸  T00                    prove the fence            throwaway
Phase 1  ▸  T01 T02 T03            rules, messages, skill     no session
Phase 2  ▸  T04 T05 T06            session, hand-over, alerts fake SDK
Phase 3  ▸  T07 T08 T09 T10        screen, docs, drill, live
```

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-prove-the-fence.md) | prove-the-fence | — |

**T00 gates DESIGN §3.3 and T04's session options.** If a `PreToolUse` hook denies an allow-ruled
command, T04 fences with the hook. If not, T04 uses whichever of `settingSources` or `--settings` T00
shows holds, and records the CLAUDE.md consequence. If none holds, the plan stops and goes back to the
person: the look-only promise cannot be kept.

## Phase 1 — Rules, messages, instructions

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-finisher-policy.md) | finisher-policy | — |
| [T02](tasks/T02-finisher-brief.md) | finisher-brief | — |
| [T03](tasks/T03-finisher-skill-and-rules.md) | finisher-skill-and-rules | T01 |

At the end: every rule of DESIGN §2.3–§2.7 is code with tests, and the skill, the default rules and
this repo's rules exist and install.

## Phase 2 — Wiring it in

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-finisher-session.md) | finisher-session | T00, T01, T02 |
| [T05](tasks/T05-finisher-handover.md) | finisher-handover | T04 |
| [T06](tasks/T06-finisher-alerts.md) | finisher-alerts | T05 |

At the end: a green run with the agent hands over to a fenced finisher, which ends the run on done,
close, a hand merge, or gives up back to `ready to merge`; the phone is alerted.

## Phase 3 — Screen, docs, drill, live

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-finisher-row.md) | finisher-row | T05 |
| [T08](tasks/T08-finisher-docs.md) | finisher-docs | T03, T05, T06, T07 |
| [T09](tasks/T09-finisher-drill.md) | finisher-drill | T03, T06, T07 |
| [T10](tasks/T10-finisher-live.md) | finisher-live | T08, T09 |

Main path, builder and wirer per step:

| Step | Built by | Wired in by |
|---|---|---|
| green `ready` → coordinator closed, finisher started | T04 (`startFinisher`) | T05 (`coordinate.mjs` `waiting` step and `startFinisher` factory beside `startAgent`) |
| rules file chosen | T01 (`chooseRules`) | T05 (passes it to `startFinisher`) |
| default rules on disk | T03 (`rules/default/on-finish.md`) | T03 (`install.sh`) |
| finisher knows what to do | T03 (skill) | T02 (`finisherOpening` names it) + T04 (sends it) |
| look-only fence, act after go | T01 (`finisherVerdict`) | T04 (session hook/gate per T00) |
| status files, go detection | T01 (`readStatus`, `isGoAnswer`) | T04 (drain, log watch) |
| the person's go from `pir`'s conversation view reaches the finisher | T04 (`id`, `session`, `logPath`) | T05 (`currentAgent()` → finisher, through `withAgent`) |
| run ends | T05 | T05 |
| alerts | T06 (`notify.mjs`) | T06 (`runNotify` in `coordinate.mjs`) |
| row, `c`, runs list | T07 | T07 (`display.mjs`, `pir-tui.mjs`, `list-view.mjs`, `buildRunState`) |

---

## Critical path

```
T01 → T04 → T05 → T06 → T09 → T10
```

T00 and T02 run beside T01; T03 beside T04; T07 beside T06; T08 beside T09.

Leaves: T10 only.

## Parallel width

11 tasks · longest dependency chain 6 · up to 3 could run at once.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T04, T05 |
| **Medium** | T00, T01, T03, T06, T07, T09 |
| **Light** | T02, T08, T10 |

T05 is where it will overrun: `coordinate.mjs`'s end sequence is 400 lines of step machine with
restart paths, and the finisher adds phases to the `waiting` step and to the restart-in-ready path.

## Decisions still open

- The fence mechanism (DESIGN §3.3): settled by T00. Blocks T04.
- Whether a hook-based fence also covers `Read`/`Write` or only `Bash` (the gate may still be needed for
  path checks): settled by T00, recorded in T04.
