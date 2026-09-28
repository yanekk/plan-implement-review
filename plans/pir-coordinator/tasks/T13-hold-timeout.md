# T13 — hold-timeout

**Phase:** 3 · **Depends on:** T04, T12 · **Blocks:** T15, T14 · **Weight:** medium

Added after T09 with the person's approval (2026-09-28). With no timeout (old DESIGN §2.11), an item the
agent was briefed but never decided stays `asking coordinator` for ever: not amber, not counted, Remote
Control off, so the person is never prompted and the worker idles. Several items briefed together (two
workers asking at once) are the likely way the real agent drops one; nothing tests that (see T14).

## Goal

An item the agent holds for longer than the hold limit without a decision becomes the person's
automatically, exactly as if the agent had passed it on, while the agent may still answer it until the
person does.

## Design sections this implements

DESIGN §2.3, §2.5, §2.11, as amended 2026-09-28.

## Behaviour (decided with the person, 2026-09-28)

- **Hold limit: 5 minutes**, counted from the pass the item was briefed and held. Overridable by
  `PARALLEL_COORDINATOR_HOLD_MS` (the live check T14 and tests shorten it); default `300000`.
- When the limit passes and the item is still waiting and held: it leaves `held`. The row reads
  `asking you`, it counts in the `asking you` tally, the footer points at it, the runs list turns amber,
  and the worker's Remote Control comes on, all as for a `pass`.
- The command tells the agent in one message (a new brief builder in `coordinator-brief.mjs`) that the
  item was handed to the person after 5 minutes without a decision, and that it may still answer it or
  pass it on with a pointer. The skill tells the agent to answer that message with a pointer in its reply
  (worker, task, what it would pick), as for a pass.
- **A late decision is accepted while the person has not answered** (first answer wins, the agent
  included). The agent's `permission`, `answers` or `message` for a timed-out item is applied as any
  decision; the row goes back to working and Remote Control goes off as after any answer. If the person
  answered first, the decision is refused as today ("already answered by the person").
- A late `pass` for a timed-out item changes nothing on screen; it is logged and its pointer stands.
- Reserved items are unaffected: they are the person's from the start.
- `control.log`: `coordinator-timeout <task>`. Ledger: one `timeout` line per item (item, held-for ms);
  a late decision's ledger line carries `late: true`. Neither is `notable`; the report's decisions
  section is unchanged.
- The time comes from the pass's `now`, never a clock read inside the policy code (CLAUDE.md core rule).
- The limit resets for nothing: an item that is briefed, times out and is still waiting is not re-held.
  An item that stops waiting and waits again (a new park) is a new item and is briefed afresh.

## Files

- `src/shell/coordinate.mjs` `route()`: record when each item is held; on each pass move items past the
  limit out of `held` and tell the agent; accept late decisions for items that were held.
- `src/shell/coordinator-agent.mjs`: the drain marks a decision for a timed-out item `late: true` in its
  ledger line. Accepting it needs no change: `route()` already passes every waiting item, held or not, to
  `drain`, and `checkDecision` accepts a decision for any of them.
- `src/core/coordinator-brief.mjs`: `timedOutFor(item, holdMs)`.
- `skills/pir-coordinator/SKILL.md`: replace "You have no timeout" with the hold limit, what the
  hand-over message means, and that a pointer is still owed.
- Tests beside each (`coordinate.test.mjs`, `coordinator-agent.test.mjs`, `coordinator-brief.test.mjs`,
  `coordinator-skill.test.mjs`).
- `docs/coordinator-agent.md` (§ Answer first "There is no timeout", § When the agent fails),
  `README.md` if it describes the agent holding questions.

## Tests

- [ ] With a fake agent that writes no decision: at `holdMs - 1` the item is held (`asking coordinator`);
      at `holdMs` the row reads `asking you`, the tally counts it, Remote Control is on, the agent got the
      hand-over message, and the ledger has a `timeout` line.
- [ ] Two items briefed in one pass, the agent answers one and not the other: only the unanswered one
      times out.
- [ ] Late decision after the timeout, person not answered: applied, row back to working, Remote Control
      off, ledger line `late: true`.
- [ ] Late decision after the person answered: refused with "already answered by the person".
- [ ] Reserved item: no timeout handling, no hand-over message.
- [ ] `PARALLEL_COORDINATOR_HOLD_MS` shortens the limit; absent, it is 5 minutes.
- [ ] Skill test: the skill no longer says there is no timeout and names the hand-over.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] `/docs` and `README.md` describe the hold limit and the late-answer rule.
- [ ] `./install.sh` run after the change.
