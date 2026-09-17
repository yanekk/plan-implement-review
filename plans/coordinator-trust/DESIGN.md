# coordinator-trust — Design

Read this before changing behaviour. Every rule carries its reason. Flat prose on purpose:
this file is re-read in full by every session that touches the thing it governs.

This plan modifies the existing parallel-pir system. It does not build a new one. The
components, the run lifecycle, the branch/worktree model, the control folder and the task
states are canonical in `/docs`, not here. Where this plan changes how parallel mode behaves,
the change lands in `/docs` (task T06), because `/docs` is the single source of truth for
parallel-mode behaviour and `plans/parallel-pir/DESIGN.md` is sealed history (CLAUDE.md). This
file is the build-time rationale for the changes only.

## 1. Purpose

The parallel coordinator killed a correct run. In the `my-ender/print-vision` run a person
verified a hand-driven task (T00, a pause-command spike) directly inside its worker session,
the engine merged it correctly, and the coordinator — a separate session with no window into
that hand-driven work — read the resulting merge as a fabricated commit, declared an
"integrity failure", and created the kill-switch file to freeze everything. It also stranded a
reviewer that had already received its decision and was mid-integration. Nothing the worker or
the engine did was wrong; the coordinator's view of a legitimate hand-driven completion was
silence, and it filled the silence with fraud.

This plan makes the coordinator's view of its workers trustworthy and its reactions safe. It
gives a hand-driven task a real completion signal the coordinator can see, forbids the
coordinator from policing the engine's merges or reaching for the kill switch on suspicion,
closes the loop on messages sent down to workers, and enforces the coordinator's own naming
convention so an off-convention launch is caught at the start rather than becoming a latent
trap.

### Success criteria

- A finished `you`/verify task produces a positive, machine-emitted completion signal the
  coordinator reads as "verified by the person, as designed" — not an unexplained merge.
- The coordinator never creates the kill-switch file on its own suspicion, and never brands an
  engine merge as fraud. The kill switch is the user's.
- A decision sent down to a worker is confirmed received, retried if not, and surfaced to the
  user if the worker is genuinely unreachable — no silent loss.
- A spawned worker accepts a cross-session message without a person approving it.
- A coordinator launched with an off-convention name (a `/`, the wrong shape) is caught at
  startup with the correct name to use, before it dispatches anything.

### Stance

The person owns every genuine decision, including the decision to stop a run. The coordinator
is a dispatcher and a relay, not a fraud investigator. When the coordinator cannot see
something a worker did, the answer is to give it a signal it can see, never to let it guess the
worst and act on the guess. A hand-driven task's proof is the person who drove it; the
coordinator's job is to carry that proof, not to re-audit it.

---

## 2. Behaviour specification

### 2.1 A hands-on task's completion is a signal, not a silence

A `you`/verify task is driven by the person inside the worker's own session (the classic
hands-on flow, `/docs/human-flow.md`). The coordinator is a different session and sees only the
flow log: today that is `hands-on Txx` when the worker spawns, then — with nothing in between —
`merge Txx` and `close Txx` when the worker's `done` report lands and the engine merges the
task. The gap between those two is where the person did the whole verification, and the
coordinator sees none of it. That silence is the root cause: with no positive evidence the
person was involved, an unexplained merge of a "verified …" commit reads as fabrication.

The fix is a real signal. When a verify worker's `done` report carries the human-verification
attestation the person and the worker produced (the machine result and the person's judgement,
which `pir-verify` already gathers, §2.2), the engine emits a distinct completion signal the
coordinator reads: a `verified Txx` flow-log line and the attestation text on a
coordinator-readable feed. The coordinator then sees "T00 — person confirmed the printer
paused; probe showed the print entered the paused state", not an unexplained merge. Reason: the
coordinator acted on the absence of evidence; the fix is to supply the evidence, so its correct
behaviour needs no trust in its self-restraint.

This is an extension of machinery that already exists, not a new channel. Verify workers
already drop a `done` report the bin drains; the flow log already carries per-action lines the
coordinator reads as ground truth; the surfaced feed already carries plain-English text keyed by
task. The signal reuses all three (§3.2).

### 2.2 The attestation a verify worker carries

`pir-verify` already records two separate confirmations into `FINDINGS.md` on the task branch:
the machine result it observed (an automated check the worker ran) and the person's judgement
(what only the person could decide), never rounding an ambiguous reply up to the bigger claim
(`/docs`, DESIGN of parallel-pir §2.6). The change here is that the worker also puts those two
confirmations into its `done` report, in the small structured form the engine parses (§3.3), so
the attestation reaches the coordinator and not only the task-branch findings file. The two
confirmations stay separate in the report exactly as they are separate in findings: a machine
result is not a person's judgement and the report must not blur them.

If a verify task legitimately has no machine half (a pure look-at-it check), the machine
confirmation is recorded as "none" rather than omitted, so the coordinator can tell an absent
machine check from a forgotten one.

### 2.3 The coordinator does not police the engine's merges

The engine's merge path is the tested machine that folds one finished task branch into the
feature branch and reconciles its row (`/docs/run-lifecycle.md`, `/docs/task-state.md`). A merge
in the flow log is the engine reporting its own action, not a worker's claim the coordinator must
audit. The coordinator therefore never treats a `merge Txx` line as evidence of fraud, never
re-reads a merged commit to decide whether it "really happened", and never acts against a merge
it finds surprising. If a merge is genuinely unexpected, that is a thing to surface to the user
as a question (the normal decision path), never a thing to freeze the run over. Reason: the
coordinator misread a correct merge and reached for the strongest possible action on its own
authority; the merge is the engine's to make and the stop is the user's to call, and the
coordinator is neither.

A `you`/verify task in particular completes with **no `answer` from the coordinator and no
`surface`** — the person drives it directly, so the coordinator is never asked for anything
(`/docs/human-flow.md`). The absence of an `answer Txx` line for a `you` task is therefore not
evidence the task did not happen; it is the designed shape of a hand-driven task. The
coordinator must not infer from "I was never asked about T00" that "T00 was never done".

### 2.4 The kill switch is the user's

The kill-switch file (`HALT` in the control folder) stops the whole run and closes every worker
(`/docs`, kill switch). It exists for the user to stop a run they no longer want. The coordinator
does not create it. It has no case in which freezing the run is the coordinator's call: a genuine
problem it can see is surfaced to the user as a decision, and the user decides whether to stop.
Reason: the one time the coordinator created it, the emergency was imaginary and the cost was a
correct run destroyed; giving a dispatcher a unilateral stop it reaches for on a hunch is the
hazard, not the safeguard.

This is a rule on the coordinator skill, not a lock in the engine: the `HALT` file is a plain
file any process can write, and the engine cannot tell a coordinator's `touch` from a user's.
The engine already treats a present `HALT` as the user's stop and closes workers for forensics;
that behaviour is unchanged. What changes is that no instruction anywhere leads the coordinator
to create it, and the skill says plainly that it must not (§2.3, T05).

### 2.5 A decision sent down is confirmed, retried, or surfaced

The coordinator carries a decision down to a parked worker with the `SendMessage` agent tool
(`/docs/human-flow.md`; the up-channel is files, the down-channel is the coordinator's send).
Today that send is fire-and-forget: the platform reports the message "queued", and whether the
worker actually took it depends on the worker's permission mode and arrives — if at all — as a
later delivery notice the coordinator does not wait for. In the run that failed, the one send
happened to be accepted, but nothing in the loop confirmed it.

The rule: a down-send is not done when it is queued, it is done when it is confirmed received.
After sending, the coordinator watches for the delivery notice; if none comes within the fallback
window it re-reads the outbox line (which stays queued) and sends again; if the worker is
genuinely gone after a retry it surfaces the failure to the user in plain English rather than
moving on as though the decision landed. Reason: the decision reaching a blocked worker is the one
message that matters, and a decision believed-delivered but actually dropped leaves a worker parked
forever on an answer it never got.

### 2.6 A worker accepts messages without a person

A spawned worker must accept the coordinator's cross-session messages without a person
approving each one — there is no person at a worker's terminal to approve, so a worker in a
mode that prompts for approval is a worker no decision can reach. Today the worker spawn sets no
permission mode (`spawnArgv` is `['--bg', '-n', name, instruction]`, §3.2), so a worker lands in
whatever the default is, which in the failed run required approval. The change adds the
permission mode that makes a worker accept both its tool use and incoming messages
autonomously. The exact flag is settled by the T00 spike against live sessions (§5.1), because
whether a given mode also auto-accepts cross-session message *delivery* — a separate gate from
tool permissions — is not knowable from the flag's help text.

### 2.7 The coordinator's own name is checked at startup

The convention is `{repo} · {plan}` for the coordinator and `{repo} · {plan} · T{nn} · {role}`
for a worker, with `·` (U+00B7) as the separator because `SendMessage` rejects a name containing
`/` (`/docs`, naming; `naming.mjs`). In the failed run the coordinator was launched as
`my-ender / print-vision-refactor` — a `/` separator and the wrong plan segment. It did no harm
in that run only because workers report up by file and never address the coordinator by name, so
its malformed name was never a message target. It is a latent trap: the exact character that
breaks addressing, sitting in the identity the operator sees and any future down-addressing would
use.

The fix is a startup check. When `/pir-coordinate` starts, it validates its own session name
against the convention for this repo and plan; a name with a `/`, or one that does not parse to a
coordinator name for this slug, is caught then and there, with the correct name to relaunch
under, before any worker is spawned. Reason: an off-convention name is cheap to catch at the
start and expensive to discover later; catching it at launch turns a latent trap into a
one-line correction.

---

## 3. Architecture

The parallel-pir architecture is inherited whole (`/docs`, `plans/parallel-pir/DESIGN.md`): a
pure decision core in `src/core/` that touches no clock, no I/O and no network, and a thin shell
in `src/shell/` that does. This plan's changes respect that boundary; none of them moves a
decision out of the core or a side effect into it.

### 3.1 The boundary

```
src/core/     — pure. naming.mjs (name build/parse/validate), dispatch.mjs (what to do),
                progress.mjs, parallelism.mjs. No clock, no I/O, no network.
src/shell/    — platform-shaped. platform.mjs (spawn/list/close/send over real claude),
                loop.mjs (one pass), coordinate.mjs (the bin + the file bridge).
skills/       — prose the sessions follow. pir-coordinate, pir-verify, pir-worker.
docs/         — the behavioural spec. Updated when behaviour changes.
```

The boundary is enforced by `src/core/boundary.test.mjs`, which scans the pure side for
forbidden imports. If it fails, the fix is to move the code, never to relax the test. Reason:
everything on the pure side is testable exhaustively in milliseconds; every rule that leaks
across becomes a rule only a person can check.

Placing this plan's changes on the boundary:

- **The name validator (T03)** is pure string work and belongs in `src/core/naming.mjs`, beside
  `coordinatorName`/`parseAgentName` it reuses.
- **The completion signal (T02)** is two shell concerns — parsing a worker's report and emitting
  a flow-log line — and belongs in `src/shell/loop.mjs`/`coordinate.mjs`, where the report drain
  and the flow log already live. What counts as a valid attestation is a small pure predicate and
  may sit in core if that reads cleaner; the emission is shell.
- **The spawn permission flag (T01)** is argv construction in `src/shell/platform.mjs`
  (`spawnArgv`), already unit-tested there.
- **The guardrails, the receipt loop and the name-check procedure (T05)** are prose in the
  `pir-coordinate` skill; the attestation the worker writes (T04) is prose in `pir-verify`.

### 3.2 Modules touched

- `src/core/naming.mjs` — add a coordinator-name validator; owns name build/parse. (T03)
- `src/shell/platform.mjs` — `spawnArgv` gains the permission-mode flag. (T01)
- `src/shell/loop.mjs` / `src/shell/coordinate.mjs` — parse the verify report's attestation, emit
  the `verified Txx` completion signal and write the attestation to the surfaced feed. (T02)
- `skills/pir-verify/SKILL.md` — write the attestation into the `done` report. (T04)
- `skills/pir-coordinate/SKILL.md` — the guardrails (§2.3, §2.4), the receipt loop (§2.5), the
  startup name check (§2.7), and reading the `verified` signal (§2.1). (T05)
- `docs/*.md` — reflect all of the above as current behaviour. (T06)

### 3.3 The attestation shape

The verify worker's `done` report is a `[pir:v1 …]` message today (the header format
`platform.mjs` parses). The attestation rides in that report as two named confirmations the
engine can parse without guessing:

```
machine: <what an automated check decided, or "none"> 
person:  <what the person judged>
```

The engine parses these into the completion signal's text and never merges the two lines. A
report that carries a `done` but no parseable attestation still completes the task (the person's
say-so through the worker is the authority), but the coordinator's signal then says the
attestation was absent, so a missing attestation is visible rather than silently treated as
present. Reason: the signal's whole value is being real evidence; a fabricated-looking blank is
worse than an honest "attestation not recorded".

The exact delimiter and field names are the implementing session's to finalise against the
existing `[pir:v1]` format; what DESIGN fixes is that there are two separate, named confirmations
and that the engine never rounds them together.

### 3.4 Data flow (the completion signal)

```
person + verify worker  →  done report with `machine:`/`person:` lines  →  reports/ (T04)
bin drains the report   →  parses the attestation, phase = done         →  loop.mjs (T02)
you-task merges         →  flow log `verified Txx`, feed carries text    →  coordinate.mjs (T02)
coordinator reads it    →  reports the verified completion, does NOT halt →  pir-coordinate (T05)
```

### 3.5 Storage

No new persistent state. The completion signal reuses the existing transient control folder: the
flow log (`plans/{slug}/.parallel/control/log`) and the surfaced feed
(`plans/{slug}/.parallel/control/surfaced`), both already gitignored and both already the
coordinator's read surface (`/docs/control-folder.md`). Nothing here rides the feature branch to
`main`.

---

## 4. Testing

Three layers, and what each proves:

- **The pure core** (`src/core/*.test.mjs`) proves the name validator: a `/` name is invalid, a
  correct `·` name for this repo/plan is valid, a worker name or a foreign name is rejected with
  the right reason. Exhaustive and instant.
- **The shell** (`src/shell/*.test.mjs`) proves argv and signal construction without a live
  process: `spawnArgv` carries the permission flag; a crafted verify `done` report is parsed into
  the two confirmations and produces the `verified Txx` line and the feed text; a report with no
  attestation still completes and marks the signal absent.
- **A person, with live sessions**, proves what no test can reach: that a worker in the chosen
  permission mode actually accepts a message with no approval prompt (T00, T07); that a
  hand-driven task's completion signal reaches the coordinator and it does not halt (T07); that a
  down-send's receipt is observable (T00, T07); that a slashed coordinator name is caught at
  startup (T07). These are §5.1 rows, verified with the user and written into `FINDINGS.md`.

None of the layers can prove the live cross-session behaviour; that is exactly why T00 and T07
exist and are `you` tasks.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (darwin) |
| Language / runtime | Node.js, ES modules (`"type": "module"`) |
| Toolchain | `node --test` (built-in test runner); `git`; the `claude` CLI for live sessions |
| **Deliberately absent** | No third-party test framework, no build step, no bundler. The engine is plain `.mjs` run directly. |

**The test command.**

```
npm test
```

which is `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`. It is
the only evidence a session may produce on its own. It is already quiet (the `dot` reporter, one
line of dots per file, full detail only on failure), already colour-off (`FORCE_COLOR=0
NO_COLOR=1` inside the command, not trusted to the caller), and loud on failure (a failing
assertion prints its message, file and line; exit code non-zero). To see per-test detail while
debugging, swap `--test-reporter=dot` for `--test-reporter=spec` on the command line; do not
commit that change.

Development happens in this repo (`src/`, `skills/`, `docs/`). `./install.sh` deploys `src/` to
`~/.claude/pir-engine/src/` and `skills/` to `~/.claude/skills/`; `/pir-coordinate` and the live
workers run from the **installed** copies. So any task whose change must be exercised live (T07)
runs `./install.sh` first, and any hand-verification is against the installed engine, not the repo
working tree. Reason: the repo copy is the source; the installed copy is what a real run executes,
and the two only match after an install.

**Dependencies.** No new runtime dependencies. The changes are to argv, string parsing, flow-log
emission and prose. Do not add a library for any of it.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A `--bg` worker accepts a cross-session message with no approval prompt | Needs two real `claude` sessions and a person watching whether the worker prompts (T00). |
| The sender observes a delivery/receipt notice it can key on | Only visible in a live cross-session exchange (T00). |
| A hand-driven task's `verified` signal reaches the coordinator and it does not halt | Needs a live coordinator + a live verify worker + the person driving the task (T07). |
| A slashed coordinator name is caught at startup | The name check reads the live session's own name, which only exists in a real session (T07). |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| Scratch plan for the capstone drill | A throwaway plan, not a real product plan | The live drill runs a tiny plan whose only job is to exercise the flow; nothing real is at risk. |
| `PARALLEL_MAX_WORKERS=1` for the first live exercise | ceiling 1 | The drill runs at ceiling 1 so a bug cannot fan out workers (inherited from `/docs`, the live-drive seatbelt). |
| Guaranteed teardown of the drill's worktrees/branches | The `you` task tears its scratch run down and confirms it is down before marking done | A live run leaves worktrees and branches; the seatbelt is that the task removes them and confirms, so a drill cannot silently leave a half-run behind. |

Never ask the user to run an unbounded multi-worker live run to find something out, and never run
one yourself. The spike (T00) and the capstone (T07) are the only live exercises, both bounded.

---

## 6. Recovery

Nothing here can lock anyone out. The changes touch a dispatcher and its messages, not a
credential or a device. The one live artefact a drill leaves — scratch worktrees and branches — is
torn down by the `you` task itself (§5.2) and, if a drill is interrupted, is cleaned up the same
way any parallel run's leftovers are (`/docs/restart-recovery.md`): remove the worktrees with
`git worktree remove` and delete the `pir/{scratch-plan}*` branches. `main` is never touched by a
drill.

---

## 7. Decisions and rationale

- **Real signal over guardrails-only (user, 2026-09-17).** The coordinator's instructions already
  told it not to treat the quiet hands-on stretch as a stall, and it ignored them and halted. So
  the fix is not more instruction alone; it is to remove the silence the coordinator misread, with
  a machine-emitted completion signal (§2.1), and keep the guardrails as well. The alternative,
  prose-only, was rejected because it leans on the model obeying a rule it had just broken.
- **Full hardening pass over the narrow fix (user, 2026-09-17).** The run surfaced three faults
  from one cause — the coordinator's blind, unverified view of its workers: the fraud misread, the
  fire-and-forget down-send, and the off-convention name. They are one theme ("make the
  coordinator's view of its workers trustworthy") and are fixed together rather than split across
  plans, because a half-fixed coordinator is as untrustworthy as an unfixed one.
- **The kill switch stays a skill rule, not an engine lock (§2.4).** The `HALT` file is a plain
  file and the engine cannot tell who wrote it; a lock would be theatre. The real fix is that no
  instruction leads the coordinator to create it. Chosen over trying to make the engine
  distinguish a coordinator's `touch` from a user's, which it cannot.
- **The attestation reuses the existing report and feeds (§2.1, §3.2).** A finished verify task
  already drops a report the bin drains, and the flow log and surfaced feed are already the
  coordinator's read surface. Adding a new channel was rejected as rebuilding what exists; the
  signal is an extension of all three.
- **The exact permission flag is a spike, not a guess (§2.6, T00).** `claude --help` lists
  `--permission-mode bypassPermissions` and `--dangerously-skip-permissions`, but whether either
  also auto-accepts cross-session message *delivery* (a separate gate from tool permissions) is
  not in the help text. Guessing wrong changes the spawn argv and the receipt-loop wording, so it
  is load-bearing enough to be T00.

## 8. Explicitly out of scope

- **A general fraud detector for `auto` tasks.** This plan does not add machinery to catch a
  worker fabricating a result. The `you`-task case is not fraud detection — it is supplying the
  evidence a legitimate hand-driven task already produced. An `auto` worker's honesty is governed
  by the existing "what you may not claim" rule (`/docs`, the skills), and inventing a heuristic
  auditor is exactly the instinct that caused this failure. Out, deliberately.
- **A resume/replay of the run that failed.** The user asked to forget that run; this plan fixes
  the framework, it does not recover `my-ender/print-vision`. That run's cleanup is a separate,
  optional act (CLAUDE.md: folding a halted run back is the user's call).
- **A pause/resume of the kill switch.** The kill switch stays all-or-nothing (`/docs`); adding a
  pause is a different feature and not what this failure calls for.
- **Reworking the up-channel (worker → coordinator).** The file-drop up-channel (T25) worked; this
  plan only hardens the down-channel and the coordinator's reading of the flow log. Leaving the
  up-channel alone keeps the change contained.
