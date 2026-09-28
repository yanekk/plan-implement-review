---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# pir-coordinator — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T08 carries the resulting behaviour into `/docs`, `README.md` and `CLAUDE.md`. It never edits a
finished plan's DESIGN.md.

## 1. Purpose

A parallel build runs for hours, often overnight, and every worker question or permission request
waits for the person. Most of those questions are routine for someone who has read the plan: the
answer is in DESIGN.md, or the request is an ordinary command. The person wants a stand-in that
answers them while they are away, passes on only what it cannot or must not decide, and, when the
plan is built, hands them a report of what was delivered and a branch that merges cleanly.

This brings back an agentic coordinator in a different role from the one removed by
`non-agentic-coordinator`. That one was a relay: it carried a question up and an answer down and
exercised no judgement, so it cost a model and added nothing. This one is a stand-in: it answers on
the person's behalf, which is judgement, and it never relays. When it passes a question on, the person
answers the worker directly, as today. The other reason the old one went (a session idling for hours
inside a turn does not survive) no longer applies: pir now holds every session as a child process it
owns (`live-workers`), and the agent is held the same way.

### Success criteria

- In a real run, a worker's routine question or permission request is answered by the coordinator
  agent with no person involved, and the worker carries on.
- A destructive command or an `ask`-bin action is never approved by the agent. It always reaches the
  person, and the program enforces that in code rather than trusting the agent.
- A question the agent passes on becomes reachable on the person's phone only then. The agent's
  pointer (which worker, why it held back, what it would pick) sits in the agent's own conversation,
  and the person answers the worker directly.
- When every task is ✅, the run's branch has main merged in and its tests are green, `REPORT.md` is
  committed in the plan, and the run waits in `ready to merge` until the person closes it or merges.
- Seen live with the person in a fixture run (T09).

### Stance

- The agent stands in; it never relays. A question it will not decide stays with the worker that
  asked it, and the person answers there (user 2026-09-27).
- The agent only ever decides. The program applies every decision, after checking it. The agent
  cannot run a command or edit a file outside its own drop folder.
- Merging into main is the person's. The agent prepares the branch and hands it over (user 2026-09-27).

---

## 2. Behaviour specification

### 2.1 One agent per build run

Every build run `pir` starts (`pir start {slug}`, the go after `pir plan`, a resume) has one
coordinator agent, on by default. `pir start {slug} --no-coordinator` runs without one, which is
exactly today's behaviour. The choice is kept in the run's index record so a resume keeps it. Why on
by default: the person asked for a stand-in in every run and the answer-first rule (§2.3) gives the
same behaviour day and night, so there is no switch to forget at bedtime (user 2026-09-27).

Planning runs (`pir plan`) and classic `/pir-work` sessions get no agent. Their questions are about
what to build, which is the person's by definition.

In docs and code the new session is "the coordinator agent". "The coordinator" alone keeps meaning the
command (`coordinate.mjs`), which is unchanged in role.

### 2.2 The agent's definition

Two layers, read at the start of the agent's session (user 2026-09-27):

1. The base definition, the `pir-coordinator` skill (`skills/pir-coordinator/SKILL.md`), installed by
   `install.sh` like the other skills. It says how to judge, what it may decide, when to pass a
   question on, how to write a decision file, and how to write the report. It is `user-invocable:
   false`, engaged by the agent's opening instruction the way `pir-worker` is.
2. The project's rules, `.claude/pir-coordinator.md` in the target repo, if present. Free prose the
   person edits ("never approve anything touching payments"). A project without one runs on the base
   alone. It is committed with the project, not per plan, so the same rules cover every plan there.

On top of both it reads the run's own plan: `DESIGN.md`, `PLAN.md`, `PROGRESS.md`, `FINDINGS.md` and
the task docs, from the feature worktree, where they are current. Why the project layer and not per
plan: general rules would be repeated in every plan, and plans written before this feature would
have none.

### 2.3 Answer first

The agent sees every worker question and permission request before the person does, and answers it or
passes it on (user 2026-09-27). What it is briefed on:

| Waiting item | How the agent learns it | How it answers |
|---|---|---|
| Permission request | a brief with worker, task, tool, input, reason | `permission` decision: allow or deny |
| Question set (AskUserQuestion) | a brief with the questions and options | `answers` decision |
| Report-parked question (worker dropped `question`/`decision` and ended its turn) | a brief with the report text and the worker's last assistant text | `message` decision: text sent to the worker |

Each brief is a user message pushed into the agent's session by the command. Briefs are sent when the
item first becomes waiting, by the §2.1 predicate of `real-asking-state` (`waitingOn`), so an
unfinished asking turn is not briefed.

The agent answers by writing one JSON decision file into its drop folder (§3.5). The command checks
it (§2.4) and applies it through the same calls the person's answers use (`platform.answer`,
`platform.send`), marked `from: 'coordinator'`. A worker cannot tell the agent's answer from the
person's, and should not need to. A `message` from the coordinator un-parks a report park exactly like
a person's message.

The first answer wins. The person may answer any waiting item in `pir` or on the phone at any time; a
decision that arrives for an item already answered is dropped and the agent is told "already
answered by the person". Why not lock the person out while the agent thinks: the person is the
authority and must never wait on their own stand-in.

Why decision files and not custom tools: custom tools in the SDK need `zod` and
`@modelcontextprotocol/sdk` as new dependencies; the drop folder reuses the report pattern the
workers already use, with no new package (user 2026-09-27). The cost is a round trip of one watch
event instead of an instant tool result, which is irrelevant against a worker waiting minutes.

### 2.4 What always goes to the person

The agent may not answer these, whatever its rules say (user 2026-09-27):

1. An `ask`-bin action: a permission request carrying `matchedAskRule`, or one whose tool and input
   match a `permissions.ask` rule in the project's `.claude/settings.json` (the plan review writes the
   §5.3 bins there). Both checks, because `matchedAskRule` is only set when the rule forced the
   prompt, and T00 measures when that is.
2. A destructive command: a Bash command matching the destructive list (§3.3), or a request the CLI
   marked `defaultToNo`.

The command enforces this, not the agent. Such a request is never briefed as answerable: the brief says
"this one is the person's; add your note", and any `permission` decision for it is refused and the
request passed on with the agent's note. Why in code: a rule the model can argue itself out of is not
a rule, and these two are exactly the actions the person reserved.

The agent never widens what a worker may do. It only sees what already reaches the person today; what
auto mode or an allow rule lets through without a prompt is unchanged.

### 2.5 Passing a question on

When the agent will not decide, it writes a `pass` decision with a reason and a suggestion, and in the
same turn says the pointer to the person in its own reply: which worker and task has a question, why it
held back, what it would pick. The command then (user 2026-09-27):

1. switches on that worker's Remote Control, so it is reachable from the phone;
2. marks the item as passed, so the row reads `asking you`.

Why the agent's own reply and not a note pir writes: pir's notes are lines in pir's conversation log and
never enter the Claude session, which is what the phone shows (`platform.note`, checked at plan review
2026-09-27). The agent's reply is in both (user, plan review 2026-09-27).

The question itself stays where the worker asked it; nothing is copied or relayed. The person answers
in the worker's conversation, in `pir` or on the phone. Once the item is answered, the worker's Remote
Control is switched off again. Why the pointer lives in the agent's conversation: it is the first thing
the person sees on the phone, and the worker's conversation stays exactly as today.

The row reads `asking coordinator` while the agent holds an item and `asking you` once it is passed or
must go to the person. The task's clock stops for both, as it does today for `asking you`.

### 2.6 What the agent may decide

Beyond routine answers, the agent may approve a worker adding a task to the plan, settle a question the
design leaves open, and approve going against a design rule (user 2026-09-27: only §2.4 is reserved).
This changes two rules in `CLAUDE.md` (a new task needs the person's approval; never invent a rule),
which T08 amends to name the coordinator agent as the person's stand-in in a parallel run.

Every such decision is accounted for in the report (§2.7).

### 2.7 The ledger and the report's decisions section

The command, not the agent, keeps the ledger: one line per applied decision (`answer`, `permission`,
`message`, `pass`), with the item, the answer, the agent's reason, and a `notable` flag the agent sets
for anything beyond routine. Every task adopted into the plan at merge while the agent was on is
recorded as notable automatically, since only the agent or the person can have approved it.

The report's "Decisions made for you" section is rendered by the command from the ledger's notable
lines (question, answer, why), not written by the agent (user 2026-09-27). Why: a section the agent
writes from memory can omit a decision; one rendered from the ledger cannot.

### 2.8 The agent's own conversation

The agent is one more conversation in the run's `pir` screen, next to the workers (user 2026-09-27).
The person may ask it where things stand, give it an instruction for the rest of the run ("don't
approve new tasks tonight"), or ask why it answered something. Its pointers (§2.5) and its hand-off
(§2.9) appear there.

It has its own pinned row in the live view (user 2026-09-28, T12): below the tasks and a separator
line, above the end-of-run helpers, stating whether it is up, restarting or given up and how many
items it holds. Selected with ↑↓ and opened with →; `c` stays as a shortcut. With the agent off there
is no separator and no row.

Its Remote Control is on for the whole run, unless `PARALLEL_REMOTE=0` switches Remote Control off for
the run as today (user 2026-09-27).

### 2.9 End of run: prepare the branch, report, hand over

When every task is ✅ and the feature-branch tests pass (today's end gate), the command:

1. Merges the current `main` into the feature branch in the feature worktree. If it merges cleanly it
   reruns the tests. If it conflicts, it spawns a worker with the main-sync conflict prompt (§3.3) in
   the feature worktree; that worker resolves, runs the tests and reports `done`, and its questions
   route through the agent like any worker's (user 2026-09-27).
   Red tests get a fix worker the same way (T10, user 2026-09-27): if the end gate is red, before the
   sync, or the tests rerun after a clean or resolved sync are red, it spawns one worker in the feature
   worktree with the tests-red prompt (`buildConflictPrompt` kind `tests-red`, label `tests-fix`); it
   fixes the cause, runs the test block, commits and reports `done`, and the tests rerun. One attempt per
   end sequence, whichever fires first; a re-sync while in `ready to merge` gets one of its own; an
   `unresolved` sync gets none. Still red after it: the run ends red as below. Why: a red end otherwise
   sat as `running` waiting on the person (T07 drill), and a fix is ordinary worker work.
2. Briefs the agent with the run's facts: the task table, the ledger, open FINDINGS rows, tasks with a
   hand-verification half unchecked, the sync result, the tests, and whether a fix worker ran.
3. The agent drops a `report` decision holding the markdown for three sections: what was delivered
   (and what was not), what to check by hand, risks and follow-ups (user 2026-09-27).
4. The command assembles `plans/{slug}/REPORT.md` from the agent's sections, the rendered decisions
   section (§2.7) and a branch footer (main sha synced against, tests result), and commits it on the
   feature branch (`report({slug}): delivery report`). The report lands in main with the merge.
5. Sends the agent a message holding the report and `git merge pir/{slug}` (or, red, why no merge is
   offered), and the agent presents them to the person in its reply, for the same reason as the pointer
   (§2.5). The report file itself is pir's assembly, so no decision can drop out of it. The run enters
   `ready to merge`.

The agent never merges into main and never pushes (user 2026-09-27). If the tests are red, at the end
gate or after the sync, the report is still written, says so, and no merge is offered; the run waits
the same way.

### 2.10 Ready to merge, and the end

A run in `ready to merge` stays open, with its agent reachable in `pir` and on the phone, until
(user 2026-09-27):

- the person tells the agent to close the run (the agent drops `close`), or
- the command sees main contains the feature branch tip (`git merge-base --is-ancestor pir/{slug}
  main`), because the person merged.

Either ends the run as `finished`. A `close` before the run is in `ready to merge` is refused and the
agent told why; it tells the person the run is still building and that stopping is the dashboard's
(user, plan review 2026-09-27). Why: a loosely worded message must not end an overnight build, and
stopping a run stays in the person's hands. While it waits, if main moves without containing the feature tip,
the command re-syncs as in §2.9 step 1, updates the report's branch footer, commits, and the agent tells
the person. Why automatic: the promise of the hand-off is a merge that goes through cleanly, and the
person merging another run first is the ordinary way that promise breaks.

### 2.11 The unhappy paths

- The agent exits or crashes: the command resumes its session (stored session id) after each of the
  first three exits within an hour; a fourth exit within an hour gives it up for the rest of the run.
  While it is down, and once given up, every waiting item
  goes to the person exactly as with `--no-coordinator`, and a coordinator note says so. A dead agent
  never leaves a worker waiting on it.
- The agent is given up (§2.11 first bullet) when the end sequence needs its report, or while it waits
  for it: the command carries on without it (user, plan review 2026-09-27). The sync and tests run as in
  §2.9; `REPORT.md` holds the rendered decisions section and the branch footer, and one line in place of
  the three agent sections saying the coordinator agent was not available to write them; the run enters
  `ready to merge` and the merge line shows in `pir` only. An agent that is merely restarting is waited
  for. Why not today's plain end: the clean-merge promise matters most when something has gone wrong.
- The agent is slow: a hold limit of 5 minutes (user 2026-09-28, T13; `PARALLEL_COORDINATOR_HOLD_MS`).
  An item held that long without a decision becomes the person's as if passed on, and the agent is told.
  A late decision from the agent is still applied while the person has not answered: the first answer
  wins (user 2026-09-28). Why: the agent may drop one of several briefs that arrive together, and a held
  item never turns the run amber, so without a limit nobody is prompted. Replaces "no timeout".
- A decision file will not parse, names an unknown worker or request, or has the wrong shape: it is
  dropped and the agent is told why in one message. Nothing is guessed. A file that fails to parse is
  left for one more pass first, since the agent's Write may still be landing (§3.5).
- A decision for a reserved item (§2.4): refused, the item passed on with the agent's text as its note.
- The agent tries a tool outside its allowance (§3.4): denied by the command, logged.
- pir restarts mid-run: the agent's session is resumed by id; the ledger is durable in the control
  folder and not cleared at startup. Items that were pending are lost as today (the workers are
  respawned) and new ones are briefed afresh.
- pir restarts a run in `ready to merge`: reconciliation finds every task ✅ and `REPORT.md` committed;
  the command re-checks the sync and returns to `ready to merge` without rewriting the report.
- The main-sync conflict worker cannot resolve, or the tests stay red after the one test-fix worker
  (§2.9 step 1, user 2026-09-27): its question passes through the agent, which may pass it on; the
  report says the branch is not ready. A restart mid-fix keeps the feature worktree with what the worker
  left; the gate reruns and, still red, a fresh test-fix worker is spawned, as for main-sync.
- The main checkout has uncommitted changes: irrelevant, since the sync happens in the feature worktree
  and main is never written.
- The agent's context grows over a long run: Claude Code compacts it. The durable memory is the plan
  files and the ledger, which the agent re-reads, not its context.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: no clock, no fs, no network, no package import
src/shell/  everything platform-shaped
```

`src/core/boundary.test.mjs` enforces it. If that test fails the fix is to move the code, never to
relax the test. The rulebook (§2.4), decision checking, brief texts, the ledger fold and the report
assembly are pure, so every rule of §2 except the live session is tested in milliseconds.

### 3.2 Modules

| Module | Side | Task | Owns |
|---|---|---|---|
| `src/core/coordinator-policy.mjs` (new) | pure | T01 | `reservedFor(request, askRules)`, `DESTRUCTIVE`, `readDecision(obj)`, `checkDecision(decision, waiting)` |
| `src/core/coordinator-brief.mjs` (new) | pure | T03 | the text of every message the command sends the agent |
| `src/core/coordinator-report.mjs` (new) | pure | T05 | ledger fold, decisions section, branch footer, `assembleReport` |
| `src/core/asking.mjs` (from `real-asking-state`) | pure | T04 | `waitingOn` gains who holds the item: `coordinator` or `person` |
| `src/core/conflict.mjs` | pure | T05 | a `main-sync` prompt beside the task→feature one |
| `src/core/person-input.mjs` | pure | T01 | `ruleMatches` exported for the ask-rule match (reused, not copied) |
| `skills/pir-coordinator/SKILL.md` (new) | skill | T02 | the base definition |
| `src/shell/worker-proc.mjs` | shell | T03 | `startWorker` takes an optional `decide(toolName, input)` gate and extra SDK options |
| `src/shell/coordinator-agent.mjs` (new) | shell | T03 | start and resume the agent, its tool gate, the decision watch, apply or refuse, the ledger file, Remote Control on |
| `src/shell/coordinate.mjs`, `loop.mjs` | shell | T04, T05 | briefing per pass, routing and Remote Control, `from: 'coordinator'` un-park, the end sequence and `ready to merge` |
| `src/shell/worktree.mjs` | shell | T05 | `syncMain(featurePath)` |
| `src/shell/pir.mjs`, `launch.mjs`, `index-store.mjs` | shell | T04 | `--no-coordinator`, kept in the index record, passed on resume |
| `src/shell/pir-tui.mjs`, `src/core/display.mjs`, `dashboard.mjs` | both | T06 | the coordinator row and conversation, `asking coordinator`, `ready to merge` |
| `src/shell/harness/*` | shell | T04, T09 | fixtures default to no agent; a fixture may turn it on |

### 3.3 The rulebook

`reservedFor(request, askRules)` returns `null` or `{ kind: 'ask-rule' | 'destructive', why }`, from:

- `request.matchedAskRule` present, or `request.defaultToNo` true;
- a `permissions.ask` rule matching the request by `ruleMatches` (the matcher the grants use), the rule
  string parsed into `{ toolName, ruleContent }` first. `ruleMatches` refuses compound Bash commands,
  which is right for a grant and wrong here, so a compound command is split on `&&`, `||`, `;`, `|` and
  newlines and reserved if any part matches;
- for `Bash`, a command matching `DESTRUCTIVE`: `rm` with `-r`/`-f` flags, `git push` with
  `--force`/`-f`/`--force-with-lease`, `git reset --hard`, `git clean -f`, `git branch -D`,
  `git checkout --`/`git restore` on paths, `git rebase`, `git filter-branch`, `DROP TABLE`/`DROP
  DATABASE`/`TRUNCATE` in any case, `mkfs`, `dd of=`. The list errs toward the person; a false positive
  costs one question, a false negative costs the thing the person reserved.

`checkDecision(decision, waiting)` returns `{ ok: true, apply }` or `{ ok: false, why, passOn }`:
unknown worker or request, already answered, wrong shape for the item's kind, or a `permission` for a
reserved item (`passOn: true`).

The main-sync conflict prompt (`buildConflictPrompt({ kind: 'main-sync', … })`) tells a worker in the
feature worktree to finish the in-progress merge of `main` into `pir/{slug}`, keep both sides' intent,
run the test block, commit, and report `done`. It reuses the existing worker audience and test step.

### 3.4 The agent's session and its allowance

The agent is started through `startWorker` (`worker-proc.mjs`), like a worker, with cwd the feature
worktree and its conversation at `control/conversations/coordinator-{n}.ndjson`. Differences:

- `tools: ['Read', 'Glob', 'Grep', 'Write', 'Skill']`, an allowlist: every other built-in tool is absent
  from the session. Why (T00, user 2026-09-27): in `default` mode `EnterWorktree`, `CronCreate` and
  `ListAgents` ran without reaching `canUseTool`, so a deny list plus the gate did not hold; the
  allowlist was measured to hold. MCP connector tools stay listed but reach the gate, which denies them.
- `permissionMode: 'default'`, not `auto`, so no tool runs without passing the command's gate. Measured
  exceptions (T00): `Read`/`Glob`/`Grep` inside cwd, and `Skill` for a skill that declares no
  `allowed-tools`, run without reaching the gate. Both only read, so this stands; `pir-coordinator` must
  declare no `allowed-tools`.
- The gate (`decide`) allows `Read`, `Glob`, `Grep` under the repo, its worktrees and the installed
  skills, `Skill` for `pir-coordinator` only (its opening instruction invokes it), and `Write` only to a path inside `control/coordinator/decisions/`; it denies everything
  else, without parking a request for the person. `disallowedTools` names Bash, Edit, NotebookEdit,
  WebFetch, WebSearch, Task and Agent as a second fence.
- Remote Control on for the life of the session (§2.8).
- Its opening instruction: invoke the `pir-coordinator` skill for plan `{slug}`, the project rules path
  if the file exists, its drop folder path.

T00 measured this allowance on 2.1.283: with the allowlist, an absolute-path Write into the drop folder
reaches the gate and lands, a Write in cwd, a Read outside cwd, an MCP tool and a Skill declaring
`allowed-tools` reach the gate and are denied (fixture `coordinator-requests.json`, `gate`).

### 3.5 Storage

All under the run's control folder (`plans/{slug}/.parallel/control/`, gitignored):

| Path | What | Crash mid-write |
|---|---|---|
| `coordinator/decisions/*.json` | the agent's decision files, one per decision, consumed and deleted | written by the agent's Write tool, which has no rename (the agent has no Bash); a file that fails to parse is retried on the next pass and refused only if it still fails |
| `coordinator/ledger.jsonl` | one line per applied decision | one `appendFileSync` per line; a torn last line is skipped on read |
| `coordinator/session.json` | `{ sessionId, restarts: [iso…] }` | `writeJsonAtomic` |
| `conversations/coordinator-{n}.ndjson` | the agent's conversation; its pointers and hand-off are its own replies | as for workers |

`clearTransientFeeds` leaves `coordinator/` alone except `decisions/`, which is cleared at startup
like `reports/`.

`REPORT.md` is committed on the feature branch, so it survives everything the branch does.

### 3.6 Data flow per pass

`coordinator.pass()` → `platform.workers()` with activity → `waitingOn` per task names the waiting
items → items new since the last pass are checked by `reservedFor` and briefed to the agent (or, with
no live agent, left to the person) → decision files drained, `checkDecision`, applied or refused →
`remoteWanted` = workers with an item passed to or reserved for the person, plus the agent → Remote
Control synced.

---

## 4. Testing

`npm test` runs every `src/**/*.test.mjs` with the dot reporter and colour off (`FORCE_COLOR=0
NO_COLOR=1` in `package.json`; nothing here forces colour otherwise). A pass prints a few lines of dots
and exits 0; a failure prints its assertion and stack. Run one file with `node --test <file>` for
detail.

- Pure: the rulebook, decision checking, briefs, ledger and report assembly, `waitingOn` holders.
- Shell with fakes: `src/shell/fake/claude-stream.mjs` scripts the agent like any worker (it writes a
  decision file through a scripted tool call; T03 adds that step). Loop and coordinate tests drive a
  whole run through briefing, deciding, passing, the end sequence and `ready to merge` with the fake
  platform and the fake worktree.
- The screen: the existing pseudo-terminal rig (`src/shell/conversation-rig.mjs`, `plan-rig`) drives
  `pir` against a fake run; T06 extends it and T07 drills it.
- Live: the harness (`src/shell/harness/run.mjs`) runs a fixture plan with real workers and the real
  agent (T09).

## 5. Environment — read this before running anything

Measured 2026-09-27.

| | |
|---|---|
| OS | macOS (Darwin 25.5) |
| Runtime | Node v24.2.0 here; `engines` says >=22.19 |
| Claude Code | 2.1.283 |
| Packages | `@anthropic-ai/claude-agent-sdk` 0.3.282, `@earendil-works/pi-tui` 0.87.1 |
| Deliberately absent | `zod`, `@modelcontextprotocol/sdk` (the SDK's custom-tool peers; §2.3) |

`npm test` passes in a fresh detached worktree after the setup line and leaves it clean (measured
2026-09-27).

**Dependencies.** None added by this plan (user 2026-09-27). A task that finds it needs one stops and
asks.

**End to end.** The `pir` screen is driven by the existing pseudo-terminal rig in `npm test`
(`conversation-rig.mjs`, `plan-rig.mjs`) against the fake platform, at 80×24 and 120×40. No new rig.

**Installing.** Engine and skill changes are live only after `./install.sh` (CLAUDE.md). T02, T03,
T04, T05, T06 and T08 run it after their change, never while a parallel run is live.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| What the real CLI sends for an `ask`-rule and a destructive request, and whether the agent's allowance holds | Needs a real session (T00, `worker` bin) |
| The agent answering real workers, passing one on, and the hand-off in a real run | Paid run (T09, `worker` bin) |
| That a passed-on worker appears on the person's phone only then, and can be answered there | The person's phone (T09) |
| The real agent answering two briefs that arrive together, and the hold limit firing | Paid run (T14, `worker` bin) |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| `perl -e 'alarm 900; exec @ARGV'` around the T00 probe | The probe dies at 15 min |
| Scratch repo for T00 and T09 | Never the canonical checkout, never a real main |
| Harness fixture at ceiling 2, harness timeout 20 min (T09) | Bounded paid run |
| Harness fixture at ceiling 3, harness timeout 20 min, hold limit 60 s (T14) | Bounded paid run |
| `HALT` | Stops every worker and the agent of a run |
| The agent's gate (§3.4) | The agent cannot run a command or write outside its drop folder |
| `--no-coordinator` | A run with no agent, exactly today's behaviour |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Probe session (T00) | `perl -e 'alarm 900; exec @ARGV' node <probe script>` in a scratch repo | `worker` | Minutes of model time, scratch only | Kill the pid; delete scratch | under a dollar |
| Live harness run (T09) | `node src/shell/harness/run.mjs pir-coordinator --into <scratch>` | `worker` | Same bin earlier plans set for harness runs: bounded, scratch only | HALT; scratch deleted | a few dollars |
| Live harness run (T14) | `node src/shell/harness/run.mjs pir-coordinator-concurrent --into <scratch>` | `worker` | As T09 (user asked for it 2026-09-28) | HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine and skills | `worker` | Local, idempotent; never while a parallel run is live | Re-run from the previous commit | none |

The person's part in T09 is their phone. Nothing here pushes, deploys or merges into a real main.

## 6. Recovery

A run misbehaving because of the agent: stop it and resume with `--no-coordinator`
(`pir start {slug} --no-coordinator`); the run carries on exactly as before this plan. To back the
feature out, revert the task commits and run `./install.sh`. The agent can never have touched main,
and every decision it made is in `coordinator/ledger.jsonl`.

## 7. Decisions and rationale

All user decisions 2026-09-27 unless dated otherwise.

- **Name `pir-coordinator`** (user). "Coordinator agent" in prose, to keep "coordinator" for the command.
- **Builds on `real-asking-state`, which is built first** (user). It gives the `waitingOn` predicate
  the briefing keys on and the un-park rule `from: 'coordinator'` extends; building both at once would
  edit the same code twice. T00 checks it has landed.
- **Answer first, always, with a per-run off switch** (user). Rejected: an "I'm away" switch (forgotten
  at night) and answer-after-a-wait (workers idle, races with the person).
- **Base skill plus a per-project rules file** (user). Rejected: one global file (project rules mixed
  together) and per-plan rules (repeated, absent from older plans).
- **Only destructive commands and `ask`-bin actions are reserved** (user). The agent may approve new
  tasks and settle or override design questions; CLAUDE.md is amended (T08).
- **Notable decisions are listed in the report, not announced during the run** (user).
- **A pass carries a reason and a suggestion, in the agent's own conversation as a pointer; the worker
  becomes reachable on the phone only then; the agent never relays the question** (user, three
  points and a confirmation).
- **The agent's conversation is reachable in `pir` and on the phone all run** (user).
- **Pointer and hand-off are the agent's own replies, not pir notes** (user, plan review 2026-09-27):
  pir's notes never reach the session the phone shows.
- **The report lives in `pir` and as `plans/{slug}/REPORT.md` on the branch**, with four sections
  (user). The decisions section is rendered from the ledger (planner's choice, §2.7).
- **The agent does not merge into main or push; it pre-resolves conflicts by merging main into the
  feature branch** (user: "leave merging to me"; "pre-resolve").
- **The run stays open in `ready to merge` until closed or merged** (user).
- **Automatic re-sync when main moves while waiting** (planner, put to the user at the checkpoint, not
  overruled).
- **Decision files, no new packages** (user, after the question of why packages were needed at all).
- **Conflicts are resolved by a worker, not the agent.** Keeps the agent unable to edit files and
  reuses the conflict path workers already follow.
- **No prototype.** The agent's conversation reuses the existing conversation view; everything else it
  adds is text.
- **Extend `startWorker`, do not write a second session holder.** The agent is a session like any
  worker; a second holder would duplicate the log, the pid and the resume logic.

## 8. Explicitly out of scope

- A chat channel (Telegram, Slack), an always-on daemon, or goal intake from plain language: the
  Botty draft's shape, set aside by the person in favour of an agent inside the run.
- A quick-fix lane: runs are built from reviewed plans only.
- Merging into main, pushing, opening a PR: the person's (user 2026-09-27).
- An agent for planning runs or classic `/pir-work` sessions (§2.1).
- Notifying the person beyond Remote Control: the phone already notifies for a Remote Control session.
- Letting the agent edit code or run commands: the command applies its decisions; a worker resolves
  conflicts.
