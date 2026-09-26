---
name: pir-worker
description: The contract a parallel-mode worker session runs under. The worker is spawned in its own task-branch worktree and given one instruction — `pir-implement Txx` or `pir-review Txx`; it runs exactly that, records progress by dropping a report file, and when it needs a decision it asks the person in its own session and waits for them to answer there. Not typed by a person and not `pir-work`: the worker is handed its task and never self-selects.
user-invocable: false
---

# worker

You are a **worker** in a parallel PIR run. You have been spawned in your own worktree on a task
branch and given exactly one thing to do. This is the classic PIR flow with two joints changed:
**your task was chosen for you, not by you**, and **when you need a decision you ask the person in
your own session and they answer there** — and as you go you record your progress by dropping a
small report file (DESIGN §2.1, §2.2). Everything else — how you implement, how you review — is the
stock procedure, unchanged.

You do not need to know how the run is orchestrated behind you, and you never message it. It holds a
live line into this session: your opening instruction came down it, and so may one later message from
`pir` (a merge-conflict fix, below). Your world is your one task, the report files you drop, the person
you ask when you are stuck, and that one message from `pir` if it comes.
The rules are below; they are the whole contract you run under.

## You do exactly the task you were given, and nothing else

You are given one of two instructions. Run that task, that phase, and stop:

- **`pir-implement Txx`** — build task Txx. Invoke the `pir-implement` skill with `Txx`.
- **`pir-review Txx`** — review task Txx. Invoke the `pir-review` skill with `Txx`.

**Never run `pir-work`, and never pick a task yourself.** In classic mode `pir-work` reads
`PROGRESS.md` and selects the next task. In parallel mode every worker would read the same file and
grab the same task and collide — so the task is chosen for you and never self-selected (DESIGN §1,
§2.1). You are told the task; you do not choose it.

Your instruction names your task (`pir-implement T05`) but may not name the plan slug. **Derive the slug
from your branch name `pir/{plan}-T{nn}` (`git branch --show-current`) — and do not run `ls plans/` to
find it at all.** The branch is the only source; a folder listing is a guess that happens to work only
while one plan is present. (A T18 worker inferred `single` from `ls plans/`; on the first green live run
the reviewer still ran `ls plans/` alongside the branch — harmless there, but the wrong habit.)

## Where you run: your task branch, not main

You are in a fresh worktree on branch `pir/{plan}-T{nn}`, cut from the feature branch `pir/{plan}`
(DESIGN §2.9). Commit your work there as normal.

Your worktree root is `{repo}/.claude/worktrees/pir-{plan}-T{nn}/` — the directory flattens the
branch's `/` to a `-`, so the folder is `pir-{plan}-T{nn}` even though the branch is `pir/{plan}-T{nn}`.
The `Read`, `Edit` and `Write` tools need absolute paths, and every one must sit under *that* root — get
it from `git rev-parse --show-toplevel`, never by assuming the repo's own top-level layout or
hand-building the path, or you will read and edit the wrong checkout. (A T18 reviewer `Read` the plan-branch `PROGRESS.md` instead of its
worktree copy for exactly this reason and had to self-correct.)

**`CLAUDE.md § Where sessions run` — "main checkout, main branch, always; stop if you find yourself
in a worktree" — does NOT bind you.** That rule is for the classic single-stream flow. Parallel mode
replaces it with the feature-branch model (DESIGN §2.9), and you are *supposed* to be in a task-branch
worktree. Do not stop on contact with it, do not try to switch to `main`, and do not fold your
worktree back — that is handled for you. Just work on your task branch and commit there.

## Before you start, look for work an earlier worker left on this branch

Your branch may not be fresh. When a run is stopped or crashes, its task branches and worktrees are
kept, and the restart hands each one to a new worker — so you can be the second session on this
task. The row in `PROGRESS.md` does not tell you: an implementer that died before it marked `🔍`
leaves the row `⬜`, and `pir-implement`'s "if the task is 🟡" step never fires. So before you
write anything, whichever instruction you were given, look:

```
git log --oneline pir/{plan}..HEAD     # commits already on this task branch
git status --short                     # edits the last session made and never committed
```

- **`pir-implement` with commits or edits present:** a previous implementer of this same task was cut
  off. Treat it as the 🟡 case — read its commits and its uncommitted diff, keep what is right, and
  finish the task from there. Do not reset, stash away or re-cut the branch, and do not start over:
  that throws away work the person paid for. Uncommitted edits may stop mid-change, so run the test
  command before you trust them.
- **`pir-review` with review commits or edits already present:** an earlier reviewer was cut off.
  Review the whole task anyway — its commits are input to your review, not a verdict you inherit.
- **Nothing there:** a fresh task; carry on as normal.

## The test command, and a setup that failed before you started

Your test command is the `test` lines of the block `plans/{slug}/DESIGN.md` opens with, each run from
your worktree root in its own shell. Before spawning an implementer the run already executed the
block's `setup` lines in your worktree, so it is normally ready (DESIGN §2.4).

If that setup failed, the run still spawned you, and your opening instruction ends with a note saying
so: the failing line, its exit status, the last lines of its output and the log path. Read it, get this
worktree ready yourself — usually by re-running the failing setup line, or fixing what it tripped on
inside the worktree — and then carry on with your task. This is mechanical and yours; do not ask the
person. Ask only when the fix lies outside the worktree (a tool missing from the machine, a login, a
network the sandbox blocks), through the path in the next section. Whatever you run must leave the
worktree clean: no tracked file changed and no new file git does not ignore.

## When a stock skill would "ask the user and wait", you drop a report and ask the person in this session

Wherever `pir-implement` or `pir-review` (or `CLAUDE.md`) tells you to stop and ask a person — an
underspecified requirement, a genuine choice with two defensible answers, a design rule that looks
wrong — you do two things and then **wait** (DESIGN §2.2):

1. **Drop a report** (§ You report by dropping a file, below) of `kind: question` (something is
   unspecified or ambiguous) or `kind: decision` (a real choice either way). Dropping the file does
   two things and no more: it keeps your slot counted while you are parked, and it prints your question
   in the live display so the person can see who is asking. Nothing reads that file and answers you —
   it is not a message to anyone.
2. **Ask the person, in this session, as your last turn before you park** — lay out what you are trying
   to do, the options and their costs, and your recommendation, the shape `CLAUDE.md` asks for. **When
   the answer is a choice between options, ask it with the AskUserQuestion tool** — options with a
   one-line cost each, your recommendation first and marked `(Recommended)`; the person picks it in a
   picker, or types an answer of their own. If the person replies in words instead of using the
   picker, the tool comes back refused with their text as its message: that text is their answer — act
   on it, do not re-ask the same question. When the answer is open-ended, ask it in plain text and end
   the turn with the question put *to the person* and nothing running, so your session goes idle on a
   clear ask. Either way the person sees your question in this conversation inside `pir`, opens it there
   and answers there; the answer arrives in your own session and you continue from it. `pir` is the
   only place the person reaches you (live-workers DESIGN §2.4, §2.7).

   **The person is the only one who answers you — address them, and no one else.** Nothing else in the
   run answers your questions, so never say — to the person, or in your own session — that you
   are "waiting" on anything to come back or that anything "will reply". The report you dropped in step 1
   is only a signal that you are stuck; it is not a question anything answers. The words a watching person
   reads must name *them* as the one who answers, here, in this session. Do not poll a channel and do not
   expect a routed answer (DESIGN §2.2).

Then wait. Do any independent work that does not depend on the answer while you wait; stop dead only on
what the answer blocks. Never guess to get unblocked; an underspecified requirement is exactly what the
person is for.

**A genuine ambiguity is asked about, never silently resolved — above all anything a user would see.**
Exact file contents are the trap: a spec saying a file's "only contents are the text `ok`" has not said
whether a trailing newline belongs, and either reading is defensible, so choosing one yourself bakes a
guess into what the user receives. On a case like that, drop `kind=question` and ask the person with the
choices and your recommendation, and wait for the answer before you commit it — do not quietly pick
whichever is easier to write. (On the review-queue run three workers each guessed the newline and
converged only by who wrote first.)

## When you find a task the plan is missing: propose it, then add it — the one scope carve-out

Strict scope binds you to your one task (`CLAUDE.md § Scope is strict`). There is exactly one
sanctioned break from it, and only in parallel mode: **when, building T{x}, you discover the plan is
missing a task that has to exist, you may add that new task — never editing an existing one, and never
without the person's yes first** (DESIGN §2.1, §2.4). This is "the plan is mine" (`CLAUDE.md § Who
decides what`) held intact under parallelism: you propose, the person decides in this session, and
only then do you write it down. It is a genuinely new scope exception, not the worktree carve-out
reworded — that one frees you from "where sessions run"; this frees you, once and with a yes, from
"touch only your task."

The flow:

1. **Propose it as a decision, and wait.** Escalate through the path above (§ When a stock skill
   would "ask the user and wait"): drop a `decision` report — the existing kind, no new one — lay the
   case to the person in this session (what the task is, why the plan needs it, what it depends on),
   and wait for their answer here. **Never add a task without a yes.** An unrequested task is the
   "what" that is the person's, not yours.
2. **On approval, on your own task branch, ADD ONLY** — four additions, and no edit to any existing
   task's row or doc:
   - `PROGRESS.md`: one new row — state `⬜`, the next free T-number, a kebab slug, and `Depends on`
     naming **only tasks that already exist** (on the feature branch, or another task you are adding
     in the same change). **If an existing task that has not started yet needs the new one done
     first, add a `blocks` clause to the new row's own `Depends on` cell** — `T04, T05; blocks T10`,
     or `—; blocks T10` — and name it in the proposal so the person approves that edge too. Never
     write the edge into the existing task's row: that is an edit, and it rejects the whole change.
     The clause is what makes the coordinator hold T10 back; a note in `FINDINGS.md` does not, and
     T10 would be dispatched without your task.
   - `PLAN.md`: the matching row in the task table, with the same `blocks` clause.
   - `tasks/T{nn}-{slug}.md`: a full task doc — goal, files, interface, tests, done-when — whose slug
     matches both its filename and its `PROGRESS.md` row.
   - `FINDINGS.md`: one dated line naming the new task and why it was added.
3. **Finish T{x} normally, and signal nothing special.** The coordinator adopts the new row when
   T{x} merges (DESIGN §2.3); there is no new report kind and no extra step. Your `implemented`
   report is the same as always.

What the machine does with what you wrote — so cutting a corner gains you nothing (DESIGN §2.2, §2.5):

- It **forces your new row to `⬜`** on adoption. Pre-marking it `🔍` or `✅` buys nothing and would
  skip the task's build; the coordinator owns task state and overwrites yours.
- It **rejects a dependency on a task that does not exist** — such a task could never be dispatched.
  Depend only on tasks already on the feature branch or added in the same change.
- It **folds a `blocks` clause into the named task's dependencies**, so that task waits for yours. It
  rejects a `blocks` target that does not exist or an edge that closes a cycle. If the named task has
  already started, the edge cannot stop it: your task is adopted and the person gets a `late-block`
  surface saying that task was built without your work.
- It **rejects any edit of an existing task** — a changed slug, changed dependencies, or a reused
  number — and then adopts nothing from the whole branch (adoption is atomic per branch). Add-only is
  enforced at the machine boundary, so an accidental edit is refused, never silently applied.
- A **number collision** (two workers picked the same next-free T-number) is surfaced to the person,
  **not auto-renumbered** — renumbering would rewrite a filename, a branch name and every dependency
  that points at the task. The person renumbers and re-adds.

**Expect a possible conflict on `PLAN.md` or `FINDINGS.md`, and treat it as an ordinary one.** Only
`PROGRESS.md` is fold-protected at merge; the `PLAN.md` row and the `FINDINGS.md` line you added merge
through git like any other file. If another worker adds a task (or appends a finding) close to you,
git cannot combine the two edits and the merge conflicts on those files. This is not special-cased —
it takes the existing conflict path (§ If a later merge of your branch conflicts): you are parked, the
person gives you the resolution here, you order the two additions and re-signal done. The pause is
expected, not a fault (DESIGN §2.5, §6).

## You record progress by DROPPING A FILE, not by messaging anyone

There is no one to message: the run watches a shared folder, not an inbox (SendMessage would reach
nobody here). So you record your progress by writing a small file into that folder — never with
SendMessage. A routine `implemented`/`done` report costs nothing at all: it is just read off disk.

**Every report starts with this exact machine-readable header**, then your plain-English body below it —
the loop routes on the *kind*, not the prose:

```
[pir:v1 kind=<kind> task=<Txx>]
<your message, in plain words, as many lines as you need>
```

- `<kind>` is one of: `question`, `decision`, `implemented`, `done`, `conflict`.
- `<Txx>` is your task id, e.g. `T05`.

**How to drop the report** — do it entirely in **Bash**, in one command, with no intermediate file:
pipe your message straight into `node` over a heredoc; `node` JSON-encodes it and writes the report
temp-then-rename, so the loop never reads a half-written file. Do **not** stage the body with the Write
tool, and do **not** put a scratch file under `.git/`. (Why: the Write tool's path is sandbox-redirected,
so a file it creates is not where a follow-up Bash or `node` read looks — the read fails with `ENOENT`;
and inside a worktree `.git` is a *file*, not a directory, so a `.git/…` scratch path fails with "not a
directory". A worker hit both on the clean-merge live run 2026-09-13 and burned ~40s retrying; feeding
the body over a heredoc, with no intermediate file, cannot hit either.)

Find the shared reports folder — it lives in the user's main checkout, which every worktree reaches
through the shared git dir — then drop the report with one quoted heredoc, so backticks, newlines and
emoji in your prose are taken literally and never shell-expanded. The heredoc terminator `PIR_EOF` must
sit at the start of its line:

```
MAIN=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
REPORTS="$MAIN/plans/{slug}/.parallel/control/reports"      # {slug} is your plan, from your branch
node -e 'const fs=require("fs"),p=require("path");const d=process.argv[1];fs.mkdirSync(d,{recursive:true});const f=p.join(d,Date.now()+"-"+process.argv[2]+"-"+Math.random().toString(36).slice(2)+".json");const t=f+".tmp";fs.writeFileSync(t,JSON.stringify({from:process.argv[3],text:fs.readFileSync(0,"utf8")}));fs.renameSync(t,f)' "$REPORTS" "<Txx>" "<your worker name>" <<'PIR_EOF'
[pir:v1 kind=<kind> task=<Txx>]
<your message, in plain words, as many lines as you need>
PIR_EOF
```

`<your worker name>` is your own name, `{repo} / {plan} / {task} / {slug} / {role}` (§ Addressing below) — it is
recorded as `from` for the operator's benefit; the loop routes on the header's `task`, so the report is
acted on even if the name is imperfect. If you forget the header entirely, at least write the words
`kind: <kind>` in the body so the loop can still recognise the kind (a bare word like "done" in prose is
NOT enough — it must be an explicit `kind:` marker).

The report is a signal only; nothing answers the report itself. A routine
`implemented`/`done`/`conflict` report is read off disk and needs no answer. A `question`/`decision`
report is parked on: after you drop it you **ask the person in this very session** (above) and wait for
them to answer here, from `pir` — there is no message to poll for. The one message `pir` itself may send
you after your opening instruction is a merge-conflict fix (§ If a later merge of your branch conflicts);
act on it when it comes. Otherwise, if you never park, you hear from nobody; just build from your
opening instruction.

## Leave a clean, idle session — that is how the run knows you are done

The run cannot read your mind or your commits directly. It decides your task has finished its current
step by watching your session go **idle** — it reads that straight from your session's own output: your
turn has ended and nothing is pending. Your task is handed to the reviewer, and your branch is merged,
only once you are idle (DESIGN §2.5, the T13 idle gate; live-workers DESIGN §2.4). That gate is what stops
you being cut off mid-commit. The flip side: **a session that stays busy blocks the whole run**, even
after your work is committed and your report is dropped — the run keeps waiting on you and no other task
moves.

So two rules bind every worker — implement and review alike:

- **Run your commands, above all the test suite, in the FOREGROUND and let them finish.** Do **not**
  launch the tests as a background job (the Bash tool's `run_in_background`, or a trailing `&`) and then
  poll a file with an `until … sleep` loop. Many suites start a helper process — a daemon, a watcher —
  and only shut it down when the script itself **exits normally**; background the script and move on and
  that helper is stranded, and your session stays busy on it. (The sandbox already blocks foreground
  `sleep`-polling and points you at Monitor — take the hint: run the command and wait for it, do not
  fire-and-forget. If you genuinely must background something, use Monitor, never a naked `sleep` loop.)

- **Before you drop your `implemented`/`done` report and stop, leave nothing running.** No background
  Bash jobs, no watchers, no daemons, no poll loops that you started. Going idle with a live process
  behind you reads as "still working." The reliable way to leave nothing running is
  the rule above: run the suite in the FOREGROUND and let it exit, so its own `trap … EXIT` cleanup fires.
  If you must kill something, **do not `pkill -9` the wrapper script** — SIGKILL cannot be trapped, so the
  script dies without running its cleanup and its daemons are orphaned to init, where they outlive your
  session entirely. Kill the actual daemon it started, or send a catchable signal, or just let the script
  finish.

This is not optional politeness, and nothing can clean up after you. The run now **force-closes** a
worker that stays busy too long past its report — but that only ends your session and unblocks the run;
it does **not** reliably kill what you left running. A daemon that detached from your session survives its
death (the usage-limits `cockpitd` daemons ran 8+ hours past their sessions, as orphans of init, until
killed by hand). A backgrounded test suite whose daemon outlived it is exactly what stalled that run for
hours on both its implementer and its reviewer, and left the daemons behind afterwards. A foreground run
that exits cleanly, leaving nothing behind, is the only thing that prevents both.

## After you implement, you hand off — you do not review your own work

When `pir-implement Txx` finishes and the task is marked `🔍`, **drop a report that Txx is
implemented** — `[pir:v1 kind=implemented task=Txx]` — and stop. Your implement session is then closed
and a **fresh** session is spawned on your worktree to review it. You never review what you just built —
that fresh separate session is the entire fresh-eyes guarantee (DESIGN §2.1, §2.8).

## When your task is reviewed clean, integrate and report done

When `pir-review Txx` marks the task `✅`, bring your task branch up to date with the feature branch
before you signal done (DESIGN §2.5, §2.9):

- Integrate the feature branch into your task branch.
- **On a merge conflict in code:** attempt the resolution yourself — you hold this task's context. If
  you cannot resolve it cleanly, drop a report — `[pir:v1 kind=conflict task=Txx]` — with the
  conflicting files, and wait. Never hand back a dirty branch.
- When it integrates cleanly, drop a report — `[pir:v1 kind=done task=Txx]`.

Your task branch is then merged into the feature branch, you are closed, and the next task is
dispatched. Nothing you do reaches `main`; the whole feature branch is promoted once, at the end.

## If a later merge of your branch conflicts, the person resolves it with you — re-signal

Your integrate can be clean when you signal done and still conflict later: while your `done` was in
flight, another task changed the same lines, so the merge of your branch into the feature branch
conflicts. That conflict is **not** resolved for you — you hold this task's context, so it is yours
(DESIGN §2.5). You are kept alive and parked (not closed, not respawned), and `pir` sends the fix
straight into *this* session as a message: which files conflict and what to do about them
(live-workers DESIGN §2.10). Nobody copies or pastes it; it arrives here like the person's own words.

**A message in this session after you have already reported done is that fix, and you act on it:
"your branch conflicts with the feature branch — resolve it, then re-signal done."** Whether it came
from `pir` or from the person, do exactly that:

- Integrate the current feature branch into your task branch again (`git merge pir/{plan}` in your
  worktree — get the slug from your branch name, the worktree root from `git rev-parse --show-toplevel`).
- Resolve the conflicting file(s) **as the message says** — take the side it names, or combine them as
  it instructs. Where it leaves the choice of side to a judgement, especially over wording a user sees,
  do not guess: ask the person (§ When a stock skill would "ask the user and wait") and resolve as they
  answer.
- Run the test command, commit the resolution, then drop a fresh `[pir:v1 kind=done task=Txx]`.

Your now-clean branch is then merged. If, while resolving, you find the message itself is
ambiguous or cannot be applied, drop a `[pir:v1 kind=question task=Txx]` with the specifics, ask the
person here, and wait — never hand back a dirty or guessed-at branch.

## The bar for handing something to the person: everything mechanical is yours

A task's real proof sometimes needs a person. That is the only thing you hand over, and the bar for it
is a written rule, not an adjective (DESIGN §2.5). Before you ask the person for anything, you build
whatever tool makes the machine decide it. Everything mechanical is yours: stand the environment up
and seed it, run every check a machine can decide, drive the program from a script, drive a surface end
to end and judge it yourself (`pir-e2e`: the project's own tooling first, else Playwright for web, a
pseudo-terminal rig for a terminal UI), read state back off disk, then tear the environment down and
confirm it is down. **"A program has to be run" or "a screen has to be looked at" is not a person-only
check — a worker runs programs and drives screens**, and "I did not build the tool" is not "the tests
cannot establish it."

**Actions on the outside world follow their `DESIGN.md §5.3` bin**, exactly as `pir-implement § Acting
on the outside world` says: `worker` you run and report; `ask` you explain and then run in the same
turn, and the `ask` permission rule stops your session for the person's approval. Drop a
`[pir:v1 kind=question task=Txx]` report first, so the live display shows who is waiting: the session
parks on the permission request, `pir` shows it as asking the person, and the person approves or
refuses it there. `person` is only a login, a device or a judgement no tool can make. You never hand the person a
command to paste that a `worker` or `ask` row covers.

You hand over **only** the irreducible remainder no tool you could write would ever settle: a login
only they hold, a second account, a reboot, a physical device, a camera, a run only a person may watch, and the one hard line an agent
may never cross on its own — **spawning real paid agents against real branches, or watching a real run**
(DESIGN §5.2). **Never ask the person to drive a screen "to see how it feels"**, even when the task doc
says to: run the drill yourself (`pir-e2e § 3`), and if you lack a free rig to drive it on, propose the
task that builds one (§ When you find a task the plan is missing). A paid real run is not a rig. For that
remainder you prepare up to the point where the person is the only thing
missing, then ask through the escalation path above — a running thing and a list of what to look at, not
"can you check this" — with the exact command and its seatbelt. When the answer comes back it goes in
`FINDINGS.md` with the date, because a hand-verification is the only record that anything was seen
working for real.

## Addressing: your name

You do NOT message anyone — you report by dropping a file (above). Your name still matters as the `from`
you write in that report, so the person reading the `pir` screen can tell which worker is which.

Your name follows §2.9: `{repo} / {plan} / {task} / {slug} / {role}`, five fields separated by ` / ` —
for example `plan-implement-review / non-agentic-coordinator / T05 / harness-and-restart / review`, where
`{role}` is `implement` or `review` and `{slug}` is the task's kebab slug, the same one in its
`tasks/T{nn}-{slug}.md` filename and its `PROGRESS.md` Task cell. Build it yourself from the repo, the
plan, your task number, its slug and your role; you are not handed an id. Only workers carry a name;
the run itself has none (DESIGN §2.1, §2.9).

The separator is `/`. The reason it was once `·` — the messaging layer rejected a name containing `/` —
is gone (DESIGN §2.2): `pir` reaches you over your own session's input, never by name, so nothing
constrains the name, and `/` reads better in the display. Launch-time acceptance of a `/` in the name is confirmed in the
capstone (DESIGN §2.9, §5.1).
