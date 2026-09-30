# The finisher

A build run with the coordinator agent on no longer ends at `ready to merge`. When the branch is
ready, `pir` closes the coordinator agent and starts the **finisher**: one more Claude session it
holds, which reads the project's finishing rules, prepares every step without running any of it, asks
the person one fixed question, and after their `Go` carries the steps out: the merge into `main`, and
whatever the project does after a merge (an install, a check). The run then ends. The person never has
to leave `pir` or their phone to finish a build.

The go is the person's and only the person's. The coordinator agent cannot give it, the finisher cannot
give it to itself, and `pir` recognises it only as the person's answer to that one question. Everything
before the go is looking; everything after it is doing. `pir` enforces the difference in code: the
finisher's phase is held by `pir`, not by the session, and every tool call is judged against it.

Code: `src/shell/finisher-agent.mjs` (the session, its fence and gate, the status drain, go detection,
the ledger, `state.json`, resume), `src/core/finisher-policy.mjs` (phases, the gate verdict, the
look-only list, status shapes, go recognition, the rules-file choice), `src/core/finisher-brief.mjs`
(every message `pir` sends it), the hand-over and the end in `coordinate.mjs` (`handOver`,
`finisherWaiting`, `fallBack`, `finish`), the alerts in `src/core/notify.mjs`, the row in
`src/core/display.mjs`, and the base definition `skills/pir-finisher/SKILL.md`. Build-time rationale:
`plans/finisher/DESIGN.md`.

## When it comes in

On a build run with the coordinator agent on, when the end sequence settles `ready` (green tests, `main`
merged into the feature branch, `REPORT.md` committed; [coordinator-agent.md](coordinator-agent.md#the-end-of-the-run)),
the agent is told the report is committed and that the finisher takes over, with no merge line
(`handoffFor` with `finisher: true` in `coordinator-brief.mjs`). On the next pass `pir` closes the agent
and starts the finisher (`handOver` in `coordinate.mjs`, from the `waiting` step of `endPass`). The
agent's row is gone from then on; its ledger, report and conversation file stay as they are.

- A run that settles **red** ends as it does without the finisher: `✗ not ready`, no merge offered, the
  run waits. The finisher only ever sees a ready branch.
- A run started with **`--no-coordinator`** has no finisher either: the `git merge` line is printed and
  the run finishes ([run-lifecycle.md](run-lifecycle.md#end)).
- A coordinator agent that **gave up** before the end does not stop the finisher: it needs the branch and
  the rules, not the agent. The factory exists whenever the run was started with the agent on
  (`startFinisher` in the bin is `null` only when `startAgent` is).

The finisher's session is named `{repo} / {slug} / finisher`, runs in the feature worktree, in
`permissionMode: 'default'`, and its Remote Control is on for its whole session (unless
`PARALLEL_REMOTE=0`), since everything it asks is the person's.

## The rules file

The finisher follows exactly one rules file, the first that exists of (`chooseRules` in
`finisher-policy.mjs`):

| # | Path | Source | In the person's words |
|---|---|---|---|
| 1 | `{feature worktree}/.pir/rules/on-finish.md` | `project` | project rules |
| 2 | `~/.pir/{repo}/rules/on-finish.md` | `yours` | your rules |
| 3 | `~/.pir/default/rules/on-finish.md` | `default` | default rules |
| – | `{engine}/rules/default/on-finish.md` | `built-in` | default rules |

`{repo}` is the basename of the repo's root, the name `pir` uses in session names. The project file is
read from the feature worktree, where `main` has just been merged in, so a rules file committed on `main`
is seen. Only one file is used, so the person can always say which rules ran: the file and its source
are in the finisher's opening instruction (`finisherOpening`), in its ready summary, and in `control.log`
(`finisher rules: <path> (<source>)`).

`install.sh` copies the engine's `rules/` next to its `src/`, and seeds
`~/.pir/default/rules/on-finish.md` from `rules/default/on-finish.md` only when that file does not
exist, so the person's edits survive a reinstall. The fourth row is the fallback when none of the three
exists (install never ran here, or the default was deleted); the opening instruction then tells the
finisher to say so in its ready summary. The default rules merge `pir/{slug}` into `main` in the
person's main checkout and confirm `main` then contains the branch tip; nothing else, no push, no pull
request.

The rules are free prose, like `.claude/pir-coordinator.md`. The finisher turns them into concrete
steps; `pir` does not parse them. This repository's own `.pir/rules/on-finish.md` merges, runs
`./install.sh`, and diffs the installed engine and skills against the merged `src/` and `skills/`.

## Phases

The finisher is always in one phase, held by `pir` in `control/finisher/state.json` (`PHASES` in
`finisher-policy.mjs`):

| Phase | Meaning | What `pir` lets it do |
|---|---|---|
| `preparing` | started, looking | look only |
| `awaiting-go` | wrote its `ready` status and asked the go question | look only |
| `finishing` | the person said `Go` | act, except what is reserved for the person |
| `stuck` | a step failed, or it restarted mid-finish; wrote `stuck` and asks the go question again | look only |
| `done` | wrote `done` | nothing; the run ends |

`preparing → awaiting-go` and `finishing → stuck` happen when the finisher writes the matching status
file (`checkStatus`). `awaiting-go → finishing` and `stuck → finishing` happen only on the person's go.
Falling back to look-only on `stuck` is what makes "waits for a new go" a rule `pir` enforces rather
than one the finisher is trusted with.

## The fence

The finisher needs Bash, and a person's settings may pre-approve commands such as `Bash(git merge:*)`.
In `permissionMode: 'default'` an allow rule answers a tool call before the permission handler is asked,
so a gate behind the handler alone would never see those commands. The fence therefore has two layers
(measured by `plans/finisher` T00 on Claude Code 2.1.284):

- **A `PreToolUse` hook** (`FINISHER_HOOKS`, `ASK_EVERY_CALL` in `finisher-agent.mjs`) that answers
  `ask` for every tool call, in every phase. It runs before the settings' rules and sends every call on
  to the gate, allow-ruled ones included. It reads nothing the finisher wrote, and never returns `{}`,
  which would fall through to the settings.
- **The gate**, `decide` in `finisher-agent.mjs`, behind `canUseTool`: `finisherVerdict(phase, …)`
  answers `allow`, `deny` or `person` (park it for the person).

The session's tool list is `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`, `Skill` and
`AskUserQuestion` (`FINISHER_TOOLS`), least privilege: no web, no sub-agents, no worktree or cron tools.

### Before the go: look, don't touch

In `preparing`, `awaiting-go` and `stuck` the gate allows:

- `Read`, `Glob` and `Grep` under the repo, its worktrees, the person's main checkout, the installed
  skills (`~/.claude/skills`), the installed engine (`~/.claude/pir-engine`) and `~/.pir/`; `Write`
  only into `control/finisher/status/`; `Skill` for `pir-finisher` only. These are the coordinator
  agent's path checks (`gateFor` in `coordinator-agent.mjs`, with the finisher's skill and roots);
- `Bash` only when the whole command is look-only (`isLookOnly` over `LOOK_ONLY`): `git status`,
  `git log`, `git diff`, `git show`, `git rev-parse`, `git merge-base`, `git merge-tree`, `git branch`
  with no argument but `--list`, `-a`, `-v`, `--show-current` or `--contains`, `git remote -v`,
  `git worktree list`, `git ls-files`, `git ls-tree`, `git cat-file`, `ls`, `cat`, `head`, `tail`, `wc`,
  `grep`, `diff`, `cmp`, `shasum`, `test`, `[`, `which`, `command -v`, `pwd`, `echo`, `node --version`,
  `npm --version`, `gh auth status`, `gh pr list`, `gh pr view`, and `cd <path>`. A `git` command may
  carry leading `-C <path>` pairs (the finisher looks at the person's main checkout from the feature
  worktree); any other git global option, `--output` and `--ext-diff` are refused. Refused outright: any
  output redirection (`>`, `>>`, `2>&1`), process substitution, a `NAME=value` prefix, a `$(…)` or
  backtick body that is not itself look-only, a nested one, and in a `git` part any shell expansion
  (`$X`, `${…}`, `$'…'`, `{a,b}`), since its value could carry a git option that writes;
- `AskUserQuestion`, always parked for the person.

Everything else is denied at once with a message naming what the phase allows
(`finisherGateRefusal`), logged `decided-by-gate` in its conversation, and never parked. The list is an
allowlist: a missing harmless command costs the finisher one denied call and a line in its summary.
`git merge-tree --write-tree` writes objects to the object store but moves no ref and touches no working
tree; it is how the finisher answers "would the merge conflict" without merging.

### After the go: free within the task

In `finishing` the gate allows every tool, except that a request reserved for the person is parked for
them (`reservedFor` in `coordinator-policy.mjs`, as for the coordinator agent):

- a destructive command (`DESTRUCTIVE`, [coordinator-agent.md](coordinator-agent.md#what-always-goes-to-the-person));
- an `ask`-bin action, matched against the feature worktree's `.claude/settings.json`;
- a request Claude Code itself flags `defaultToNo`.

The coordinator agent is closed by then, so a parked request is the person's from the start: the row
reads `asking you` and the phone is alerted. A refusal is the finisher's to turn into a `stuck`.

## The go

After writing a `ready` or `stuck` status the finisher asks the person with `AskUserQuestion`: one
question, header exactly `Go`, options `Go` and `Not yet`, the question naming the rules file and the
number of steps. `pir` parks it like any worker question, answered in `pir`'s conversation view (`c`) or
on the phone over Remote Control.

`pir` moves the phase to `finishing` only when all of these hold (`isGoAnswer` in `finisher-policy.mjs`,
the scan in `finisher-agent.mjs`):

- the phase is `awaiting-go` or `stuck`;
- the answered request is an `AskUserQuestion` whose single question has header `Go`, and the chosen
  answer is exactly `Go`;
- the answer came from the person: `pir`'s own reply from the conversation view (logged `from:
  'person'`), or an `answered-remotely` request whose tool result names `"…"="Go"` (the phone);
- the question was first seen after the latest accepted `ready` or `stuck`, the latest re-sync and the
  latest restart, so a `Go` never approves steps it was not asked about;
- `main` is not being re-synced into the branch at that moment.

A `Go` that does not count (asked in `preparing`, before the steps it would approve, or during a
re-sync) is recorded `stale-go` and the finisher is told it opened nothing (`finisherStaleGo`); it
writes a fresh `ready` and asks again. `Not yet`, a typed answer or anything else
is recorded `not-yet` and changes nothing; the question's result tells the finisher. A chat message is
never the go: a message typed on the phone does not reliably reach `pir`'s stream, so `pir` could not
enforce it. The skill tells the finisher to re-ask the question when the person wants to go.

The finisher acts on its `Go` the moment its question returns, often before `pir`'s next pass. So the
gate runs the same drain itself before judging any call in `awaiting-go` or `stuck`: its first step, the
merge, is judged in `finishing`, not refused on a stale phase.

## Status files

The finisher reports its state by writing one JSON file with its `Write` tool into
`control/finisher/status/` (`<epoch>-<rand>.json`). Each pass `pir` drains the folder in name order and
deletes each file it reads (`drain` in `finisher-agent.mjs`). A file that does not parse is left one more
pass, since `Write` has no rename, then refused. Shapes (`readStatus`):

```
{ "kind": "ready", "rules": "<rules file used>", "summary": "<what it checked, what it found>", "steps": ["<exact command>", ...] }
{ "kind": "stuck", "summary": "<what failed, what is done, what is not>", "proposal": "<retry | fix | undo>", "steps": ["<commands for the next go>", ...] }
{ "kind": "done", "summary": "<what it did>" }
{ "kind": "close", "reason": "<the person's words>" }
```

| Kind | Accepted in | Phase after |
|---|---|---|
| `ready` | `preparing`, `awaiting-go` (a re-prepared plan of steps replaces the last) | `awaiting-go` |
| `stuck` | `finishing`, `awaiting-go` | `stuck` |
| `done` | `finishing` only | `done` |
| `close` | any | unchanged; the run ends |

A status with the wrong shape, or refused for its phase, is answered with one message naming why
(`finisherRefusal`), and nothing changes. `ready` and `stuck` carry the exact steps so the person reads
what the go approves.

## The end of the run

Each pass with the finisher on, `finisherWaiting` in `coordinate.mjs`:

- **`done`**: the run ends as `finished` (`by: 'finisher'`), prints `✔ finished: {first line of the
  summary}` and the report path, and closes the finisher. The live view's stale note then reads `The
  finisher is done.` instead of offering a merge.
- **`close`** (the finisher passing on the person's "don't finish, close the run"): the run ends as
  `finished` (`by: 'closed'`), prints `✔ run closed.` with the merge line still offered.
- **The person merges by hand** before any go: the same watch as the plain wait (`watchBase`: the local
  base every pass, the remote's copy every 5 minutes) sees the base hold the tip and ends the run as
  `merged` and closes the finisher. Once any go has been given (`goGiven` in `state.json`) it no longer
  ends the run, in any phase: the finisher's own merge makes it true, and a `stuck` after that merge (the
  install failed) must still reach the person. After a go the run ends only on `done` or `close`.
- **The base moves before any go** (in `preparing`, `awaiting-go`, or `stuck` before any go; another run
  merged, locally or on the remote): on the pass `pir` sees it, the finisher drops to `preparing` and no go counts
  (`resyncing()`); `pir` re-syncs the branch as it does without the finisher
  ([coordinator-agent.md](coordinator-agent.md#ready-to-merge)), and once that settles tells the finisher
  in one message to re-check and write a fresh `ready` (`resynced()`, `finisherResynced`). If the branch
  is red after that re-sync, the finisher is closed and the run waits red as a red run does today; it is
  not handed over again (user, 2026-09-29).
- **HALT, a stop from the dashboard, or a `pir` teardown** close the finisher like the agent
  (`closeFinisher`, `closeAll`).

After a go, the finisher's own merge moves `main`, so no re-sync is done.

## When it fails

- **It exits or crashes.** Its session is resumed by its stored id (`control/finisher/session.json`)
  after each of the first three exits within an hour, as the coordinator agent's is
  (`finisher-resuming` in its conversation). The phase is kept, except `finishing`, which drops to
  `stuck` with the summary "the finisher restarted mid-finish; it will check what is already done"
  (`afterRestart`), so a go is never carried over unseen work. An open go question dies with the process;
  the resumed brief (`finisherResumed`) tells it to ask again.
- **It gives up** (a fourth exit within the hour, `finisher-given-up`) **or fails to start**
  (`finisher failed to start: …` in `control.log`): the run falls back to today's `ready to merge` wait
  (`fallBack`), printing once `✗ the finisher could not go on; nothing more will run for you.` with
  `git switch {base} && git merge pir/{slug}` to run by hand. The footer and the dashboard read `ready to merge` again, and the
  run ends when the person merges.
- **`pir` restarts.** A stored `control/finisher/state.json` means the run had reached the finisher:
  the coordinator agent is not started (`coordinator agent not started: the finisher is resumed`), and
  the finisher is resumed by id at the hand-over and told it was restarted. `finishing` becomes `stuck`
  as above. A restart after the finisher's own merge (`goGiven`) does not end the run as `merged`; one
  that died between `done` and the run's end ends it at once. If `main` moved while `pir` was down, the
  re-sync's result voids the old steps as above.
- **The person's main checkout is dirty or not on `main`.** The finisher says so in its ready summary,
  with the steps it would still need; it never stashes, switches or cleans. Whether to go is the
  person's; a merge onto a dirty checkout fails safely in git, and that is a `stuck`.
- **A step fails after the go.** The finisher stops, writes `stuck` with what is done and a proposal
  (retry, a fix, or an undo), asks the go question again, and waits in look-only.
- **Two runs finish at once in one repo.** Each has its own finisher. When the first merges, the second
  sees `main` move and goes back to `preparing`.

## Phone alerts

With `pir notify` set up, the finisher alerts the person's phone (`finisherAlert` and
`finisherNotifyView` in `notify.mjs`, driven by the episode machine `notifyStep`, keyed `finisher`):

| When | Title | Message | Reminder |
|---|---|---|---|
| phase enters `awaiting-go` | `{slug} · ready for your go` | `{n} step(s) from {project rules \| your rules \| default rules}: ` + the first step | one after 15 min if still waiting |
| phase enters `stuck` | `{slug} · finisher stuck` | the stuck summary, cut to 150 characters | one after 15 min if still stuck |
| a request parks in another phase (a reserved action after the go) | `{slug} · finisher` | worded as for workers (`Needs your yes: …`) | as for workers |
| `done` | `{slug} · finished` | the done summary, cut to 150 characters | none |
| it gave up | `{slug} · finisher gave up` | `Merge by hand: git switch {base} && git merge pir/{slug}` | none |

Each alert's tap opens the finisher's chat (its Remote Control link), sent once the link is known or
after 20 s without one; the gave-up alert carries no link. The ready and stuck alerts are
cleared when the phase leaves them; `awaiting-go → stuck` is a new alert. The `{slug} · ready to merge`
end alert is not sent for a run the finisher takes over; a red run, a `--no-coordinator` run and a run
whose finisher failed to start still send today's end alert. See
[human-flow.md](human-flow.md#phone-alerts--pir-notify).

## On screen

In the build's live view the finisher's row takes the coordinator agent's pinned place below the
separator (`display.mjs`), with no clock:

| Row | When | Style |
|---|---|---|
| `◆ finisher  preparing` | looking | active |
| `◆ finisher  waiting for your go` | `awaiting-go` | amber, counted in `asking you` |
| `◆ finisher  finishing` | after the go | active |
| `◆ finisher  stuck · needs you` | `stuck` | amber, counted |
| `◆ finisher  asking you` | a request parked in `preparing` or `finishing` | amber, counted |
| `◆ finisher  done` | `done` | done |
| `◆ finisher  restarting` / `given up` | down | idle |

While the finisher is on it owns the footer, unless a task is asking: `◆ finisher preparing · c to
watch`, `◆ finisher ready · c to review and say go`, `◆ finisher finishing · c to watch`, `◆ finisher
stuck · c to review and say go`, `◆ finisher asking you · c to answer`. `c`, or `→`/Enter on its row,
opens its conversation, where the ready summary, the steps and the go question appear as its messages
and the person answers `Go` in the picker. The watch hint reads `c finisher`.

The dashboard lists the run as `● ready for your go` in amber, counted in `waiting for you`, while the
finisher waits for the go and no task is asking (`runDisplayState` in `dashboard.mjs`); `asking you`
while it is stuck or holding a request; `running` in its other phases. A run whose finisher gave up or
failed to start reads `ready to merge` again.

## The record

`pir` appends to `control/finisher/ledger.jsonl` one line per accepted status (`status`: kind, phase
before and after, summary, steps), per refused status (`refused`), per go (`go`, `by: 'person'` or
`'phone'`), per `Not yet` (`not-yet`), per stale go (`stale-go`), per re-sync (`resyncing`, `resync`),
per restart that changed the phase (`restart`) and one on giving up (`given-up`). It is durable across
restarts; a torn last line is skipped on read. `REPORT.md` is not rewritten: it describes the build, and
the finisher's work is in `main`'s history and this ledger. `control.log` gets `finisher rules: …`,
`finisher started` or `finisher resumed`, `finisher-fallback`, `finisher gave up`, and the `finished`
line.

## Storage

All under the run's gitignored control folder ([control-folder.md](control-folder.md)):

| Path | What |
|---|---|
| `finisher/status/*.json` | the finisher's status files; consumed and deleted each pass, and cleared at every startup |
| `finisher/state.json` | `{ phase, goGiven, rules, rulesSource, lastReady, summary, steps, proposal }`; written atomically, so a crash leaves the previous phase; unreadable reads as `preparing` |
| `finisher/session.json` | `{ sessionId, restarts }`, for the resume and the give-up count |
| `finisher/ledger.jsonl` | the record above; durable |
| `conversations/finisher-{n}.ndjson` | its conversation; a resumed session continues its file |

## Known limitations

- **The finisher is written for `main`.** Its skill, its messages and the default rules name `main` as
  the branch to merge into, whatever the run's base branch is. `pir` itself watches and re-syncs the
  run's base. In a repo whose base is another branch, merge by hand before the go (`git switch {base} &&
  git merge pir/{slug}`); the run sees it and ends.
- **A repo named `default`**, or matching another name `pir` keeps directly in `~/.pir/`, shares that
  folder with `pir`'s own files: `~/.pir/default/rules/on-finish.md` is then both the default and that
  repo's own rules. Accepted (user, 2026-09-29).
- **The fence was measured in `permissionMode: 'default'` only** (T00, Claude Code 2.1.284, SDK
  0.3.282), the mode the finisher uses. The hook was seen for every tool tried, including a `Bash` call
  made by a sub-agent; a future Claude Code that skipped the hook for some tool would open a gap.
- **Unquoted globs still expand** in a look-only command (`ls *`), to existing file names; only
  expansions in a `git` part are refused.
- **A `stuck` cannot be revised while stuck.** `stuck` and `ready` are refused in phase `stuck`, so a
  finisher restarted mid-finish that wants to list new steps can say them only in its reply, not in a
  status `pir` records. The go question it asks still opens `finishing`.
- **A re-prepared `ready` keeps the first alert's text**, so the 15-minute reminder may name the old step
  count. Only a re-sync (back to `preparing`) starts a new alert.
- **After a fallback, a `pir` restart starts no coordinator agent**: `finisher/state.json` stays. A red
  branch then waits without one. A green branch is handed over again (`handOver`): the finisher is
  resumed, and one that gave up within the last hour gives up again at once and the run falls back to
  `ready to merge`.
- **The finisher's session is not in `workers.json`**, like the coordinator agent's: a coordinator that
  is SIGKILLed leaves it running. Its `claude` process carries `--name '{repo} / {slug} / finisher'`,
  so `ps -ax -o pid,command | grep '/ finisher'` finds it for a `kill`.
- **A go question asked in the same pass as its `ready`**, just before it, still counts: statuses and
  the conversation are drained together.
