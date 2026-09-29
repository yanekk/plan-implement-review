# The coordinator agent

A build run can have a **coordinator agent**: one Claude session `pir` holds beside the workers, as
the person's stand-in. It sees every worker question and permission request before the person does,
and either answers it on the person's behalf or passes it on with a pointer. When every task is
done it writes the delivery report's sections and hands the person a feature branch that merges
into `main` cleanly. It never merges into `main` and never pushes.

Naming: "the coordinator agent" is this session. "The coordinator" alone is still the command
(`src/shell/coordinate.mjs`), a plain program that runs the build. The agent is not a relay: a
question it will not decide stays with the worker that asked it, and the person answers that worker
directly, as in a run without the agent ([human-flow.md](human-flow.md)).

Code: `src/shell/coordinator-agent.mjs` (the session, its gate, the decision drain, the ledger),
`src/core/coordinator-policy.mjs` (the rulebook and the decision checks),
`src/core/coordinator-brief.mjs` (every message the command sends it),
`src/core/coordinator-report.mjs` (`REPORT.md`), the routing and the end sequence in `coordinate.mjs`,
and the base definition `skills/pir-coordinator/SKILL.md`. Build-time rationale:
`plans/pir-coordinator/DESIGN.md`.

## One agent per build run, on by default

Every build run started from `pir` (`pir start {slug}`, the go after `pir plan`, a resume) has one,
unless it was started with **`pir start {slug} --no-coordinator`**. That flag reaches the command as
`PARALLEL_COORDINATOR=0` and runs the build exactly as it ran before the agent existed. The choice is
kept in the run's index record (`coordinator: false`, written only when off; absent reads as on), and
a resume from the dashboard (`Ctrl+R Ctrl+R`) passes it on. `pir start {slug}` typed again on a
stopped run takes the flag as typed. A run started by hand with `node src/shell/coordinate.mjs`
has the agent unless `PARALLEL_COORDINATOR=0` is set. The test harness runs its scenarios with the agent
off unless a scenario says `coordinator: true`.

Planning runs (`pir plan`) and classic `/pir-work` sessions have no agent: their questions are about
what to build, which is the person's.

The agent is started on the first pass that has the feature worktree open, with that worktree as its
working directory. If it fails to start, the run carries on without it and every waiting item is the
person's; the run's `log` says `coordinator agent failed to start`. Its session is named
`{repo} / {slug} / coordinator agent`.

## Its two layers of rules, and the plan

1. **The base definition**, the `pir-coordinator` skill, installed by `./install.sh` with the other
   skills. It is not user-invocable; the agent's opening instruction engages it. It says how to judge,
   what the agent may decide, when to pass on, the exact decision-file shapes and how to write the
   report.
2. **The project's rules**, `.claude/pir-coordinator.md`, if the file exists in the feature worktree.
   Free prose the person edits ("never approve anything touching payments"). It is read from the
   feature branch, so it must be committed on `main` before the run starts; a project without one runs
   on the base alone. It covers every plan in that repo.

The person's own instructions in the agent's conversation win over both, for the rest of the run
("don't approve new tasks tonight"). The project file wins over the skill. None of the three can make a
reserved item the agent's (below).

On top of these the agent reads the run's plan from the feature worktree, where it is current:
`DESIGN.md`, `PLAN.md`, `PROGRESS.md`, `FINDINGS.md` and the task doc a brief is about. The skill tells
it to re-read these rather than rely on its context, which Claude Code compacts over a long run.

## What the agent can do: decide, and nothing else

The agent cannot run a command or edit a file. Its only write is a decision file in its drop folder;
the command applies every decision after checking it. Three fences hold it (measured on Claude Code
2.1.283 by T00 of `pir-coordinator`):

- **A tool allowlist**: `Read`, `Glob`, `Grep`, `Write`, `Skill`. Every other built-in tool is absent
  from its session. A deny list alone did not hold: `EnterWorktree`, `CronCreate` and `ListAgents` ran
  without reaching the permission handler.
- **`permissionMode: 'default'`**, so every tool call reaches the command's gate, except `Read`,
  `Glob` and `Grep` inside its working directory and `Skill` for a skill that declares no
  `allowed-tools`, which Claude Code runs unasked. Those only read.
- **The gate** (`gateFor` in `coordinator-agent.mjs`). It allows `Read`, `Glob` and `Grep` under the
  repo, its worktrees and the installed skills (`~/.claude/skills`); `Skill` for `pir-coordinator`
  only; and `Write` only to a path inside `control/coordinator/decisions/`. Paths are compared as
  real paths, and a glob with `..` after a wildcard is denied. Everything else is denied at once,
  logged `decided-by-gate` in its conversation, and never parked for the person. MCP connector tools
  stay listed but reach the gate, which denies them. `disallowedTools` (Bash, Edit, NotebookEdit,
  WebFetch, WebSearch, Task, Agent) is a further fence.

It never widens what a worker may do. It sees only what already reaches the person; what auto mode or
an allow rule lets a worker run without asking is unchanged.

## Answer first

Each pass the command lists the **waiting items** (`waitingItems` in `src/core/asking.mjs`, the same
predicate as the `asking` row, see [human-flow.md](human-flow.md#when-a-row-reads-asking-you)):

| Waiting item | The brief carries | The agent answers with |
|---|---|---|
| A permission request | worker, task, tool, input, the worker's reason, request id | `permission`: allow or deny |
| A question set (AskUserQuestion) | the questions and options, request id | `answers` |
| A report park (a `question` or `decision` report whose asking turn has ended) | the report text and the worker's last words | `message`: text sent to the worker |

An item is **briefed** to the agent, as a user message in its session, on the first pass it waits.
From then it is **held by the agent** until it is answered or passed on. The row reads
`asking coordinator · a question` or `asking coordinator · allow a command?`, in the working (cyan)
style; it is not counted in the run's asking tally, the footer does not point at it, the runs list
does not turn amber for it, and the worker's Remote Control stays off. The task's clock stops, as for
`asking you`.

The agent answers by writing one decision file. The command checks it (`readDecision`,
`checkDecision`) and applies it through the same calls the person's answers use, marked
`from: 'coordinator'`: `platform.answer` for a permission or a question set, `platform.send` for a
message. A worker cannot tell the agent's answer from the person's. A `message` un-parks a report park
exactly as the person's message does (`resumeAnswered` in `loop.mjs` counts a coordinator send as an
answer). A `deny` carries the agent's reason to the worker.

**The first answer wins, and the agent is told who and what.** The person may answer any item at any
time, in `pir` or on the phone, held or not. Every item the agent was briefed on, reserved ones included,
that stops waiting without a decision of the agent's is reported to it once, on the pass the command
sees it gone: who closed it and the answer, read from the worker's conversation log
(`closingAnswer` in `src/shell/coordinator-agent.mjs`, worded by `closedWhy` in
`src/core/coordinator-brief.mjs`):

| How it closed | The agent is told |
|---|---|
| The person answered in `pir` | "Already answered by the person:" `allowed`, `denied (message)`, the chosen answers, or the quoted message |
| The person answered on the phone | "Already answered by the person on the phone (Remote Control):" the answer when the log shows it (a permission whose tool ran is `allowed`; a question set's result names the answers; a typed reply only when the CLI replayed it), else "the answer was not recorded" |
| A standing permission covered it | "Already allowed by a standing permission the person gave earlier: allowed" |
| The worker exited, was interrupted or restarted | "Closed with no answer: the worker exited before anyone answered" (never "answered by the person") |
| Nothing in the log says | "No longer waiting; pir did not record who closed it or the answer" |

A decision the agent then writes for that item is refused with the same words, not the generic
"nothing is waiting from worker … (unknown worker, or already answered)", which stays for a worker that
never had an item. An item the agent passed on (a `pass`, or a `permission` for a reserved item, which
is passed on with its note) is not reported when the person later answers it: the pass was the agent's
decision. A pass refused because the item was already closed is not a decision, and the item is
reported. The skill tells the agent to correct its own pointer in one line if it had sent the person to
answer the item, and otherwise to say nothing, and never to guess who answered. The row, the tally and
Remote Control do not change for any of this.

**Who gets which item:**

- A reserved item (next section) is briefed so the agent can add a note, but it is the person's from
  the start: the row reads `asking you` and Remote Control comes on.
- An item that first waits while the agent is down (restarting, given up) is the person's for good; it
  is not briefed later.
- When the agent dies, every item it holds becomes the person's at once. A dead agent never leaves a
  worker waiting on it.

**The hold limit.** An item the agent holds for 5 minutes without a decision becomes the person's, as
if the agent had passed it on: the row reads `asking you`, it counts in the `asking you` tally and the
footer points at it, the runs list turns amber, and the worker's Remote Control comes on. The limit is
counted from the pass that briefed and held the item, on the pass's own clock, and
`PARALLEL_COORDINATOR_HOLD_MS` overrides it (a positive number of milliseconds; the live check and the
tests shorten it). The command tells the agent in one message, starting "Handed to the person", and the
agent answers it with its pointer, as for a pass. `control.log` gets `coordinator-timeout <task>` and
the ledger a `timeout` line (the item, `heldForMs`), never notable. A timed-out item that keeps waiting
is not held again; a new park by the same worker is a new item, briefed afresh. Reserved items have no
limit: they are the person's from the start. With phone alerts set up, the timeout is when the person's
phone is alerted, the message opening `Agent didn't answer in time: `; a reserved item alerts at once,
opening `Needs your yes: `. A question the agent answers in time never alerts.

**A late answer still counts while the person has not answered.** A `permission`, `answers` or
`message` from the agent for a timed-out item is applied like any decision, its ledger line carrying
`late: true`; the row goes back to working and Remote Control goes off. A late `pass` changes nothing on
screen and is ledgered `late: true`, and the person's later answer to that item is not reported. If the
person answered first, the agent is told who answered and what, as above, and its decision is refused.

## What always goes to the person

Two kinds of item are **reserved**, whatever the agent's rules say (`reservedFor` in
`coordinator-policy.mjs`). The command enforces this, not the agent: a `permission` decision for a
reserved item is refused and the item passed on with the agent's text as its note.

- **An `ask`-bin action.** A permission request matching a `permissions.ask` rule in the feature
  worktree's `.claude/settings.json` (where `/pir-review-plan` writes the plan's `§5.3` bins), matched
  with the same matcher "do not ask again" grants use. A compound Bash command is split on `&&`, `||`,
  `;`, `|` and newlines, `$()` and backtick bodies are read too, and the request is reserved if any
  part matches. A request carrying the SDK's `matchedAskRule` or `defaultToNo` is reserved as well.
- **A destructive command.** A Bash command matching the destructive list (`DESTRUCTIVE` in
  `coordinator-policy.mjs`): `rm` with `-r` or `-f` (or `--recursive`, `--force`), `git push` with
  `--force`, `-f`, `--force-with-lease` or a `+refspec`, `git reset --hard`, `git clean -f`,
  `git branch -D` (or a forced `-d`), `git checkout --` or `git checkout .`, any `git restore`,
  `git rebase`, `git filter-branch`, `DROP TABLE`, `DROP DATABASE` or `TRUNCATE` in any case, `mkfs`,
  `dd of=`. The list errs toward the
  person: a false positive costs one question.

## What the agent may decide

Beyond routine answers, the agent may, on the person's behalf:

- approve a worker **adding a task** to the plan (the worker proposes it in a report park; the agent's
  `message` says yes or no);
- **settle a question the design leaves open**;
- **approve going against a design rule** when the worker makes the case.

The skill tells it to mark each of these `notable`, and they are listed in the report. `CLAUDE.md`
names the agent as the person's stand-in for these in a parallel run.

## Passing on

When the agent will not decide, it writes a `pass` decision with a reason and a suggestion, and in the
same turn **says the pointer to the person in its own reply**: which worker and task is asking, why it
held back, and what it would pick. The pointer is the agent's reply, not a line pir writes, because
pir's notes never enter a Claude session and the agent's reply is what the phone shows.

The command then marks the item as the person's: the row reads `asking you`, and the worker's Remote
Control comes on, so the worker is reachable from the phone only from that moment. The question stays
where the worker asked it; the person opens the worker, in `pir` or on the phone, and answers there.
Once answered, the worker's Remote Control goes off again, as for any worker
([human-flow.md](human-flow.md#answering-away-from-the-terminal--remote-control)).
With phone alerts set up, the pass also sends the person an ntfy alert opening `Agent passed it on: `,
whose tap opens the worker's chat, not the agent's
([human-flow.md](human-flow.md#phone-alerts--pir-notify)).

## The agent's own conversation

The agent is one more conversation in the run. In the build's live view it has a **row of its own**,
pinned below the tasks under a separator line and above any end-of-run helper row:

```
  ✔ T01  config-loader          merged                   4:00
  ⠋ T02  api-routes             building                 2:00
  ────────────────────────────────────────────────────────────────
  ◆ coordinator agent           holding 1 question
  ⠋ main-sync resolve-main-merge working                 0:03
```

The row says what the agent is doing: `on duty` (up, holding nothing), `holding N question(s)` (N counts
every waiting item it holds: questions, question sets, permission requests, report parks), `restarting`
(down, not yet given up; a resume starts at once, so this is rarely seen), or `given up · questions
come to you` in the idle style ([When the agent fails](#when-the-agent-fails)). It has
no clock, is never amber, and is not counted in `n/m done`, running, waiting or the `asking you` tally.
It appears once the agent has started and stays to the end of the run, `ready to merge` included; with
`--no-coordinator` there is neither separator nor row. `↑↓` steps over the separator onto it and `→` (or
Enter, or a click on the row) opens its conversation; **`c`** opens the same conversation from any row, and the watch footer
names `c` only when the run has an agent. The state comes from the agent's `view().state`, the count
from the command's `held` map (`agentView()` in `coordinate.mjs`, carried in `runState.coordinator`). The person may type to
it there: ask where things stand, why it answered something, or give it an instruction for the rest
of the run. Typing reaches it through the same `inbox/` as a worker's input. Its pointers and its
hand-off appear in this conversation.

Its Remote Control is on for its whole session, so the person can reach it from claude.ai or the
Claude app all run, unless the run was started with `PARALLEL_REMOTE=0`. With phone alerts set up when it
starts, its session is started with the Claude app's push silenced (`CLAUDE_CLIENT_PRESENCE_FILE`), as a
build worker's is, so its pointers do not push a second time.

## Decision files

Every decision is one JSON file the agent writes with its `Write` tool into
`plans/{slug}/.parallel/control/coordinator/decisions/` (named `<epoch>-<rand>.json`). The shapes are
in the skill: `permission`, `answers`, `message`, `pass`, `report`, `close`. Each pass the command
drains the folder in name order and deletes each file it reads:

- A file that does not parse is left for one more pass, since the agent's `Write` has no rename and
  may still be landing; if it still fails it is refused.
- A file with the wrong shape, an unknown worker or request, an answer to an item already answered, or
  a second decision for an item answered earlier in the same drain is refused. The agent is told why
  in one message and nothing is guessed.
- A `message` to a worker that has exited is refused with that reason.
- A `close` is refused unless the run waits in `ready to merge` (below).

Why files and not custom tools: custom SDK tools need `zod` and `@modelcontextprotocol/sdk` as new
packages; the drop folder reuses the pattern workers already use for reports.

## The ledger

The command, not the agent, keeps `plans/{slug}/.parallel/control/coordinator/ledger.jsonl`: one line
per applied decision (`answers`, `permission`, `message`, `pass`) with the item, the answer, the
agent's reason and its `notable` flag, and `late: true` on a decision for an item the hold limit had
already handed to the person. The hold limit adds one `timeout` line per item it hands over, with
`heldForMs`, never notable. Every task adopted into the plan at merge while the agent was
alive is written as a notable `adopt` line, since only the agent or the person can have approved it.
The ledger is durable across a pir restart. A torn last line is skipped on read, and the next append
starts a fresh line after it.

## The end of the run

With the agent on, the run no longer ends at the green end gate. After every task is `✅` and the
feature-branch tests have run, the command takes one step per pass, so the live view stays live:

0. **Red gate: one test-fix worker.** If the end gate's tests are red, a **test-fix worker** is spawned
   in the feature worktree first (task label `tests-fix`, role `fix`) with the tests-red prompt
   (`buildConflictPrompt` kind `tests-red`: the gate's reason and log path, fix only the cause, run the
   test block, commit, report `done`, or `question` if it cannot). Its questions route through the agent
   like any worker's. On its `done` (or exit) it is closed and the tests rerun; then the sync below.
1. **Merge `main` into the feature branch**, in the feature worktree (`syncMain` in `worktree.mjs`;
   commit `sync main into pir/{slug}`). Up to date: nothing to do. Merged cleanly: the tests run again.
   Conflicted: a **main-sync worker** is spawned in the feature worktree with the main-sync conflict
   prompt (`buildConflictPrompt` kind `main-sync`); it finishes the merge keeping both sides' intent,
   runs the test block, commits and reports `done`, and the tests run again. Its questions route
   through the agent like any worker's. If it reports done without finishing the merge, or exits, the
   merge is aborted so the branch is clean, and the branch is marked not ready. The person's own
   checkout of `main` is never written. If the tests rerun after a clean or resolved merge are red and
   no test-fix worker has run in this end sequence, one is spawned now, as in step 0. **One attempt per
   end sequence**, whichever fires first: still red after it, the run ends red. A re-sync while waiting
   in `ready to merge` is a new sequence and gets its own attempt; an unresolved sync gets none, since
   that branch is already not ready. A restart mid-fix finds the feature worktree kept with whatever the
   first worker left, the gate is rerun, and a fresh test-fix worker is spawned if it is still red.
2. **Brief the agent** with the run's facts: the task table, the ledger, the `FINDINGS.md` rows, the
   tasks whose `PROGRESS.md` row says `unverified`, the sync result, the tests result, and whether a
   test-fix worker ran and whether it made the tests green.
3. **The agent writes a `report` decision** with three markdown sections: what was delivered and what
   was not, what to check by hand, risks and follow-ups.
4. **The command assembles and commits `plans/{slug}/REPORT.md`** on the feature branch (`report({slug}):
   delivery report`), in this order: what was delivered, **Decisions made for you**, what to check by
   hand, risks and follow-ups, and a `## Branch` footer (the `main` commit it was synced against, when,
   whether a test-fix worker fixed the tests or left them red, and the tests result). The decisions section is rendered by the command from the ledger's notable
   lines and adoptions, not written by the agent, so no decision can drop out of it. The report reaches
   `main` with the person's merge.
5. **Hand-off.** The command sends the agent the report and `git merge pir/{slug}`, or, on red, the
   reason no merge is offered; the agent presents them to the person in its reply. The run then waits.

### Ready to merge

The live view's footer reads `✔ ready to merge · git merge pir/{slug}` with `report:
plans/{slug}/REPORT.md` under it, and the dashboard lists the run as `● ready to merge` in amber,
counted in `waiting for you`. A red branch (the tests still fail after the test-fix worker's attempt, or the main sync could not be
resolved)
gets `✗ not ready · tests red on pir/{slug} — no merge offered` with the reason; the report is still
written and says so, and the run waits the same way. While it prepares, the footer reads `all N
task(s) merged · preparing: syncing main, writing the report`. With phone alerts set up, the first pass
that reads ready or red sends one alert (`{slug} · ready to merge` or `{slug} · not ready`) whose tap
opens the agent's chat; it is not repeated when `main` moves
([human-flow.md](human-flow.md#phone-alerts--pir-notify)).

**The helpers' rows.** While a test-fix or main-sync worker runs, it has a row below the agent's row (and so below the tasks), keyed by
its label: `tests-fix  fix-red-tests` or `main-sync  resolve-main-merge` (`runState.helpers`, built by
`buildRunState` from `state.tasks`). It reads like a task's row, `working` (then `finishing` once it has
reported), `asking coordinator` or `asking you`, with its clock stopped while it asks. It is not counted in
`n/m done`, running or waiting; it is counted in the `asking you` tally and takes the `asking you`
footer, so the runs list reads `asking you` for it. `↑↓` reaches it and `→` opens its conversation, so a
question the agent passes on from it is answered in `pir` like a task's, or on the phone. The row goes
when the worker is closed.

The run stays open, its agent reachable in `pir` and on the phone, until:

- **the person merges**: the command sees `main` contains the feature tip (`git merge-base
  --is-ancestor pir/{slug} main`); or
- **the person tells the agent to close the run**: the agent writes `close`.

Either ends the run as `finished`, prints `✔ pir/{slug} is in main. The run is finished.` or
`✔ run closed.` with the merge line still offered, and closes the agent. A `close` asked for while the
run is still building is refused; the skill has the agent tell the person that stopping a run is the
dashboard's.

**`main` moving while it waits.** When `main` moves without containing the feature tip (the person
merged another run first), the command merges `main` in again as in step 1, rewrites only the report's
`## Branch` footer, commits it (`report({slug}): re-synced with main`), and tells the agent, which tells
the person in one line.

**Without the agent** (`--no-coordinator`) the end is the one described in
[run-lifecycle.md](run-lifecycle.md#end): no main sync, no report, the `git merge` line printed and the
run finished.

## When the agent fails

- **It exits or crashes.** Its session is resumed by its stored id (`coordinator/session.json`) after
  each of the first three exits within an hour, logged `coordinator-resuming`. A fourth exit within the
  hour gives it up for the rest of the run (`coordinator-given-up`), and that holds across a pir
  restart inside the hour. While it is down or given up, every waiting item goes to the person as with
  `--no-coordinator`.
- **Given up at the end.** The sync and the tests still run; `REPORT.md` holds a line saying the agent
  was not available to write its three sections, then the decisions section and the footer; the run
  enters `ready to merge` and the merge line shows in `pir` only. An agent that is only restarting is
  waited for.
- **pir restarts mid-run.** The agent's session is resumed by id and told it was restarted; the ledger
  is kept. Items pending at the restart are lost with their workers, which are respawned, and new items
  are briefed afresh.
- **pir restarts a run in `ready to merge`.** Reconciliation finds every task `✅`; the command finds
  `REPORT.md` committed, re-checks the sync, and returns to `ready to merge` without rewriting the
  report (only the footer, if `main` moved). If the person merged while pir was down, the run finishes
  as merged.
- **It is slow, or drops a brief.** Several briefs arriving together is the likely way the agent drops
  one. The hold limit ([Answer first](#answer-first)) hands any item held 5 minutes without a decision
  to the person, so a held item never waits unseen.
- **A misbehaving agent.** Stop the run and resume it with `pir start {slug} --no-coordinator`. Every
  decision it made is in the ledger, and it can never have touched `main`.

## Storage

All under the run's gitignored control folder ([control-folder.md](control-folder.md)):

| Path | What |
|---|---|
| `coordinator/decisions/*.json` | the agent's decision files; consumed and deleted, and cleared at every startup like `reports/` |
| `coordinator/ledger.jsonl` | one line per applied decision and adoption; durable |
| `coordinator/session.json` | `{ sessionId, restarts }`; durable, for the resume and the give-up count |
| `conversations/coordinator-{n}.ndjson` | the agent's conversation; a resumed session continues its file |

`REPORT.md` is committed on the feature branch.

## Known limitations

- **The agent's session is not in `workers.json`.** A coordinator that is SIGKILLed leaves the agent
  running, and the reap that ends orphaned workers does not find it. A stop, `HALT` and teardown close
  it.
- **The `ask` bin rests on the settings match.** Claude Code 2.1.283 sent no `matchedAskRule` in the
  T00 probes, and the worker's permission log does not record it, so an `ask` action is recognised by
  matching the feature worktree's `.claude/settings.json`, read once when the agent starts. A rule kept
  only in `.claude/settings.local.json` or the user's own settings is not seen.
- **Auto mode's own approvals are invisible.** What auto mode or an allow rule runs without a prompt
  never reaches the agent or the person (T00 saw `rm -rf` and `git reset --hard` run unasked in auto
  mode).
- **A red hand-off lists as `running`** on the dashboard; only a ready one has its own list state.
