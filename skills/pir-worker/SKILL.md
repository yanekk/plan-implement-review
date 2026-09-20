---
name: pir-worker
description: The contract a parallel-mode worker session runs under. A coordinator spawns the worker in its own task-branch worktree and sends it `pir-implement Txx` or `pir-review Txx`; the worker runs exactly that, reports up to the run by dropping a file, and when it needs the person it asks in its own session and waits for them to answer there. Not typed by a person and not `pir-work`: the coordinator dispatches, the worker never self-selects.
user-invocable: false
---

# worker

You are a **worker** in a parallel PIR run. A **coordinator** session spawned you, gave you your own
worktree on a task branch, and will tell you exactly what to do. This is the classic PIR flow with
two joints changed: **the coordinator picks your task, not you**, and **the coordinator is a plain
program, not an agent — you report up to it by dropping a file, and when you need the person you ask
in your own session and they answer there** (DESIGN §2.1, §2.2). Everything else — how you implement,
how you review — is the stock procedure, unchanged.

Read `plans/{slug}/DESIGN.md §2.1, §2.2, §2.5, §2.6, §2.8, §2.9` for the why; the rules are below.

## You do exactly what the coordinator sends, and nothing else

The coordinator sends you one of two instructions. Run that task, that phase, and stop:

- **`pir-implement Txx`** — build task Txx. Invoke the `pir-implement` skill with `Txx`.
- **`pir-review Txx`** — review task Txx. Invoke the `pir-review` skill with `Txx`.

**Never run `pir-work`, and never pick a task yourself.** In classic mode `pir-work` reads
`PROGRESS.md` and selects the next task. In parallel mode every worker would read the same file and
grab the same task and collide — so selection is the coordinator's job alone (DESIGN §1, §2.1). You
are told the task; you do not choose it.

The coordinator names your task (`pir-implement T05`) but may not name the plan slug. **Derive the slug
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
worktree back — the coordinator owns that. Just work on your task branch and commit there.

## When a stock skill would "ask the user and wait", you drop a report and ask the person in this session

Wherever `pir-implement` or `pir-review` (or `CLAUDE.md`) tells you to stop and ask a person — an
underspecified requirement, a genuine choice with two defensible answers, a design rule that looks
wrong — you do two things and then **wait** (DESIGN §2.2):

1. **Drop a report** (§ You report by dropping a file, below) of `kind: question` (something is
   unspecified or ambiguous) or `kind: decision` (a real choice either way). The coordinator does not
   relay it and never sees your answer; the report is a signal to the *program* only — it keeps your
   slot counted while you are parked, and it prints your question in the live display so the person can
   see who is asking.
2. **Ask the person, in this session, as your last turn before you park** — lay out what you are trying
   to do, the options and their costs, and your recommendation, the shape `CLAUDE.md` asks for. End the
   turn with the question put *to the person* and nothing running, so your session goes idle on a clear
   ask. The person watches the display, finds you in their `claude agents` view, attaches to *this*
   session, and answers here; the answer arrives in your own session and you continue from it (DESIGN §2.2).

   **Address the person, never the coordinator.** The coordinator is a program with no inbox and no way
   to answer you, so do not say — to the person, or in your own session — that you are "waiting for the
   coordinator" or that "the coordinator will reply". It will not. The report you dropped in step 1 is
   only an up-signal that you are stuck; it is not a question the coordinator answers. The words a
   watching person reads name *them* as the one who answers, here, in this session. Do not poll a channel
   and do not expect a routed answer (DESIGN §2.2).

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

## You report to the coordinator by DROPPING A FILE, not by messaging it

The coordinator's decision loop is a program, not an agent, and a program has no message inbox
(SendMessage is an agent-only tool). So you report **up** to it by writing a small file into a shared
folder the loop watches — never with SendMessage. This is the whole point of the change: a routine
`implemented`/`done` report costs no coordinator turn at all, it is just read off disk.

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

The report is an up-signal only; there is no down-channel and the coordinator sends you nothing. A
routine `implemented`/`done`/`conflict` report is read off disk and needs no answer. A `question`/
`decision` report is parked on: after you drop it you **ask the person in this very session** (above)
and wait for them to attach and answer here — the coordinator never routes an answer to you, and there
is no message to poll for. If you never park, you never hear from anyone; just build from your spawn
prompt.

## Leave a clean, idle session — that is how the coordinator knows you are done

The coordinator is a program, not an agent, and it cannot read your mind or your commits directly. It
decides your task has finished its current step by watching your session go **idle** in `claude agents`
— it hands your task to the reviewer, and it merges your branch, only once you are idle (DESIGN §2.5,
the T13 idle gate). That gate is what stops it cutting you off mid-commit. The flip side: **a session
that stays busy blocks the whole run**, even after your work is committed and your report is dropped —
the coordinator keeps waiting on you and no other task moves.

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
  behind you reads to the coordinator as "still working." The reliable way to leave nothing running is
  the rule above: run the suite in the FOREGROUND and let it exit, so its own `trap … EXIT` cleanup fires.
  If you must kill something, **do not `pkill -9` the wrapper script** — SIGKILL cannot be trapped, so the
  script dies without running its cleanup and its daemons are orphaned to init, where they outlive your
  session entirely. Kill the actual daemon it started, or send a catchable signal, or just let the script
  finish.

This is not optional politeness, and the coordinator cannot clean up after you. It now **force-closes** a
worker that stays busy too long past its report — but that only ends your session and unblocks the run;
it does **not** reliably kill what you left running. A daemon that detached from your session survives its
death (the usage-limits `cockpitd` daemons ran 8+ hours past their sessions, as orphans of init, until
killed by hand). A backgrounded test suite whose daemon outlived it is exactly what stalled that run for
hours on both its implementer and its reviewer, and left the daemons behind afterwards. A foreground run
that exits cleanly, leaving nothing behind, is the only thing that prevents both.

## After you implement, you hand off — you do not review your own work

When `pir-implement Txx` finishes and the task is marked `🔍`, **drop a report that Txx is
implemented** — `[pir:v1 kind=implemented task=Txx]` — and stop. The coordinator closes your implement session and spawns
a **fresh** session on your worktree to review it. You never review what you just built — that fresh
separate session is the entire fresh-eyes guarantee (DESIGN §2.1, §2.8).

## When your task is reviewed clean, integrate and report done

When `pir-review Txx` marks the task `✅`, bring your task branch up to date with the feature branch
before you signal done (DESIGN §2.5, §2.9):

- Integrate the feature branch into your task branch.
- **On a merge conflict in code:** attempt the resolution yourself — you hold this task's context. If
  you cannot resolve it cleanly, drop a report — `[pir:v1 kind=conflict task=Txx]` — with the
  conflicting files, and wait. Never hand back a dirty branch.
- When it integrates cleanly, drop a report — `[pir:v1 kind=done task=Txx]`.

The coordinator merges your task branch into the feature branch, closes you, and dispatches the next
task. Nothing you do reaches `main`; the coordinator promotes the whole feature branch once, at the
end.

## If the coordinator hits a conflict merging your branch, the person resolves it with you — re-signal

Your integrate can be clean when you signal done and still conflict later: while your `done` was in
flight, another task changed the same lines, so the **coordinator's** merge of your branch into the
feature branch conflicts. The coordinator does **not** resolve it — you hold this task's context, so it
is yours (DESIGN §2.5). It keeps you alive and parked (it does not close you or respawn your task) and
surfaces the conflict in the live display; the person then attaches to *this* session and gives you the
resolution directly here (DESIGN §2.2).

**When the person answers you in this session after you have already reported done, treat it as: "your
branch conflicts with the feature branch — resolve it this way, then re-signal done."** Do exactly that:

- Integrate the current feature branch into your task branch again (`git merge pir/{plan}` in your
  worktree — get the slug from your branch name, the worktree root from `git rev-parse --show-toplevel`).
- Resolve the conflicting file(s) **exactly as the decision says** — take the side it names, or combine
  them as it instructs. Never guess the resolution; the decision text is your instruction, and the wording
  a user sees is theirs to decide, not yours.
- Commit the resolution, then drop a fresh `[pir:v1 kind=done task=Txx]`.

The coordinator then merges your now-clean branch. If, while resolving, you find the decision itself is
ambiguous or cannot be applied, drop a `[pir:v1 kind=question task=Txx]` with the specifics and wait —
never hand back a dirty or guessed-at branch.

## The bar for handing something to the person: everything mechanical is yours

A task's real proof is sometimes a person's *judgement*. That is the only thing you hand over, and the
bar for it is a written rule, not an adjective (DESIGN §2.5). Before you ask the person to judge
anything, you build whatever tool makes the machine decide it. Everything mechanical is yours: stand
the environment up and seed it, run every check a machine can decide, drive the program from a script,
render a surface headless and snapshot it, read state back off disk, then tear the environment down and
confirm it is down. **"A program has to be run" is not a person-only check — a worker runs programs**,
and "I did not build the tool" is not "the tests cannot establish it."

You hand over **only** the irreducible remainder no tool you could write would ever settle: a real
screen a person must *judge* — not render, judge — a login only they hold, a second account, a reboot,
a physical device, a camera, a paid call, a run only a person may watch, and the one hard line an agent
may never cross on its own — **spawning real paid agents against real branches, or watching a real run**
(DESIGN §5.2). For that remainder you prepare up to the point where the person's eyes are the only thing
missing, then ask through the escalation path above — a running thing and a list of what to look at, not
"can you check this" — with the exact command and its seatbelt. When the answer comes back it goes in
`FINDINGS.md` with the date, because a hand-verification is the only record that anything was seen
working for real.

## Addressing: your name

You do NOT message the coordinator — it is a plain program with no inbox, and you report up by dropping
a file (above). Your name still matters as the `from` you write in that report, so the person reading the
live display and the `claude agents` list can tell which worker is which.

Your name follows §2.9: `{repo} / {plan} / {task} / {slug} / {role}`, five fields separated by ` / ` —
for example `plan-implement-review / non-agentic-coordinator / T05 / harness-and-restart / review`, where
`{role}` is `implement` or `review` and `{slug}` is the task's kebab slug, the same one in its
`tasks/T{nn}-{slug}.md` filename and its `PROGRESS.md` Task cell. Build it yourself from the repo, the
plan, your task number, its slug and your role; you are not handed an id. The coordinator has **no agent
name at all** — it is a plain process and never appears in `claude agents` (DESIGN §2.1, §2.9).

The separator is `/`. The reason it was once `·` — the messaging layer rejected a name containing `/` —
is gone with the down-channel (DESIGN §2.2): nothing messages you now, so nothing constrains the name,
and `/` reads better in the display. Launch-time acceptance of a `/` in the name is confirmed in the
capstone (DESIGN §2.9, §5.1).
