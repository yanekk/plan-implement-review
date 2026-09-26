# plan-implement-review

A working method for Claude Code, packaged so it can be dropped into any project.

Work is planned once, read back once before anything is built, and then built by many Claude
sessions at once. Four ideas carry the whole method:

- **It runs in parallel.** `pir {slug}` builds every task whose dependencies are done at the same
  time, and shows you the whole run on one screen.
- **You set the autonomy.** Inside the code the agents work on their own; outside it they go only
  as far as you allowed, action by action.
- **Every step starts with a clean slate.** Each task is sized to fit one session, and each session
  is closed when its step is done, so no agent ever works from a long, stale conversation.
- **Nobody reviews their own work.** Every task is built by one session and reviewed by a
  different, brand-new one that never saw it being written.

You act as product manager: you own *what* gets built and why. The sessions own *how*.

## The workflow: plan, review the plan, run it

```
/pir-plan                  →  plans/{slug}/            a reviewed-ready plan, split into tasks
/pir-review-plan {slug}    →  plan marked reviewed      fresh eyes before a line is built
pir {slug}                 →  pir/{slug} branch, green  every task built and reviewed in parallel
git merge pir/{slug}       →  main                      the one step you run by hand
```

| Step | What it does |
|---|---|
| `/pir-plan` | Brainstorm the requirements, confirm the direction with a throwaway mock when the thing has a feel to it, probe the tech on the actual machine, survey what the codebase already does so nothing gets built twice, settle the architecture, split the work into session-sized tasks with their dependencies, write it all to `plans/{slug}/`. Writes no product code. |
| `/pir-review-plan {slug}` | Read the finished plan back with fresh eyes, before a line of it is built. Fixes what has one right answer, brings everything else to you as a decision, applies what you decide, marks the plan reviewed. Runs once. |
| `pir {slug}` | Run the reviewed plan in parallel, from a terminal inside the repo. Starts a coordinator in the background that builds every task whose dependencies are done, each in its own worker session, has a different worker review it, and merges it into the plan's feature branch — then drops you into a live view of every task. |

The first two are slash commands inside Claude Code. `pir` is a shell command, installed on your
PATH by `./install.sh`.

How far the agents may go on their own outside the code — deploys, paid calls, anything other
people see — is yours to set, action by action, in the plan. See
[You set how much the agents do on their own](#you-set-how-much-the-agents-do-on-their-own).

(The same plan can also be built one task per session, by typing `/pir-work {slug}` repeatedly —
the original single-stream flow, still supported.)

## You set how much the agents do on their own

Inside the repo the workers are fully autonomous: they write the code, run the tests, review each
other's work and merge it onto the run's branch without stopping for you. Everything a task does
**outside** the code — a deploy, a paid API call, a DNS change, a message somebody else receives,
a change to a real device — has its level of autonomy set by you, one action at a time.

`/pir-plan` lists every such action in `DESIGN.md §5.3` and puts each in one of three bins:

| Bin | What happens | Typical use |
|---|---|---|
| `worker` | The agent runs it and tells you afterwards in one line | A redeploy of a preview build, a free read-only call |
| `ask` | The agent explains it, runs it, and the permission prompt waits for your yes | A production deploy, a paid call, anything others will see |
| `person` | Only you can do it — the agent prepares everything and asks | A login, a physical device, a judgement call |

- **Risky actions start at `ask`.** Anything that cannot be undone, may cost more than its task
  expects, is seen or received by other people, or changes the infrastructure itself is `ask` by
  default. An action nobody listed is treated as `ask` too.
- **You move the dial at plan review.** `/pir-review-plan` walks every action in both directions
  and brings each question to you: a `person` step an agent could run after your yes (too little
  autonomy — you should not be pasting commands), and a `worker` action that crosses one of the
  lines above (too much). You can move an action down to `worker` there, and only there; the row
  records the date and your reason.
- **The machine enforces it, not the agent's good intentions.** The review turns the bins into
  permission rules in the project's `.claude/settings.json`, which every worker inherits: `worker`
  actions are allowed outright, `ask` actions stop on a permission prompt. In a parallel run that
  prompt shows up in `pir` as the worker asking you — you open it, approve or refuse, and it
  carries on.
- **Every action states its way back.** Each row names the exact command, whether and how it can
  be undone, what it is expected to cost, and a login check the agent runs first, so the decision
  reaches you while it is still a decision, not as a report afterwards.

The result is a run that is as hands-off as you decide it should be: a plan whose actions are all
`worker` stops only for genuine questions about what to build, and one full of `ask` rows also
stops exactly where you wanted to look before anything touches the live world.

## Every step starts with a clean slate

A long agent session degrades. The conversation fills with old attempts, abandoned ideas and
detail from tasks long finished; the model starts to lose track of the rules it was given at the
start, and eventually its history is summarised away and what it was told is gone. This is
*context rot*, and the method is built so that no step of the work ever runs long enough to reach
it:

- **A task is one session's work.** `/pir-plan` splits the plan until every task can be built,
  tested and handed over inside a single session, and writes each one down with its goal, the files
  it touches, its interface and what "done" means — everything a session needs to start cold.
- **A task that turns out bigger than planned does not have to grow.** Its worker can propose
  moving the extra work into a new task — asked and approved like any other question — and the
  run schedules it with its own fresh builder and reviewer (see
  [The plan can grow while it runs](#the-plan-can-grow-while-it-runs)). What the original task
  promised in its "done" is still finished in its own session; only work beyond that moves out.
- **Every worker is new, and is closed when its step is done.** A task's builder is closed when it
  hands the task over for review; the reviewer is closed once the task is merged. No session ever
  carries a second task, so none accumulates history from the last one.
- **The coordinator has no conversation at all.** It is a plain program, not an AI session, so the
  one piece that runs for the whole plan has nothing to go stale.
- **Memory lives in files, and the files are kept short.** What one session must hand the next
  goes into the plan's files, not into anyone's conversation: the design with its reasons, the
  task file, `PROGRESS.md` (the handoff) and `FINDINGS.md` (the lessons learned). The last two are
  read at the start of every session, so they have hard word limits and whoever adds to them trims
  them first — see [What `/pir-plan` produces](#what-pir-plan-produces).
- **The long story goes in git.** The reasoning behind a change is written in its commit message,
  where it costs nothing until somebody goes looking for it, instead of in a file every session
  must re-read.

So the tenth task of a plan is built by an agent in the same fresh state as the first, working
from the same written rules.

## Nobody reviews their own work

An agent that has just written a piece of code is the worst-placed reviewer of it: it remembers
what it meant, so it reads what it meant, not what it wrote. So every task passes through two
different sessions:

1. **A builder** (`pir-implement`) implements the task, runs the tests, marks it `🔍` — built,
   awaiting review — and is closed.
2. **A reviewer** (`pir-review`) is started fresh on the same work. It has no memory of the build:
   it knows only the task file, the plan's design rules and the change itself. It checks four
   things — every acceptance criterion, one by one; whether the tests really test something (a
   test that would still pass with the code gutted does not count); the traps the design and the
   project's recorded lessons name; and the edge cases, error paths and boundaries the task file
   did not anticipate. It fixes what it finds, marks the task `✅`, and only then is the task merged.

The separation is enforced, not requested. In a parallel run the coordinator decides who reviews
and always starts a new session to do it. In the single-stream flow `pir-work` picks the step, and
the builder and reviewer skills cannot be run directly — they do not appear in the `/` menu. The
plan itself gets the same treatment before any of it is built: `/pir-review-plan` must run in a
session that did not write the plan (below).

## Watching a run — `pir {slug}` and `pir`

`pir {slug}` starts the run detached from your terminal, so closing the pane or the terminal app
does not stop it, and opens its live view straight away. Running `pir {slug}` again while it is
going just reopens the view; running it on a stopped or crashed run resumes from the work already
committed.

The live view is one line per task, updated in place:

```
⠹ pir/screen-time · 3/9 done · 3 running · 1 asking you · 2 waiting · ceiling 4
  ✔ T00  prove-the-ground        merged                    4:12
  ✔ T01  usage-log-reader        merged                    9:47
  ✔ T02  budget-ledger           merged                    7:03
  ⠹ T03  policy-decision         building                  3:31
  ⠹ T04  weekend-rule            reviewing                 1:58
  ⠹ T05  warning-notifier        merging                   0:12
  ● T06  limit-screen            asking you · a question   6:40
  · T07  settings-file           needs T03
  · T08  daily-report            needs T05, T06

● T06 limit-screen — asking you; open it (→) to answer
```

What it tells you at a glance:

- **What is being built, reviewed or merged right now**, and for how long.
- **What is waiting, and on what** — `needs T03` means that task starts the moment T03 is merged.
- **Who is asking you something.** A worker that hits a question only you can answer — an
  unspecified requirement, a genuine choice, something that needs your eyes on a running thing —
  stops and waits, highlighted in amber, and its clock stops while it waits. Select its row and
  open it (→ or Enter): the worker's conversation opens inside `pir`, and you answer there in plain
  English, or pick from its question or allow its command; it carries on by itself. Every other task keeps moving meanwhile.
- **When it is done.** A finished run runs the tests on the feature branch and, only if they
  pass, prints the `git merge pir/{slug}` for you to run. It never merges to `main` itself.

`pir` on its own opens a dashboard of every run on the machine, across every repo: each run's
state (running, finished, stopped, crashed), its progress and how many workers are live.

| View | Keys |
|---|---|
| Dashboard | `↑↓` move · `↵` open a run · `Ctrl+S` twice stop · `Ctrl+X` twice remove · `esc` quit |
| Live view | `←` back to the dashboard · `Ctrl+S` twice stop this run · `esc` quit |

Quitting either view stops nothing. Stopping a run closes its workers at once and keeps
everything already merged; `pir {slug}` picks it up again later. At most four workers run at a
time (`PARALLEL_MAX_WORKERS` changes it), which caps both cost and merge complexity.

The full behaviour — the run lifecycle, task state, the branch and worktree model, restart and
recovery, known limitations — is in [`docs/`](docs/README.md), starting with
[detached-runs.md](docs/detached-runs.md) for `pir` itself.

## The plan can grow while it runs

A run does not need a perfect plan up front. When a worker finds that the plan is missing a task
— a piece of wiring nobody listed, a check a later task will need — it stops and asks you, the
same way it asks any other question. Once you say yes, it writes the new task down: its row in
`PROGRESS.md` and `PLAN.md`, and a full task file under `tasks/`.

The run picks the new task up when that worker's own work is merged, and fits it into the order
automatically:

- **It waits for what it depends on.** The new task starts the moment the tasks it names are
  done, like any other.
- **It can hold back existing tasks.** The new task can name tasks that must wait for it — a new
  T11 whose dependencies read `T04, T05; blocks T10` — and the run adds that wait to T10 without
  anyone editing T10.
  The live view then shows T10 as `needs T11`.
- **It is checked before it lands.** A task that depends on something that does not exist, or a
  wait that would go round in a circle, is refused and shown to you rather than applied.

What cannot change mid-run: a task that already exists cannot be edited, split, reordered or
given different dependencies — another worker may be building it at that moment. And a task that
has already started cannot be held back; if a new task asks for that, it is still added, and the
run tells you that the started task was built without the new work. The details are in [docs/task-state.md](docs/task-state.md).

## Why the plan gets reviewed too

A defect in a plan is copied into every task built from it, and the build-review alternation
cannot catch it: `pir-review` checks a task *against* the plan, so a wrong plan passes review
task after task, correctly. `/pir-review-plan` is the only pass that questions the plan itself,
and it runs in a session that did not write it. It looks for four things:

- **whether the documents agree** — dependencies pointing at tasks that exist and come
  earlier, one interface described the same way in both tasks that meet at it, no task quietly
  breaking a rule in `DESIGN.md`, every "Done when" checkable by somebody who was not there
- **whether the requirements are complete** — the unhappy path nobody specified, the thing a
  user would see that was never described, the choice the plan made silently. These are never
  filled in; each one is a question for you
- **whether the machine claims still hold** — the test command runs here, the versions are
  what `DESIGN.md` says, the seatbelts it names actually exist
- **whether any of it is already built** — every task checked against the code that is
  actually there, searching by what a thing *does* rather than what the plan calls it, because
  the near-duplicate is never named the same. A task that rebuilds what the repo already has
  passes every other check and still ships a second copy of something to maintain; the
  recommendation is to extend

It fixes what has exactly one right answer and tells you afterwards. Everything that changes
*what gets built* comes to you — the whole list first, so you can see its size, then one
decision at a time. Then it applies what you decided and stops.

It refuses to run in the session that wrote the plan, and refuses to run once building has
started. Its account lives in its commit message; there is no review report file to maintain.

## Install

The skills install **user-scoped** — once for your account, under `~/.claude/skills/`, where
every project sees the same copy. There is no per-project skill install: a per-project copy is
a copy that goes stale. The parallel coordinator engine installs the same way, under
`~/.claude/pir-engine/`, so it runs a plan in **any** repo — it reads its target from the
coordinator's working directory. Re-running the installer refreshes both in place.

The engine is `src/` plus its two npm packages, `@earendil-works/pi-tui` (the `pir` screen) and
`@anthropic-ai/claude-agent-sdk` (the line to each worker), pinned in the committed
`package-lock.json`. The installer runs `npm ci` beside the installed engine with dev, peer and
optional packages omitted, so it needs npm and the network on every run; if that fails it says so
and exits non-zero, since `pir` cannot start without them. In a checkout, `npm ci` once before
`npm test`.

For your account — the skills, the engine and the `pir` command, nothing else:

```sh
./install.sh --global
```

Into a project — the skills for your account **and** the working method appended to that
project's `CLAUDE.md`, plus its `plans/` directory:

```sh
./install.sh /path/to/project
```

Or, from inside a project already open in Claude Code, run the installer skill — it checks the
account skills are present and amends this project's `CLAUDE.md`:

```
/pir-install
```

Every form is idempotent: re-running refreshes the skills in place and never appends
`CLAUDE.md` twice. If the folder `pir` lands in is not on your PATH, the installer prints the
exact `export PATH` line to add. Skills are read at session start — install, then start a **new** session.

Parallel mode needs one per-user setting so a worker's own `git`/`npm test` clear the
auto-mode safety classifier: a `permissions.allow` list (shipped in a project's
`.claude/settings.json` and merged in by the installer) and an `autoMode.allow` exception in
your global `~/.claude/settings.json`. **The installer applies the `autoMode` rule when a
person runs it** in their own terminal. If it cannot write it — a Claude session running the
installer can be blocked from editing auto-mode config — it prints the exact manual step:
`/permissions` → Auto mode tab, or a hand-edit of `~/.claude/settings.json`. Confirm either
way with `claude auto-mode config`.

## What `/pir-plan` produces

```
plans/{slug}/
├── DESIGN.md        why everything is the way it is — every rule carries its reason,
│                    plus the environment, the test command and the verification table
├── PLAN.md          phases, task table, dependency graph, critical path
├── PROGRESS.md      task states and the queue — the handoff between sessions
├── FINDINGS.md      what the build taught, newest first — and the only place a
│                    hand-verification is ever recorded
├── prototype/       a throwaway mock that confirmed the direction, kept as a
│                    non-binding reference for the UI — only when the thing has a feel
└── tasks/
    ├── T00-*.md     one file per task: goal, files, interface, done-when, test list
    └── …
```

`PROGRESS.md` is the handoff; `FINDINGS.md` is the memory. Both are read at the start of
every session, so both are kept short on purpose — sixty words to a Notes cell, forty to a
finding, counted rather than estimated. When a note wants a paragraph, the paragraph goes in
the commit message.

Those budgets are enforced by a duty rather than by good intentions: **whoever appends,
compacts.** A session adding a row first shrinks the file if it is over its ceiling, and fixes
any over-budget row it read on the way in. Nothing else maintains these two files, and a limit
nobody enforces holds for about a week — the project this method came from grew one such file
to 175 000 characters, three quarters of it about tasks long closed, re-read in full by every
session before it could start.

## What a run actually looks like

```
/pir-plan
    → conversation: what it is for, the unhappy paths, what is deliberately not built
    → probes the machine for versions and the test command
    → checkpoint: requirements played back in plain English, you say yes
    → the thing has a screen, so it builds a clickable mock and waits: you open it,
      say the direction is right; the mock is parked at prototype/
    → searches the code for what already does part of this: finds the existing
      usage log covers two thirds of T03, asks whether to extend it or start clean
    → checkpoint: phase table, task list and dependencies, you say yes
    → writes plans/screen-time/, commits, stops
                                             commit: plan(screen-time): …

/pir-review-plan screen-time
    → fresh session, did not write the plan
    → reads DESIGN, PLAN, every task, and re-measures the machine
    → fixes 6 mechanical things: T07 depended on T09, two names for the same file
    → puts 3 decisions to you, one at a time: what happens when the log is corrupt,
      what the child sees at the daily limit, whether T04 covers the weekend rule
    → applies your answers, marks the plan reviewed, stops
                                             commit: plan-review(screen-time): 6 fixes, 3 decisions

$ pir screen-time
    → checks the plan is reviewed, starts the run in the background, opens the live view
    → T00 has no dependencies: a new worker builds it, marks it 🔍 and is closed;
      a second, fresh worker reviews it — no memory of the build — fixes a missed
      edge case, marks it ✅; it is merged and the reviewer is closed
    → T01, T02 and T03 all depended only on T00: three workers start at once
    → T06 needs your eyes: its worker starts the limit screen and asks you to look
      → the view shows "T06 limit-screen — asking you"; you open it in `pir`,
        run the command it gives you, say what you saw; it records that and carries on
    → T05's worker finds nothing in the plan wires the warning into the app; it asks
      you, you say yes, it adds T09 "warning-wiring; blocks T08" — once T05 merges,
      the view gains a T09 row, and T08 now needs T09 as well
    → T07 reaches `npm run deploy:web`, an `ask` action in §5.3: its worker says what it
      will deploy and how to roll it back, and waits on the permission prompt; you
      open it in `pir`, press Enter to allow, and it deploys and carries on
    → you close the terminal to go to lunch; the run keeps going
$ pir
    → the dashboard shows screen-time running, 8/10 done; ↵ reopens its live view
    → last task merged, tests on pir/screen-time pass:
        ✔ all 10 task(s) green on pir/screen-time · tests pass. Yours to merge:
            git merge pir/screen-time
```

A task is never reviewed by the worker that built it, and nothing lands on `main` until you merge
it.

## Rules worth remembering

The full set is in [CLAUDE.md](CLAUDE.md) — it is appended into each project and binds every
session. The ones that bite most often:

- **No plan gets built unread.** `pir {slug}` (and `/pir-work`) refuse a plan that has never
  been through `/pir-review-plan`, and say so.
- **Nothing unspecified gets invented.** A half-specified requirement is a question for you,
  not a gap for a worker to close quietly — it stops and asks, and waits for your answer.
- **Scope is strict.** A worker touches only the task it was given. Everything else it notices
  goes in `FINDINGS.md` and is left alone. The one exception: a worker that finds the plan is
  missing a task may add one, and only after you say yes.
- **The test command is the only evidence a worker can produce on its own.** Anything needing
  a screen, a login, a second account, a reboot, a real device or a paid API is verified *with
  you* — the worker hands you the exact command with a seatbelt on it, and waits for the answer.
- **Outside the code, the agents go only as far as you allowed.** Each live action sits in the
  `worker`, `ask` or `person` bin you approved at plan review, enforced as a permission rule; an
  action with no bin is `ask`.
- **`main` is yours.** A run builds on its own feature branch, one branch and worktree per
  task, and hands you the final `git merge`. Nothing merges to `main` without you.

## Layout of this repo

```
CLAUDE.md        the shared working method, appended into each project
install.sh       idempotent installer — skills + engine user-scoped, `pir` on the PATH,
                 method into a project
bin/
└── pir                the parallel front-end: `pir {slug}` runs a plan, `pir` the dashboard
docs/            how parallel mode behaves today — the canonical reference
src/
├── core/              the pure decision core of the coordinator
└── shell/             the coordinator, worktrees, the `pir` dashboard and live view
skills/
├── pir-plan/          the eight-stage planning procedure
│   └── templates/     DESIGN, PLAN, PROGRESS, FINDINGS, TASK
├── pir-review-plan/   read the plan back before anything is built
├── pir-worker/        the contract a parallel-mode worker session runs under
├── pir-implement/     build one task, hand it over unreviewed
├── pir-review/        check someone else's task, fix what it finds, close it
├── pir-work/          the single-stream dispatch — picks exactly one unit of work
├── pir-install/       set up the method in a repo — check skills, amend CLAUDE.md
└── pir-e2e/           reference: reuse a project's e2e tooling, else Playwright / a pty rig; the drill
pir-engine/ (installed) src/ and its npm packages, put in ~/.claude/pir-engine/ by install.sh
```

## Running the tests

Plans that ship code (the first is `parallel-pir`) keep a pure core under `src/core/` and a
thin platform shell under `src/shell/`. One command runs everything:

```
npm test
```

It runs Node's built-in test runner over `src/**/*.test.mjs` with the dot reporter, so a
green run is a few lines and the exit code carries the result. Colour is forced off
(`FORCE_COLOR=0`) because a green dot run should be plain text on any machine — including
this one, where `FORCE_COLOR=3` is set in the environment.

To see a full line per test while debugging, turn the reporter verbose:

```
node --test --test-reporter=spec 'src/**/*.test.mjs'
```

