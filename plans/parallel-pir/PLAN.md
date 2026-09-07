# Implementation plan

14 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it
touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The whole decision core is built and proven with no live agents before anything real is
  spawned.** By the end of Phase 1 every decision — which task is ready, is a cap breached, is
  it halted, how a finished task folds back — is implemented and unit-tested in milliseconds.
  Phase 3 then wires those proven decisions to real agents and real merges.
- **The riskiest unknown goes first, as a spike.** T00 proves the `claude` CLI can create,
  drive and close a worker at all. If it cannot, the mechanism of the down-channel and the
  worker lifecycle change, so nothing is designed on top of it until it is checked.
- **A fake world before the real one.** Phase 2 runs the entire loop against fake agents and a
  scratch repo, so the wiring is proven before a paid agent or the real `main` is touched.
- **Recovery before the thing that keeps it alive.** The worktree create/merge/**close**
  plumbing (T09) is built before the first real spawn (T11), so a runaway or abandoned worker
  can always be torn down. The kill switch is wired into that first real spawn, not after it.
- **The dangerous thing small before full size.** The first real spawn is one worker on one
  trivial task (T11); the full multi-worker run with the kill-switch drill is last (T13), with
  the user watching.

```
Phase 0  ▸  T00                    prove the CLI drives a worker      throwaway
Phase 1  ▸  T01 … T06              the decision core, headless        no agents
Phase 2  ▸  T07 … T08              a fake world to rehearse in        no real agents
Phase 3  ▸  T09 … T13              real orchestration, small first    hand-verified
```

---

## Phase 0 — Prove the ground

Nothing is designed on top of a CLI behaviour that has not been checked on this machine.

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-cli-driver-spike.md) | CLI driver spike: create, drive, close a worker | — |

**T00 gates the real-orchestration tasks (T10, T11) and the worker lifecycle in DESIGN §2.3.**
It answers, on the machine and seatbelted: can `claude --bg` spawn a worker in a given worktree
and return a usable id; does `claude --resume <id> -p` drive an acted-on turn into it (and what
happens if it is busy); how does a worker reset to fresh context for its own review; and can the
coordinator close it with `claude stop` then `rm`. Each answer shapes T10/T11; a "no" on the
down-channel means the attach-injection fallback. Throwaway code, deleted afterwards.

## Phase 1 — The decision core (headless, no agents)

At the end of this phase the entire behaviour is decidable and proven without a live agent.

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-scaffold-and-test-command.md) | Project scaffold, `npm test`, the boundary test | — |
| [T02](tasks/T02-progress-parser.md) | Parse `PROGRESS.md` into tasks and the gate line | T01 |
| [T03](tasks/T03-dispatch-decision.md) | `decideDispatch` — spawn / merge / close decisions | T02 |
| [T04](tasks/T04-caps-and-killswitch.md) | Caps, hop depth, the halted check | T01 |
| [T05](tasks/T05-mailbox-format.md) | Mailbox message format, parse, provenance | T01 |
| [T06](tasks/T06-progress-reconcile.md) | Fold one finished task row into `PROGRESS.md` | T02 |

## Phase 2 — A fake world to rehearse in

At the end of this phase the whole loop drains a fake plan to all-`✅` with no real agent.

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-dry-run-harness.md) | Fake agent registry + scratch-repo simulation | T03, T04, T05, T06 |
| [T08](tasks/T08-coordinator-loop.md) | The coordinator loop over the fake world | T07 |

## Phase 3 — Real orchestration, small first

Each task here has a hand-verification half; the dangerous capability is built last.

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-worktree-lifecycle.md) | Real worktree create / integrate / merge / close | T08 |
| [T10](tasks/T10-worker-contract.md) | `pir-worker` contract skill + mailbox-post command | T05, T00 |
| [T11](tasks/T11-real-spawn-one-worker.md) | One real worker, one trivial task, seatbelted | T09, T10 |
| [T12](tasks/T12-pir-coordinate-skill.md) | The `pir-coordinate` skill the user talks to | T11 |
| [T13](tasks/T13-full-parallel-run.md) | Full multi-worker run + kill-switch drill | T12 |

---

## Critical path

```
T01 → T02 → T03 → T07 → T08 → T09 → T11 → T12 → T13
```

T00 is off this line but gates T10 and T11; it can run first or alongside Phase 1, and the
pure core does not depend on it. T04, T05 and T06 are off the critical path and can slot in
wherever convenient within Phase 1, before T07 needs them.

## Rough sizing

Not hours — a relative sense of where the weight is.

| Weight | Tasks |
|---|---|
| **Heavy** | T11 (real spawn + down-channel), T12 (coordinator skill), T13 (full run + drill) |
| **Medium** | T00 (spike), T03 (dispatch), T07 (fake world), T08 (loop), T09 (worktree plumbing) |
| **Light** | T01 (scaffold), T02 (parser), T04 (caps), T05 (mailbox), T06 (reconcile), T10 (contract) |

Where this will overrun: T11, because live CLI behaviour rarely matches the help text on the
first try, and the T00 spike is what de-risks it. And T13, because a kill-switch drill on real
workers is exactly the kind of thing that surfaces the last unhandled state.

## Decisions still open

Nothing blocks the build. Three constants — 5 messages/min, 6 hops, 4 workers — are settled
starting points and are tunable without touching the structure. The down-channel mechanism
(`--resume -p` vs attach-injection) is settled by T00 before T11 needs it.
