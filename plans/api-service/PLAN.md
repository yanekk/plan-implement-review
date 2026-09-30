# Implementation plan

11 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- Every rule is built and tested as a pure function before anything binds a port or calls launchd.
  By the end of phase 1 the contract, the file format and the status wording are all proven.
- The riskiest unknown, launchd, was measured during planning with a throwaway scratch agent
  (FINDINGS 2026-09-30), so there is no T00. T09 repeats that measurement against the real code.
- The dangerous thing is built small first: T09 registers a scratch label from a temp folder before
  any real registration, and the real one happens only after the merge.
- Recovery before autostart: `off` (T06) exists before `install.sh` registers anything (T07).

```
Phase 1  ▸  T01 T02 T03          the rules               pure core
Phase 2  ▸  T04 T05 T06          the working parts       file, server, launchctl
Phase 3  ▸  T07 T08              reaching the person     the command, the installer, the automated proof
Phase 4  ▸  T09 T10 T11          proof on this Mac       launchd, real sessions, docs
```

---

## Phase 1 — The rules

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-usage-core.md) | usage-core | — |
| [T02](tasks/T02-api-core.md) | api-core | — |
| [T03](tasks/T03-service-core.md) | service-core | — |

At the end: every decision the feature makes is a tested pure function.

## Phase 2 — The working parts

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-usage-report.md) | usage-report | T01, T02 |
| [T05](tasks/T05-api-service.md) | api-service | T01, T02 |
| [T06](tasks/T06-service-ctl.md) | service-ctl | T02, T03 |

At the end: a run writes readings, the service program answers from them, and the login item can be
registered and removed, each proven on a scratch home with nothing registered for real.

## Phase 3 — Reaching the person

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-service-command.md) | service-command | T06 |
| [T08](tasks/T08-usage-e2e.md) | usage-e2e | T04, T05 |

At the end: `pir service` and `./install.sh` carry the feature, and the suite proves a run started
the real way feeds the running service.

## Phase 4 — Proof on this Mac

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-launchd-check.md) | launchd-check | T05, T06 |
| [T10](tasks/T10-live-usage-check.md) | live-usage-check | T08 |
| [T11](tasks/T11-docs-and-readme.md) | docs-and-readme | T07, T09, T10 |

At the end: launchd and real sessions have been seen working with the real code, and `/docs` and the
README describe it.

The Task cell is the task's kebab slug, matching its `tasks/T{nn}-{slug}.md` filename. Every task is
built by an autonomous worker. No task has a surface, so there is no rig task and no drill.

### Main path: who builds and who wires

| Step | Built by | Wired by |
|---|---|---|
| A worker hears a usage event and it becomes a reading | T01 | T04, in `worker-proc.mjs` |
| The reading is saved | T04 | T04; proven through the real launch path in T08 |
| The service answers `GET /v1/usage` and `GET /health` | T01, T02, T05 | T05, its own entry point; the plist names it (T03, T06) |
| `api.json` is kept current | T02, T05 | T05 |
| The service starts at login and is kept alive | T03, T06 | T07, in `install.sh` and `pir.mjs` |
| An upgrade restarts it | T06 (`refresh`) | T07, in `install.sh` |
| The person sees and stops it | T03, T06 | T07, in `pir.mjs` |
| A new reader learns it exists | T11 | T11 |

---

## After the merge

Not a task: `./install.sh` may not run while a run is live, so these happen once `pir/api-service` is
merged. Each answer goes in FINDINGS with the date.

1. `./install.sh` (§5.3 `ask`), then `pir service` reads `running at http://127.0.0.1:47717`.
2. During a real run: `curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"` matches the newest
   `rate_limit_event` in that run's conversation log, and `observed_at` moves.
3. `kill -9 "$(jq -r .pid ~/.pir/api.json)"` (§5.3 `worker`), then `pir service` reads running with a
   new pid.
4. Log out and in: `pir service` reads running without anyone starting it (person).
5. Tell the agentic-ide plan what §2.1 settled: port 47717, `GET /health`, no `Host` check, the error
   bodies.

## Critical path

```
T01 → T04 → T08 → T10 → T11
```

T02 is on a path of the same length through T05. T03, T06, T07 and T09 are off it.

Leaves: T11 only.

## Parallel width

11 tasks · longest dependency chain 5 · up to 3 could run at once.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T05, T06, T10 |
| **Medium** | T01, T02, T03, T04, T07, T08, T09 |
| **Light** | T11 |

Where this will overrun: T06, on launchd's timing between `bootout` and `bootstrap`; and T10, if the
live run yields fewer than two events in its few minutes.

## Other plans in flight

`pir/finisher` and `pir/single-runs` are unmerged and touch `worker-proc.mjs`, `pir.mjs`,
`launcher.test.mjs` and `fake/claude-stream.mjs`. T04 changes `worker-proc.mjs` in two places and T07
adds one verb to `pir.mjs`; whichever branch merges second resolves a small textual conflict. Neither
plan needs to know about the reporter (DESIGN §2.4).

## Decisions still open

None. The plan review settled `Bash(./install.sh)`: it is under `permissions.ask` (DESIGN §5.3).
