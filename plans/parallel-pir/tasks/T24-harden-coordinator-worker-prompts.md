# T24 — Harden the coordinator and worker prompts from the T18 transcripts

**Phase:** 6 · **Depends on:** T18 · **Weight:** medium · **Runs:** auto

## Goal

The first live `single` run (T18, 2026-09-12) passed, but its captured transcripts show every agent
improvising around gaps the skills leave open — the coordinator most of all, because `pir-coordinate`
describes the file bridge as an idea and leaves the operational mechanics (how to poll, how to
de-duplicate the outbox, how to tell two identically-named workers apart during the hand-off, how to
append a message safely, what counts as "done") for the agent to invent mid-run. This task applies the
concrete edits below to the two skill files so a fresh agent is taught what the rules already require
instead of rediscovering it live. It changes no design rule and no `src/` — it is prose hardening,
reviewed like any `auto` task. Verifying it is a live re-run of `single` that the user drives with the
implementer afterwards (see *After this task*), not part of this task.

## Design sections this implements

DESIGN §2.2 (coordinator name, hello), §2.3 (lifecycle, idle-gated close), §2.5 (decisions routed
through the coordinator), §2.8 (naming and addressing), §2.9 (task-branch worktrees), §4.1 (the live
harness). No rule changes; the edits make the skills teach what these sections already require.

## Files

- `skills/pir-coordinate/SKILL.md` — edits C1–C6, and the shared W4.
- `skills/pir-worker/SKILL.md` — edits W1–W4.

No other files. If an edit seems to need a `src/` change to be true, that is a finding, not a silent
scope jump — see *After this task*.

## The edits

Flat prose, matching each skill's existing register. Each edit cites the T18 friction it closes.

### Coordinator — `skills/pir-coordinate/SKILL.md`

**C1 — Drive off the flow log and control files, never the bin's stdout.** Into "The loop you run" (or
a new subsection right after it): the bin's stdout is **block-buffered when you run it in the
background**, so its printed progress and `DECISION NEEDED` lines can lag by minutes or not appear
until it exits. Ground truth each turn is the flow log `plans/{slug}/.parallel/control/log` (one line
per action: `open-feature`, `spawn`, `hello`, `review`, `merge`, `surface`, `close`, `promote`,
`teardown`) and the control files — read the log every turn, not the banner. A new `surface Txx` line
is your cue a decision for `Txx` is waiting. (T18 friction E/F, and the latent decision-relay risk:
stdout never flushed past the banner, so a coordinator relying on it would have missed any decision
text.)

**C2 — The run is done when the log says so; report it.** State: the run is finished when the flow log
shows `promote …` (or a HALT / nothing-left banner), not when the last worker message arrives. On that
line, report the outcome to the user and stop — do not end your turn at the reviewer's `done` assuming
the bin promoted silently. (T18 friction H: the capture ended at the `done` hand-off with no
completion report.)

**C3 — Poll on a cadence; prefer Monitor over bare `sleep`.** State: run the bin in the background and
poll — do not block one tool call on it. Re-read the flow log on a short cadence (≈15s); prefer the
Monitor tool with an until-condition on the log growing over hand-rolled `sleep` of guessed length.
(T18 friction G.)

**C4 — The outbox is append-only; track a cursor; append to the inbox safely.** Into the bridge
section: the outbox is append-only and owned by the bin — never truncate or edit it. Track how many
lines you have already delivered (a cursor) and `SendMessage` only the new ones. Append an inbound
worker message to the inbox by **writing the JSON object to a temp file and `cat`-ing it onto the
inbox** — never inline the message text into a shell command, because worker messages contain
backticks, newlines and emoji that break `node -e`/`echo`. (T18 friction C/D.)

**C5 — Two workers share a name during the hand-off; the reviewer is the newest.** Into the
naming/bridge section: during the implement→review hand-off the old implementer and the fresh reviewer
are **both live under the same name `{repo} · {plan} · Txx`** for a short window, so a `SendMessage`
addressed by that name returns an ambiguity error listing two refs. The fresh reviewer is the
more-recently-spawned session — the one whose `review Txx` line just appeared in the log; send to its
`[ref]`. You will also see **one hello per spawn** — one for the implementer and a second,
identical-looking one for the reviewer of the same task; that is expected, deliver each to the session
the bin just spawned. (T18 friction A/B — the biggest near-miss.)

**C6 — Task state lives on task branches; plan-branch PROGRESS lags.** State: a worker commits its
🔍/✅ update on its own task branch, not the plan branch, until the bin merges it. So the plan-branch
`PROGRESS.md` shows a task as ⬜ while a worker is actively building it — that is expected, not a
stall. Read worker status from `claude agents --json` and the flow log, not from plan-branch PROGRESS.
(T18 friction F.)

### Worker — `skills/pir-worker/SKILL.md`

**W1 — Document the worktree path shape.** Into "Where you run": your worktree root is
`{repo}/.claude/worktrees/{branch}/` on branch `pir/{plan}-T{nn}`. The `Read`/`Edit`/`Write` tools need
absolute paths, and you must build them under *that* root — get it from `git rev-parse --show-toplevel`,
never from the repo's own layout, or you will touch the wrong checkout. (The T18 reviewer `Read` the
plan-branch PROGRESS instead of its worktree copy for exactly this reason and had to self-correct.)

**W2 — Derive your plan slug from your branch, not from `plans/`.** Into "You do exactly what the
coordinator sends": the coordinator names your task (`pir-implement T05`) but may not name the plan
slug. Do not guess it from the only folder under `plans/` — derive it from your branch name
`pir/{plan}-T{nn}` (`git branch --show-current`). (The T18 implementer inferred `single` from
`ls plans/`, which only worked because one plan was present.)

**W3 — Do not reply to a hello.** Change the hello section from "you may reply once" to: **do not reply
to a hello.** It asks nothing of you, it has no valid reply kind (the kinds are `question`, `decision`,
`implemented`, `done`, `conflict`), and it may arrive *after* you have already reported done — a reply
then sends a spurious second signal. Ignore it and get on with, or finish, your task. (The T18
reviewer replied to a late hello with a second `kind=done`.)

**W4 — Give the exact SendMessage call (both skills).** In both `pir-worker` and `pir-coordinate`,
state the canonical send verbatim: `SendMessage({to: "<name>", message: "<text>"})` — exactly those
two fields, no `recipient`/`content` or other field names. (All three T18 agents fetched the schema via
ToolSearch and then still hedged by filling duplicate field names.)

## Tests

- [ ] `npm test` stays green — these are prose edits and touch no code, so the boundary scan and the
      suite are unaffected. A red suite means an edit strayed into a file it should not have.

## Done when

- [ ] C1–C6 and W1–W4 are applied to the two skill files, flat prose, matching each skill's register,
      each landing next to the rule it clarifies rather than as a bolted-on appendix.
- [ ] No edit contradicts `DESIGN.md` or the other skill; where a fix is only fully achievable with a
      `src/` change (C1's decision-text relay off stdout; C5's outbox ambiguity), the prompt states
      the stopgap and the `src/` change is left for the live iteration to decide — not built here.
- [ ] `npm test` green.

## After this task

This task is **not** self-verifying: prose that governs live behaviour is only proven by a live run.
Once T24 is reviewed ✅, the user and the implementer run `node src/shell/harness/run.mjs single`
**together** and iterate on the prompts until each improvised T18 workaround is gone — the coordinator
drives off the log (C1) and reports the promote (C2), the shared-name send resolves without a failed
attempt (C5), no "is it stuck?" turn over plan-branch PROGRESS (C6), the worker derives slug and paths
cleanly (W1/W2), never `Read`s the wrong checkout, does not reply to the hello (W3), and no agent
hedges the SendMessage fields (W4). `single` exercises all of these except a surfaced decision (only
`human-decision` does) and a merge conflict (only `merge-conflict` does), so C1's decision-relay half
and the conflict path are confirmed by those fixtures later. If the C1/C5 stopgaps prove insufficient
in iteration, the two `src/` changes above become their own follow-up task. The five fixtures (T19–T23)
are gated on T24 so none runs until this hardening is in.
