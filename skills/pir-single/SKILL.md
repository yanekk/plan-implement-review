---
name: pir-single
description: The procedure the two sessions of a single run follow, a small change `pir` makes without a plan. Engaged by the opening instruction `pir` gives the builder's or the reviewer's session ("You are run by `pir single`"); never typed by a person. The builder makes the change, commits it, names the branch and reports; the reviewer, a fresh session, reads the change against what was asked, fixes what it finds and reports. `pir` runs the tests itself after each report.
user-invocable: false
---

# single

**This skill applies only when your opening instruction contains the sentence "You are run by `pir
single`".** It is never typed by a person. The instruction says which role you hold: "run it as the
builder" or "run it as the reviewer of pir/{name}". Read *What binds both sessions*, then your role's
section, then *After you report* and *Dropping a report*.

## What a single run is

A single run is a small change made without a plan: a bug fix, a typo, a small modification. The
person typed what they want; `pir` cut a branch in its own worktree, ran the project's setup there,
and holds two sessions one after the other:

1. the **builder** makes the change, commits it, chooses the branch's name and reports `built`;
2. `pir` runs the project's tests on that commit;
3. the **reviewer**, a fresh session that did not see the change being written, reads it against
   what was asked, fixes what it finds, commits and reports `reviewed`;
4. `pir` runs the tests again, then shows the person the command that merges the branch.

No plan is written: there is no `PROGRESS.md`, no `FINDINGS.md` and no task doc. The commits and
this conversation are the whole record.

Your opening instruction carries everything a plan would have given you:

- the **reports folder**, an absolute path. The sentence ends with a full stop after it
  (`Reports folder: /…/reports. Starting point: …`); the stop is not part of the path;
- the **starting point**, `{base} at {sha}`: the base branch and the commit the run's branch was cut
  from;
- the **change**, the person's own words, after `The change:` or `The change that was asked for:`.

## What binds both sessions

**Where you run.** You are in the run's own worktree, on its `pir/…` branch, not in the main checkout.
`CLAUDE.md § Where sessions run` ("main checkout, base branch, always; stop if you find yourself in a
worktree") does not bind a session run by `pir single`, exactly as it does not bind a build worker.
Do not stop on contact with it. Work only in this worktree and only on this branch: get its root from
`git rev-parse --show-toplevel` and keep every path you read or write under it. Do not create or edit
a file under `.git` yourself (no Write or Edit there, no redirect into it), because Claude Code never
auto-approves such a write and your session would stall on it. Git's own commands are fine:
`git commit`.

**Never merge, rebase, push, or touch the base branch.** Do not switch to the base branch, do not
merge or rebase onto it, do not push anything, and do not rename or delete the branch or the
worktree. `pir` renames them to the builder's name after the build; the person merges by hand at the
end. If the base branch has moved on since the run started, leave it: the person's merge handles it.

**Scope is the prompt.** Change only what the prompt asks for. Anything else you notice (a second
bug, a stale comment, a tidier way) you tell the person about and leave alone. If the change cannot
be made without widening it, say so and ask before you widen it; never widen it quietly. If it turns
out to be too big for a single run (it needs decisions, several steps, or a design), tell the person
and recommend they plan it with `/plan`; see *Dropping*.

**Asking.** There is no stand-in: the person answers every question and every permission request.
Ask in this conversation, in plain English, with AskUserQuestion when the answer is a choice between
options (your recommendation first, marked `(Recommended)`). Questions are never reported as files;
`pir` shows the person that you are asking. Every question stands alone: the person sees the messages
you write and the question form and nothing else, never your reasoning, so whatever they choose
between is spelled out in the question, its options, or a message you wrote just before it. Do not
use an option's `preview` field: `pir` does not show it. Then end your turn and wait for the answer.

**The tests are pir's.** `pir` ran the project's setup in this worktree before you started, and it
runs the setup and test commands itself after each report, from settings the person chose. Green is
`pir`'s word, never yours: you may run a test to check your own work, in the foreground, leaving
nothing running and no file behind that git does not ignore, but do not tell the person the tests
pass on the strength of it. If your opening instruction ends with a note that the setup failed, read
it, get the worktree ready yourself (usually by re-running the failing line), and carry on; ask the
person only when the fix lies outside the worktree.

**Commit before you report, and leave the worktree clean.** `pir` never commits for you. Before any
`built` or `reviewed` report, `git status --porcelain` prints nothing.

## The builder

1. **Understand.** Read the prompt and the code it touches. If what it asks for is unclear, or there
   is a real choice about how it should behave, ask the person and wait. If what it describes is
   already done, or is not there at all, say what you found and see *Dropping*.
2. **Make the change**, and only it. Add or adjust the tests the change needs, as the project's own
   rules say.
3. **Choose the name.** The run is called `single-{hex4}` until you name it; your name becomes the
   branch `pir/{name}`. Choose a short kebab-case name for the change (`fix-readme-typo`), and check
   it is free before you use it, by the three checks:
   - no `plans/{name}/` on the base branch: `git ls-tree -d {base} plans/{name}` prints nothing and
     exits 0, with `{base}` the base branch your opening instruction names;
   - no branch `pir/{name}`: `git branch --list pir/{name}` prints nothing;
   - it is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) and of neither form `single-{hex4}` nor
     `plan-{hex4}` (the word, a dash and four hex characters), which are the names `pir` gives a run
     before it has one.

   If a check fails, choose another name. You choose it yourself; the person is not asked.
4. **Commit** on this branch, with the message `single({name}): <what the change does>`.
5. **Report `built`** (*Dropping a report*) with the name, tell the person in a line or two of plain
   English what you changed, and stop. Do not name a next command and do not review your own work:
   `pir` runs the tests and then starts the reviewer.

`pir` checks a `built` report against the branch: the name well-formed and free, at least one commit
beyond the starting commit, the worktree clean. If a check fails, `pir` sends you a message naming
it. Fix what it names (for a taken name choose another; the commit already made keeps its message),
then report again.

## The reviewer

You did not write this change, and that is the point. Your opening instruction names the branch,
`pir/{name}`; the worktree you are in is already on it.

1. **Read the change against the prompt.** `git log {sha}..HEAD` and `git diff {sha}..HEAD`, with
   `{sha}` the starting commit your opening instruction names. Read the files the diff touches, not
   only the diff. Ask of it: does it do what the prompt asked, all of it and nothing more; is it
   correct, edge cases included; does it carry the tests it needs; does it follow the project's own
   rules.
2. **Fix what has one right answer** yourself: a bug, a missed case, a missing test, a change that
   went beyond the prompt. You fix; you do not send it back to the builder.
3. **Ask the person about the rest**: anything where either answer is defensible, or where the
   change does something the prompt did not settle. One decision at a time, then wait.
4. **Commit** each fix with the message `single({name}) review: <what the fix does>`. A review that
   finds nothing commits nothing.
5. **Report `reviewed`** with the run's name, tell the person in plain English what you found and
   fixed (or that it was clean), and stop. Do not merge and do not tell the person the tests pass:
   `pir` runs them and then shows the merge command itself.

`pir` checks a `reviewed` report: the worktree clean and the name the run's own. If you committed
nothing, the builder's green result stands and `pir` does not run the tests again.

## After you report

**Wait for pir's word, and change nothing until it arrives.** After a `built` or `reviewed` report,
end your turn and go idle with nothing running. Do not edit, commit or tidy while `pir` tests: a
green result counts only for the commit it tested with a clean worktree, so an edit made meanwhile
costs a whole further test run. What arrives next is one of:

- **Nothing.** The tests were green; `pir` closes this session. You are done.
- **A failed check**, beginning `pir did not accept your … report`. Fix what it names, commit, and
  report again.
- **Red tests**, beginning `pir ran the tests on your commit … and they failed`, with the round
  number, a log path and the last lines of the log. It also says whether the tests fail on the
  untouched starting point: if they pass there, this change broke them; if they fail there too, the
  failure may be older than the change, and you say so to the person rather than widening the change
  to repair it. Fix it, commit, and report again with the same header.
- **Red tests past the limit.** A step gets 3 rounds. From round 4 the message ends `past the limit
  of 3`: stop, tell the person what fails and what you tried, and ask how to go on. Report again only
  after they answer.

The person may also write to you at any time; answer them and act on what they say.

## Dropping

`dropped` ends the run with nothing to merge. Either session may report it, and **only after the
person agreed to it in this conversation**; never on your own judgement. There are two reasons:

- **The change is too big for a single run.** Tell the person why and recommend they plan it with
  `/plan`. With their agreement, report `dropped`; the body recommends `/plan`.
- **There is nothing to change**: it is already done, or what the prompt describes is not there.
  Tell the person what you found. With their agreement, report `dropped`; the body says what was
  found.

The first line of the body is shown to the person on the run's screen, so make it say the reason on
its own. The branch and whatever is committed on it stay.

## Dropping a report

A report is one small file in the reports folder your opening instruction named. Drop it in one Bash
command, with no intermediate file: the message goes over a quoted heredoc, and `node` writes it
temp-then-rename so `pir` never reads a half-written file. The terminator `PIR_EOF` sits at the start
of its line. The second argument is your role, `builder` or `reviewer`, recorded as `from`:

```
node -e 'const fs=require("fs"),p=require("path");const d=process.argv[1];fs.mkdirSync(d,{recursive:true});const f=p.join(d,Date.now()+"-single-"+Math.random().toString(36).slice(2)+".json");const t=f+".tmp";fs.writeFileSync(t,JSON.stringify({from:process.argv[2],text:fs.readFileSync(0,"utf8")}));fs.renameSync(t,f)' "<reports folder>" "<builder or reviewer>" <<'PIR_EOF'
[pir:v1 kind=built single={name}]
<one or two plain lines: what the change is>
PIR_EOF
```

The first line is the header `pir` reads, exactly; the body is for the person. The three reports:

```
[pir:v1 kind=built single={name}]
[pir:v1 kind=reviewed single={name}]
[pir:v1 kind=dropped single=-]
```

- `built`, from the builder: the change is committed on this branch and `{name}` is the name you
  chose for it.
- `reviewed`, from the reviewer: the review is done and every fix is committed. `{name}` is the
  run's name, the one in `pir/{name}`.
- `dropped`, from either, with the person's agreement (*Dropping*). The name is a dash.

A report of the other role's kind is ignored, so the builder never drops `reviewed` and the reviewer
never drops `built`. Nothing answers the report itself; what `pir` does next is in *After you report*.
