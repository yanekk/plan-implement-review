# {Project} — Design

> **Template.** Written by `/pir-plan`, read by every session that touches the behaviour it
> governs. **It is a maximum, not a form.** Delete a section that does not apply rather than
> writing "n/a" into it, and never pad one to look complete.
>
> **Every rule here carries its reason — in a sentence.** A rule without one gets overturned
> by the first session that finds it inconvenient. A rule with three paragraphs under it does
> not get read at all, which costs the same. Dense where something is surprising, silent
> where it is not.
>
> **Flat prose.** No bold-per-clause, no em-dash asides, no sentence that is there to sound
> right. This file is read in full by every session that touches the behaviour, so every
> ornamental line is paid for again on every run.

## 1. Purpose

What this is for, who it is for, and the problem it exists to solve. One or two paragraphs.

### Success criteria

Concrete enough to be checkable. Three to five lines.

### Stance

The opinions this design takes and would not trade away — the things that would make it a
different product if they changed.

---

## 2. Behaviour specification

The rules, one subsection per area, **each with its rationale attached**. This is the part
task docs point back at, so number the subsections and keep the numbers stable: they get
cited from `tasks/`, from `PROGRESS.md` and from commit messages.

### 2.1 {The core model}

What it does. Why it does that and not the obvious alternative.

### 2.2 {…}

### 2.n The unhappy paths

Offline, corrupt file, two copies at once, crash mid-write, wrong input, the user doing
something nobody planned for. **Most of the real requirements live here** — a rule for each,
with what it costs.

---

## 3. Architecture

### 3.1 The boundary

```
{pure/}     — takes inputs as parameters, returns decisions. No clock, no I/O, no network.
{shell/}    — everything platform-shaped.
```

Which side each module sits on and why. **What enforces it** — name the test that scans the
pure side for forbidden imports, and say plainly: if that test fails the fix is to move the
code, never to relax the test.

The reason, in one line worth keeping: everything on the pure side is testable exhaustively
in milliseconds, and every rule that leaks across becomes a rule only a person can check.

### 3.2 Modules

One line each: what it owns, what it depends on.

### 3.3 The decision function

If there is one place where the whole behaviour comes together, describe it here — its
inputs, its output, and the fact that it is a function of its arguments and nothing else.

### 3.4 Data flow

### 3.5 Storage

Where state lives, in what format, and what happens to it on a crash mid-write.

---

## 4. Testing

What the layers are, what each proves, and what none of them can prove.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | |
| Language / runtime | |
| Toolchain | |
| **Deliberately absent** | *(what is not installed, so nobody proposes a workflow that needs it)* |

**The test command.**

```
{the one command}
```

**It is the only evidence a session may produce on its own.** If the obvious command does not
work here, say which one does and why — the next session will otherwise rediscover it.

**A parallel run executes this block.** When every task is done, `pir {slug}` runs each line of
the fenced block above, in order, on the finished branch, and hands the branch over only if all of
them pass. So the block holds exactly the commands that make up the suite: one line per suite is
fine, but a verbose or debugging variant goes in the prose, not in the block, or it runs too.

**It must be cheap to read when it passes.** The dominant caller is a session that reads all
of its output, and a passing run that prints a line per assertion is thousands of lines of the
word `ok` re-read on every review; the exit code already carries the result. Make three things
the default in the command itself — a flag that has to be remembered saves nothing:

- **Quiet.** One summary line per suite (`agenda-test: 637 ok`), full detail on every failure
  unchanged. Say here how verbose output is turned back on for a person debugging.
- **No colour.** ANSI escapes tokenize badly, and `FORCE_COLOR`, `CI` and `CLICOLOR_FORCE`
  force colour even when output is piped, overriding `NO_COLOR`. Turn it off inside the command
  (`FORCE_COLOR=0`, `--no-color`, `--color=never`) rather than trusting the caller's
  environment, and record here what was forcing it.
- **Loud on failure.** Failures print in full — message, file and line, diff, stack — the exit
  code stays 0 on pass and non-zero on failure, and any machine-readable CI path (JUnit XML,
  TAP) stays intact.

**Dependencies.** What may be added and what may not, decided once rather than one library at
a time under pressure.

### 5.1 What the test command cannot reach

Each row is something only a person can establish. Add to it whenever the build finds
another.

| Cannot be tested automatically | Why it needs a person |
|---|---|
| | |

### 5.2 Seatbelts

For anything that could take the machine, the screen, the account or real money: the bound
that makes it safe to run.

| Flag / mechanism | Default | Effect |
|---|---|---|
| | | |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** The seatbelt is what stands between a test and a power cycle.

### 5.3 Outside the code — who acts

*(Delete if the plan touches nothing outside this repo and this machine. Otherwise one row per
action on the live world: a cloud account, a paid API, a domain, a store listing, a real device, a
message someone else receives.)*

Every action here sits in one of three bins. The bin is what a worker obeys, and
`/pir-review-plan` turns it into the project's permission rules in `.claude/settings.json`, so the
machine enforces it rather than a session's good intentions.

| Bin | Who runs it | Permission rule |
|---|---|---|
| `worker` | The worker, then tells the person in one line | `allow` |
| `ask` | The worker, after explaining it. The machine's permission prompt is the person's yes | `ask` |
| `person` | The person. Only for what a person physically must do: a login, a device, a screen to judge | none |

**The hard lines put an action in `ask`**: it cannot be undone, it costs more than the task
expects, other people can see or receive it, or it changes the infrastructure itself rather than
the code running on it. The person may move one action down to `worker` at plan review, and only
there; the row then says so with the date and the reason. **A worker never hands the person a
command to paste for anything outside the `person` bin.**

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| | | | | | | |

- **Command** is a project script (`npm run deploy:web`, `make teardown`), not the raw tool, so a
  permission rule covers exactly this action and cannot be stretched by extra flags.
- **Login check** is a read-only command that succeeds only while the credential is live
  (`aws sts get-caller-identity --profile admin`). The worker runs it before any `worker` or `ask`
  action; if it fails, the login is a `person` step and the worker waits, then carries on itself.
- **Credentials present on this machine**, measured at plan time and re-measured at plan review:
  which profiles or tokens exist, never their secrets. A plan that assumes a credential is absent
  without checking hands the person work a worker could have done.

---

## 6. Recovery

If this thing can lock someone out, break something, or leave state behind: the way back,
written for somebody under pressure who is not reading the code.

---

## 7. Decisions and rationale

The choices that were made deliberately, what the alternative was, and why it lost. Anything
the user changed their mind about goes here with the date.

---

## 8. Explicitly out of scope

What is deliberately not being built, **each with its reason**. A declined feature that keeps
getting re-proposed costs more than one that was refused in writing.
