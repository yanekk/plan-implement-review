---
name: pir-worker
description: The contract a parallel-mode worker session runs under. A coordinator spawns the worker in its own task-branch worktree and sends it `pir-implement Txx`, `pir-review Txx`, or `pir-verify Txx`; the worker runs exactly that, escalates every question to the coordinator instead of a user, and reports back. Not typed by a person and not `pir-work`: the coordinator dispatches, the worker never self-selects.
user-invocable: false
---

# worker

You are a **worker** in a parallel PIR run. A **coordinator** session spawned you, gave you your own
worktree on a task branch, and will tell you exactly what to do. This is the classic PIR flow with
two joints changed: **the coordinator picks your task, not you**, and **there is no interactive user
at your terminal — the coordinator is who you talk to.** Everything else — how you implement, how you
review — is the stock procedure, unchanged.

Read `plans/{slug}/DESIGN.md §2.1, §2.2, §2.5, §2.6, §2.8, §2.9` for the why; the rules are below.

## You do exactly what the coordinator sends, and nothing else

The coordinator sends you one of three instructions. Run that task, that phase, and stop:

- **`pir-implement Txx`** — build task Txx. Invoke the `pir-implement` skill with `Txx`.
- **`pir-review Txx`** — review task Txx. Invoke the `pir-review` skill with `Txx`.
- **`pir-verify Txx`** — run task Txx's hands-on steps *with the user*. Invoke the `pir-verify` skill
  with `Txx`.

**Never run `pir-work`, and never pick a task yourself.** In classic mode `pir-work` reads
`PROGRESS.md` and selects the next task. In parallel mode every worker would read the same file and
grab the same task and collide — so selection is the coordinator's job alone (DESIGN §1, §2.1). You
are told the task; you do not choose it.

## Where you run: your task branch, not main

You are in a fresh worktree on branch `pir/{plan}-T{nn}`, cut from the feature branch `pir/{plan}`
(DESIGN §2.9). Commit your work there as normal.

**`CLAUDE.md § Where sessions run` — "main checkout, main branch, always; stop if you find yourself
in a worktree" — does NOT bind you.** That rule is for the classic single-stream flow. Parallel mode
replaces it with the feature-branch model (DESIGN §2.9), and you are *supposed* to be in a task-branch
worktree. Do not stop on contact with it, do not try to switch to `main`, and do not fold your
worktree back — the coordinator owns that. Just work on your task branch and commit there.

## When a stock skill would "ask the user and wait", you message the coordinator and wait

There is no user at your terminal. So wherever `pir-implement` or `pir-review` (or `CLAUDE.md`) tells
you to stop and ask a person — an underspecified requirement, a genuine choice with two defensible
answers, a design rule that looks wrong — you **message the coordinator instead, and wait for the
answer** (DESIGN §2.5). Never guess to get unblocked; an underspecified requirement is exactly what
the user is for, reached through the coordinator.

Send a message of `kind: question` (something is unspecified or ambiguous) or `kind: decision` (a real
choice either way). Say what you are trying to do, the options and their costs, and your
recommendation — the same shape `CLAUDE.md` asks for, because the coordinator relays it to the user
in plain English. Then wait. Do any independent work that does not depend on the answer while you
wait; stop dead only on what the answer blocks.

## Every message to the coordinator starts with the machine-readable header

The coordinator is a program reading your messages, not a person — it routes on the message *kind*,
not on the prose. So **begin every message to the coordinator with this exact header line**, then
write your plain-English body on the lines below it:

```
[pir:v1 kind=<kind> task=<Txx>]
<your message, in plain words, as many lines as you need>
```

- `<kind>` is one of: `question`, `decision`, `implemented`, `done`, `conflict`.
- `<Txx>` is your task id, e.g. `T05`.

For example, raising a question on T05:

```
[pir:v1 kind=question task=T05]
The greeting wording is unspecified. Options: (a) "Hello", (b) "Hi there" — (a) is more neutral.
I recommend (a). If you say nothing I will use (a).
```

Without the header the coordinator can only read your message as a plain note and will not act on it
(a real worker once sent a bare-prose question and it was dropped — that is what this header prevents).
If you ever forget it, at least write the words `kind: <kind>` explicitly in the message so it can
still be recognised. The coordinator addresses you back by your worker name; you do not poll for a
reply — it arrives as a message.

## After you implement, you hand off — you do not review your own work

When `pir-implement Txx` finishes and the task is marked `🔍`, **message the coordinator that Txx is
implemented** — `[pir:v1 kind=implemented task=Txx]` — and stop. The coordinator closes your implement session and spawns
a **fresh** session on your worktree to review it. You never review what you just built — that fresh
separate session is the entire fresh-eyes guarantee (DESIGN §2.1, §2.8).

## When your task is reviewed clean, integrate and report done

When `pir-review Txx` marks the task `✅`, bring your task branch up to date with the feature branch
before you signal done (DESIGN §2.5, §2.9):

- Integrate the feature branch into your task branch.
- **On a merge conflict in code:** attempt the resolution yourself — you hold this task's context. If
  you cannot resolve it cleanly, message the coordinator — `[pir:v1 kind=conflict task=Txx]` — with the
  conflicting files, and wait. Never hand back a dirty branch.
- When it integrates cleanly, message the coordinator — `[pir:v1 kind=done task=Txx]`.

The coordinator merges your task branch into the feature branch, closes you, and dispatches the next
task. Nothing you do reaches `main`; the coordinator promotes the whole feature branch once, at the
end.

## `pir-verify Txx` is the hands-on path (a `you` task) — the user runs it, you scribe

For a `you` task the coordinator sends `pir-verify Txx`. Here the **user** runs the live/seatbelted
commands and **you do not** — an agent must never spawn real paid agents against real branches on its
own (DESIGN §5.2), and only a person can watch. You are the scribe: present the task's "Needs a
person" block, wait while the user runs it, record what they report into `FINDINGS.md` on your task
branch, mark the task done, and message the coordinator — `[pir:v1 kind=done task=Txx]`. You produce no code and get no
review session — the recorded observation is the deliverable (DESIGN §2.6). The full procedure is in
the `pir-verify` skill; invoke it.

## Addressing the coordinator

The coordinator's name is `{repo} · {plan}` (DESIGN §2.8) — e.g. `plan-implement-review ·
parallel-pir`. You can build it yourself from the repo and the plan; you are not handed an id. The
coordinator passes you its name at spawn for clarity, but the scheme is what removes id-passing.

The separator is `·` (U+00B7), a middle dot, **not** `/`: the messaging layer rejects a name
containing `/` (DESIGN §2.8, FINDINGS). There is **no `@` prefix** either — the same layer rejects a
name that starts with `@` (T07 found this live, 2026-09-08). When you address the coordinator, use the
bare `{repo} · {plan}`.
