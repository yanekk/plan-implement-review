---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# The finisher — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan.
T08 carries the resulting behaviour into a new `docs/finisher.md`, into `docs/coordinator-agent.md`
(its end of run), `docs/human-flow.md` (phone alerts), `docs/control-folder.md` and the README. It
never edits a finished plan's DESIGN.md.

## 1. Purpose

A build run with the coordinator agent ends today in `ready to merge`: the report is committed, the
agent presents `git merge pir/{slug}`, and the person leaves `pir` for a plain Claude session to do the
merge and whatever their project does after one (install, publish a PR). The finisher closes that gap.
It is one more Claude session `pir` holds: when the branch is ready, pir stops the coordinator agent
and starts the finisher, which reads the project's finishing rules, prepares every step without
running any of it, alerts the person's phone, and waits for their go. After the go it carries the
steps out and the run ends.

### Success criteria

- A green build run with the agent on ends, without the person leaving `pir` or the phone, with its
  branch merged into `main` and the project's after-merge steps done, after exactly one go from the
  person.
- Nothing that changes a file, a branch or the world runs before the go, whatever the person's
  Claude Code settings pre-approve. The fence is pir's code, not the finisher's good behaviour.
- A failed step leaves the run waiting on the person with a plain explanation and a phone alert, never
  half-finished and silent.
- This repository's own rules merge the plan, run `./install.sh` and confirm the installed copy.

### Stance

The go is the person's and only the person's. The coordinator agent cannot give it, the finisher
cannot give it to itself, and pir recognises it only as the person's answer to one fixed question.
Everything before it is looking; everything after it is doing.

---

## 2. Behaviour specification

### 2.1 When the finisher comes in

On a build run with the coordinator agent on, when the end sequence settles `ready` (green tests, main
synced, `REPORT.md` committed; `docs/coordinator-agent.md § The end of the run`), pir closes the
coordinator agent and starts the finisher on the next pass. A run that settles `red`, and a run started
with `--no-coordinator`, end exactly as they do today. The finisher only ever sees a branch that is
ready, so it never has to decide whether broken work ships (user, 2026-09-29). `--no-coordinator`
stays the agent-free escape hatch (user, 2026-09-29).

The coordinator agent is closed because its work ends with the report, and two agents in one
conversation slot would split the person's attention over who to talk to. The coordinator's ledger,
report and conversation file stay as they are; the finisher reads `REPORT.md`, not the agent.

If the coordinator agent was given up at the end (the report says so), the finisher still comes in:
it needs the branch and the rules, not the agent.

### 2.2 The rules file

The finisher follows exactly one rules file, the first that exists of (user, 2026-09-29):

1. `{feature worktree}/.pir/rules/on-finish.md`, the project's own, committed in the repo;
2. `~/.pir/{repo}/rules/on-finish.md`, the person's for this repo;
3. `~/.pir/default/rules/on-finish.md`, the default.

`{repo}` is `basename(repoRoot)`, the name pir already uses in session names and run index keys. The
project file is read from the feature worktree because `main` has just been merged into it, so it is
current. Only one file is used so the person can always say which rules ran; the file used is named
in the finisher's opening instruction, in its ready summary and in `control.log`.

`install.sh` copies `rules/default/on-finish.md` from this repository to
`~/.pir/default/rules/on-finish.md` only when that file does not exist, so the person's edits survive a
reinstall. If none of the three exists (install never ran, or the person deleted the default), the
finisher is started with the engine's own copy of the default, `{engine}/rules/default/on-finish.md`,
and says so in its ready summary. The default says: merge `pir/{slug}` into `main` in the person's
main checkout, and confirm `main` then contains the branch tip.

The rules are free prose, like `.claude/pir-coordinator.md`. The finisher turns them into concrete
steps; pir does not parse them.

This repository gets `.pir/rules/on-finish.md` (T03): merge `pir/{slug}` into `main`, run
`./install.sh`, and confirm the installed copy under `~/.claude/pir-engine/` matches the merged
`src/` and `skills/` (the `CLAUDE.md § A code change is not live until you install it` check).

### 2.3 Phases

The finisher is always in one of these phases, held by pir (not the session) in
`control/finisher/state.json`:

| Phase | Meaning | What pir lets it do |
|---|---|---|
| `preparing` | started, looking | look only (§2.4) |
| `awaiting-go` | wrote its ready status, asked the go question | look only |
| `finishing` | the person said go | act (§2.5) |
| `stuck` | a step failed or it cannot go on; wrote a stuck status and asked the go question again | look only |
| `done` | wrote its done status | nothing; pir ends the run |

`preparing → awaiting-go` and `finishing → stuck` happen when the finisher writes the matching status
file (§2.6). `awaiting-go → finishing` and `stuck → finishing` happen only when the person answers the
go question with `Go` (§2.7). Going back to look-only on `stuck` is what makes "waits for a new go" a
rule pir enforces rather than one the finisher is trusted with (user, 2026-09-29: stop, explain, ask).

### 2.4 Before the go: look, don't touch

In `preparing`, `awaiting-go` and `stuck` pir allows (user, 2026-09-29):

- `Read`, `Glob`, `Grep` anywhere under the repo, its worktrees, the installed skills, `~/.pir/` and
  `~/.claude/pir-engine/` (so it can compare an installed copy);
- `Bash` only when every part of the command is on the look-only list (`LOOK_ONLY` in
  `src/core/finisher-policy.mjs`): `git status`, `git log`, `git diff`, `git show`, `git rev-parse`,
  `git merge-base`, `git merge-tree`, `git branch` with no argument other than `--list`, `-a`, `-v`,
  `--show-current` or `--contains`, `git remote -v`, `git worktree list`, `git ls-files`, `git ls-tree`,
  `git cat-file`, `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `diff`, `cmp`, `shasum`, `test`, `[`,
  `which`, `command -v`, `pwd`, `echo`, `node --version`, `npm --version`, `gh auth status`,
  `gh pr list`, `gh pr view`. A command is split with `commandParts` from
  `coordinator-policy.mjs`; any redirection (`>`, `>>`, `tee`), any `$(...)` or backtick body that is
  not itself look-only, or any part off the list is denied;
- `Write` only into `control/finisher/status/`;
- `Skill` for `pir-finisher` only;
- `AskUserQuestion`, which is parked for the person (§2.7).

Everything else is denied at once by the gate with a message naming what it may do, logged
`decided-by-gate`, never parked. The list is an allowlist because a denylist of "things that change
state" cannot be complete; a missing harmless command costs the finisher one denied call and a line in
its summary, a missing harmful one would cost the fence.

`git merge-tree --write-tree` writes objects into the object store but moves no ref and touches no
working tree; it is on the list because it is how the finisher answers "would the merge conflict"
without merging (git 2.50.1 here).

### 2.5 After the go: free within the task

In `finishing` pir allows every tool (user, 2026-09-29: free within the task), except that a request
reserved for the person is parked for the person rather than allowed:

- a destructive command (`DESTRUCTIVE` in `coordinator-policy.mjs`, unchanged);
- an `ask`-bin action (`reservedFor(request, askRules)` against the feature worktree's
  `.claude/settings.json`, as for the coordinator agent).

A parked request is the person's from the start: the finisher's row reads `asking you`, its Remote
Control is already on, and the phone is alerted (§2.9). The coordinator agent is gone by then, so
nothing else can answer it.

The go approves the steps the finisher listed and the work they need; the fence after the go is the
reserved list only, and anything the finisher does is recorded in its conversation log.

### 2.6 Status files

The finisher reports its state by writing one JSON file into `control/finisher/status/`
(`<epoch>-<rand>.json`), the same drop-folder pattern as the coordinator agent's decisions, drained by
pir each pass in name order, each deleted once read. A file that does not parse is left one more pass
(the `Write` tool has no rename), then refused. Shapes (`readStatus` in `finisher-policy.mjs`):

```
{ "kind": "ready", "rules": "<path of the rules file used>", "summary": "<markdown: what it checked, what it found>",
  "steps": ["<exact command or action>", ...] }
{ "kind": "stuck", "summary": "<what failed, what is done, what is not>", "proposal": "<retry | fix | undo, in words>",
  "steps": ["<exact commands it would run on the next go>", ...] }
{ "kind": "done", "summary": "<what it did>" }
{ "kind": "close", "reason": "<the person's words>" }
```

Accepted in phase: `ready` in `preparing` or `awaiting-go` (a re-prepared plan of steps replaces the
last); `stuck` in `finishing` or `awaiting-go`; `done` in `finishing` only; `close` in any phase. A
status refused for its phase is answered with one message naming the phase, and nothing changes.

`ready` and `stuck` carry the exact steps so the person reads what the go approves, and so the summary
pir records (§2.10) can list them. `done` in `finishing` only, because a finisher that never had the go
has done nothing to report.

`close` is the finisher passing on the person's "don't finish, close the run": the run ends as
`finished` with nothing done, as the coordinator agent's `close` does today.

### 2.7 The go question

After writing a `ready` or `stuck` status, the finisher asks the person with `AskUserQuestion`, one
question, header exactly `Go`, options labelled exactly `Go` and `Not yet`, the question text naming
the rules file and the number of steps. pir parks it for the person like any worker question: answered
in `pir`'s conversation view or on the phone over Remote Control.

pir moves the phase to `finishing` only when all hold (`isGoAnswer` in `finisher-policy.mjs`):

- the phase is `awaiting-go` or `stuck`;
- the answered request is an `AskUserQuestion` whose single question has header `Go`;
- the chosen answer is exactly `Go`;
- the answer came from the person: pir's own reply from the conversation view, or an
  `answered-remotely` request whose tool result names `Go` (the phone path,
  `remoteAnswer`-style parsing of `"question"="Go"`, measured 2026-09-26).

`Not yet`, a typed reply, or anything else leaves the phase as it is; the finisher is told the answer
by the question result, as any worker is, and waits. The finisher's instructions say to ask again when
the person asks it to, and never to treat a chat message as the go: a message typed on the phone does
not reliably reach pir's stream (measured 2026-09-26; `docs/human-flow.md` § Remote Control), so pir
could not enforce it.

A go question asked in `preparing` (before a `ready` status) is parked like any question, and a `Go`
answer to it does not open the fence; the finisher's instructions say to write `ready` first.

### 2.8 The end of the run

- `done` status: pir records it, ends the run as `finished` (`by: 'finisher'`), prints `✔ finished:
  {first line of the summary}` and closes the finisher.
- `close` status: ends as `finished` (`by: 'closed'`) with the merge line still offered, as today.
- The person merges by hand while the finisher waits or works: the existing `mainContains` check
  still runs each pass. In `preparing`, `awaiting-go` or `stuck` it ends the run as `merged` and closes
  the finisher. In `finishing` it does not end the run, because the finisher's own merge is exactly what
  makes it true and its later steps (install) still have to run; the run ends on its `done`.
- `main` moving while the finisher is in `preparing`, `awaiting-go` or `stuck` (another run merged): pir
  re-syncs as today, rewrites the report footer, and tells the finisher in one message to re-check and
  write a fresh `ready`; the phase returns to `preparing`, so a go given for the old plan of steps no
  longer counts. In `finishing`, the finisher's own merge moves `main`, so no re-sync is done.
- HALT, a stop from the dashboard, or a pir teardown close the finisher like any worker.

### 2.9 Phone alerts

With `pir notify` set up (user, 2026-09-29: ready, stuck, done):

| When | Title | Message | Reminder |
|---|---|---|---|
| phase enters `awaiting-go` | `{slug} · ready for your go` | `{n} step(s) from {rules source}: ` + first step | one after 15 min if still `awaiting-go` |
| phase enters `stuck` | `{slug} · finisher stuck` | the stuck summary, cut to 150 characters | one after 15 min if still `stuck` |
| a reserved request parks in `finishing` | `{slug} · finisher` | `Needs your yes: wants to run …` (the existing permission wording) | as for workers |
| `done` | `{slug} · finished` | the done summary, cut to 150 characters | none |

`{rules source}` is `project rules`, `your rules` or `default rules`. Every alert's tap opens the
finisher's chat (its Remote Control link), sent once the link is known or after 20 s without one, as
for workers. The ready and stuck alerts are cleared when the phase leaves them. The existing
`{slug} · ready to merge` end alert is not sent for a run the finisher takes over, since the finisher's
ready alert replaces it; a red run and a `--no-coordinator` run still send today's end alert.

Alert states are episodes in the existing `notifyStep` machine (`src/core/notify.mjs`), keyed on the
finisher, so reminder, clear and retry behave exactly as for worker questions.

### 2.10 The record

pir appends to `control/finisher/ledger.jsonl`: one line per accepted status (kind, phase before and
after, summary, steps), one per go (`by: 'person'` or `'phone'`), one per `Not yet`. It is durable
across restarts. `REPORT.md` is not rewritten: it describes the build, and the finisher's work is in
`main`'s history and this ledger. The `done` summary is printed at the end and kept in `status.json`.

### 2.11 On screen

In the build's live view the finisher's row takes the coordinator agent's pinned place below the
separator, `◆ finisher` followed by its phase: `preparing`, `waiting for your go` (amber, counted in
the run's `asking you` tally, the footer pointing at `c`), `finishing`, `stuck · needs you` (amber,
counted), `asking you` (a reserved request), `done`. `c` and `→`/Enter on the row open its
conversation, where the ready summary, the steps and the go question appear as its messages. The
footer while it waits reads `◆ finisher ready · c to review and say go`. The dashboard lists such a
run as `● ready for your go` in amber, counted in `waiting for you`, replacing `● ready to merge`
for these runs. The coordinator agent's row is gone once it is closed.

The row is the only new surface; it reuses the conversation view unchanged, which is why no prototype
was built (user agreed, 2026-09-29).

### 2.12 The unhappy paths

- **The person's main checkout is dirty, or not on `main`.** The finisher's look finds it and says so
  in the ready summary, with the steps it would still need; it does not stash, switch or clean anything.
  Whether to go is the person's. A merge onto a dirty checkout fails safely in git, which then is a
  `stuck`.
- **A step fails after the go.** The finisher stops, writes `stuck` with what is done and a proposal
  (retry, a fix, or an undo), asks the go question again, and waits. pir returns it to look-only.
- **The finisher asks for a reserved action after the go.** Parked for the person, alerted; a denial is
  the finisher's to turn into a `stuck`.
- **The finisher exits or crashes.** Resumed by its stored session id (`control/finisher/session.json`)
  after each of the first three exits within an hour, as the coordinator agent is. The phase in
  `state.json` is kept, except `finishing`, which drops to `stuck` with a pir-written summary ("the
  finisher restarted mid-finish; it will check what is already done"), so a restart never carries a go
  over unseen work. A fourth exit gives it up: the run falls back to today's `ready to merge` wait,
  printing `git merge pir/{slug}`, and the person is alerted `{slug} · finisher gave up`.
- **pir restarts.** The finisher's session is resumed by id and told it was restarted. `finishing`
  becomes `stuck` as above (user, 2026-09-29: check what is done, ask for a fresh go on the rest).
  Other phases are kept; the go question, if it was open, is lost with the old process, so the finisher
  is told to ask it again.
- **The finisher fails to start.** Logged `finisher failed to start`; the run falls back to today's
  `ready to merge` wait.
- **Two runs finish at once in one repo.** Each has its own finisher. The second one's look sees `main`
  move when the first merges, and §2.8's re-sync sends it back to `preparing`.
- **A repo named `default` or `runs`**, or matching another name pir keeps in `~/.pir/`, shares that
  folder with pir's own files. Accepted as a known limit (user, 2026-09-29).
- **A rules file that asks for something the finisher cannot do** (a login it lacks). It says so in the
  ready summary; a login is a person step as anywhere in PIR.

---

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core/` is pure (no clock, fs, process or network), `src/shell/` touches the world.
`src/core/boundary.test.mjs` scans the pure side for forbidden imports; if it fails the fix is to move
the code, never to relax the test.

New pure modules: `finisher-policy.mjs` (phases, the gate verdict, the look-only classifier, go
recognition, status shapes, the rules-file choice given an `exists` function) and `finisher-brief.mjs`
(every message pir sends the finisher). The alert texts extend `notify.mjs`; the row extends
`display.mjs`.

### 3.2 Modules

- `src/core/finisher-policy.mjs` (T01): `LOOK_ONLY`, `isLookOnly(command)`, `finisherVerdict(...)`,
  `readStatus(obj)`, `checkStatus(status, phase)`, `nextPhase(phase, event)`, `isGoAnswer(...)`,
  `chooseRules(...)`. Reuses `commandParts`, `reservedFor` and `DESTRUCTIVE` from
  `coordinator-policy.mjs`.
- `src/core/finisher-brief.mjs` (T02): `finisherOpening`, `finisherResumed`, `finisherRefusal`,
  `finisherResynced`, `finisherStuckAfterRestart`, `finisherGateRefusal`.
- `skills/pir-finisher/SKILL.md` (T03): the finisher's base definition.
- `rules/default/on-finish.md` and `.pir/rules/on-finish.md` (T03).
- `src/shell/finisher-agent.mjs` (T04): the session, its gate, the status drain, go detection, the
  ledger, `state.json`, resume. Started through `worker-proc`'s `startWorker`, like the coordinator
  agent; shares `canonical`/`within` path helpers by importing them from `coordinator-agent.mjs`
  (exported there by T04), not by copying them.
- `src/shell/coordinate.mjs` (T05): the `waiting` step hands over to the finisher; phase-driven end.
- `src/core/notify.mjs` and the `runNotify` wiring in `coordinate.mjs` (T06): the finisher alerts.
- `src/core/display.mjs`, `src/shell/pir-tui.mjs`, `src/shell/list-view.mjs` (T07): the row, `c`, the
  runs list state.

### 3.3 The fence

The coordinator agent is fenced by having no Bash at all. The finisher needs Bash, and this machine's
`~/.claude/settings.json` and this repo's `.claude/settings.json` both allow `Bash(git merge:*)`, and
the repo also allows `Bash(./install.sh)`. In `permissionMode: 'default'` an allow rule answers a
request before `canUseTool` is called, so the `decide` gate alone would never see those commands.
The fence must therefore sit before the settings' rules. T00 measures which of these holds on Claude
Code 2.1.284 with SDK 0.3.282, and T04 builds on the answer:

1. an SDK `PreToolUse` hook callback, which runs for every tool call before permission rules and can
   return a deny (expected);
2. starting the session with `settingSources` that exclude `user` and `project` settings, keeping
   CLAUDE.md through another route;
3. `--settings` with a `permissions.deny` or a `defaultMode` that overrides the allows.

The fence has to hold for a command an allow rule covers; T00 proves it with `git merge` and an
allow rule, both in a scratch repo.

### 3.4 Data flow

```
coordinate.mjs endPass, step 'waiting', state 'ready', agent on
  → closeAgent(); startFinisher({ rulesPath, rulesSource, ... })           (T05)
finisher session ── Write status/*.json ──▶ finisher-agent.drain()         (T04)
                 ── AskUserQuestion (Go) ─▶ parked; person answers in pir or phone
                                             worker-proc log: reply | answered-remotely + tool_result
finisher-agent: phase in state.json, verdict per tool call from finisherVerdict(phase, …)
  → view(): { phase, summary, steps, ... } → runState.finisher → display / notify (T06, T07)
done | close | mainContains (not finishing) → finish(by) → run `finished`
```

### 3.5 Storage

Under the run's gitignored control folder:

| Path | What |
|---|---|
| `finisher/status/*.json` | the finisher's status files; consumed and deleted, cleared at startup |
| `finisher/state.json` | `{ phase, rules, rulesSource, lastReady }`; durable, atomic write |
| `finisher/session.json` | `{ sessionId, restarts }`; as the coordinator agent's |
| `finisher/ledger.jsonl` | one line per status, go and not-yet; torn last line skipped on read |
| `conversations/finisher-{n}.ndjson` | its conversation |

`state.json` is written with `writeJsonAtomic`, so a crash mid-write leaves the previous phase. A
phase lost entirely (file unreadable) reads as `preparing`, the safest phase.

---

## 4. Testing

- Pure: every phase × tool × input verdict, the look-only list including redirections and command
  substitution, status shapes, go recognition from both answer paths, rules choice (T01, T02).
- Shell with the fake SDK (`src/shell/fake/claude-stream.mjs`): the session starts fenced, drains
  status files, flips phase on a scripted go from pir and from a scripted `answered-remotely` +
  tool_result, resumes, gives up (T04); the end sequence hands over and ends the run for each of
  done/close/merged/give-up (T05); alerts (T06).
- The skill: a content test like `coordinator-skill.test.mjs` (T03).
- End to end: the conversation rig gains a `finisher` scenario; the drill drives it at 80×24 and
  120×40 (T07, T09).
- Live: a real finisher on a scratch repo (T10). No test can show the real phone go.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Language / runtime | Node v24.2.0 (package.json requires ≥22.19) |
| Toolchain | Claude Code 2.1.284; `@anthropic-ai/claude-agent-sdk` 0.3.282; git 2.50.1 |
| Deliberately absent | no TypeScript, no bundler, no test framework beyond `node --test` |

**The test command.** The `test` lines of the block at the top. `npm test` runs
`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: dots on pass, full
failure output, colour off inside the command because this terminal sets `COLORTERM=truecolor`. For
detail, run one file with `node --test --test-reporter=spec path/to/file.test.mjs`. The plan session
did not re-run the suite (user, 2026-09-29); the block is the one every recent plan uses.

**Setup.** `test ! -f package-lock.json || npm ci`, unchanged from the recent plans.

**Dependencies.** None added. The SDK's hook API is part of the installed SDK.

**End to end.** The conversation rig (`src/shell/conversation-rig.mjs`, scenarios `tour`, `long`,
`coordinator`) drives the real `pir` screen against the fake SDK. T07 adds a `finisher` scenario; no new
rig is planned.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The go answered on the phone reaching pir as a `Go` answer | Only the person's phone and account can answer over Remote Control (T10) |
| The ready/stuck/done alerts arriving on the phone and opening the finisher's chat | Only the person's phone shows them (T10) |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| Look-only fence (§2.4) | always | nothing changes before the go |
| Scratch repo for T00 and T10 | `/tmp/pir-finisher-*` | the spike's and the live check's merges land in a throwaway repo, never this one's `main` |
| `pir start {slug} --no-coordinator` | off | a run with no agents at all, finisher included |
| `PARALLEL_REMOTE=0` | off | no Remote Control; the go is then answered in `pir` only |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Real finisher session in the live check | `perl -e 'alarm 900; exec @ARGV' node src/shell/harness/run.mjs finisher-live --into /tmp/pir-finisher-live` | worker | draws plan limits only, no paid API; a scratch repo | delete `/tmp/pir-finisher-live` | one short session | `claude auth status` |
| ntfy alert during the live check | sent by pir itself | worker | the person's own topic, already set up | none needed | free | `pir notify test` |
| Refreshing the installed engine during the build | `./install.sh` | worker | already allowed; CLAUDE.md requires it after engine changes | re-run on the previous commit | free | none |

The finisher's own actions at runtime (merge, install, a PR) are not build actions of this plan; they
are the person's rules, fenced by §2.4–§2.5 and started by the person's go.

---

## 6. Recovery

- A finisher misbehaving: stop the run from the dashboard. Its ledger and conversation show what it
  ran. `main` can be reset by the person to the tip recorded in the report footer's `synced against`.
- A finisher that gave up: the run waits in today's `ready to merge`; `git merge pir/{slug}` by hand.
- To never get a finisher: start runs with `--no-coordinator`, or write a rules file that says to do
  nothing and report done.

---

## 7. Decisions and rationale

- **2026-09-29, user: automatic hand-over on green.** The finisher starts on its own once the branch is
  ready; merging by hand still works.
- **2026-09-29, user: look, don't touch before the go.** Checks that change nothing only; no dry runs,
  because each project would need a rehearsal version of every step.
- **2026-09-29, user: the go in chat, enforced by pir.** Realised as a fixed `AskUserQuestion` (§2.7)
  because a phone-typed chat message never reaches pir's stream, while a question's answer does.
- **2026-09-29, user: free within the task after the go**, with destructive and `ask`-bin actions still
  the person's. Chosen over "listed commands only".
- **2026-09-29, user: a failed step stops, explains, proposes, waits for a new go.** pir drops the
  phase to look-only so this is enforced.
- **2026-09-29, user: rules lookup repo, then `~/.pir/{repo}/rules/`, then `~/.pir/default/rules/`.**
  The user first chose "personal wins", then changed it to repo first and moved both home paths under
  `~/.pir/{name}/rules/`.
- **2026-09-29, user: no finisher on `--no-coordinator` runs, and none on red runs** (the red case taken
  as the stated default when the user skipped the question).
- **2026-09-29, user: alerts for ready, stuck and done, with one reminder.**
- **2026-09-29, user: this repo's rules live in the repo**, `.pir/rules/on-finish.md`.
- **Extend, not rebuild.** The session machinery is the coordinator agent's pattern through
  `startWorker`; the reserved-action checks are `coordinator-policy.mjs`'s; alerts are `notifyStep`
  episodes; the row is `display.mjs`'s agent row; the rig is the conversation rig. A separate module
  `finisher-agent.mjs` rather than a mode of `coordinator-agent.mjs`, because the two share start and
  resume but differ in gate, drop-folder shapes, phase and ending, and a mode flag through 680 lines
  would make both harder to review.
- **No prototype.** The only surface is a row and a footer in an existing view; the conversation view
  is unchanged.

---

## 8. Explicitly out of scope

- **Finishing without a build run** (a classic `/pir-work` plan, or a command to start a finisher by
  hand). The brief is about the run ending inside `pir`; a classic plan has no run to hold it.
- **A finisher for red runs.** The coordinator already reports them; fixing them is a build decision.
- **Parsing the rules file.** It is prose for a Claude session; a schema would be a second language.
- **Rewriting `REPORT.md` with the finish.** The report is the build's; the finish is in `main`'s history
  and the ledger.
- **Per-plan rules files.** Rules are per repo; a plan-specific step belongs in the plan's last task.
