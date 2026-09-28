# T15 — answered-first-facts

**Phase:** 3 · **Depends on:** T13 · **Blocks:** T14 · **Weight:** light

Added after T09 with the person's approval (2026-09-28). In the T09 live run the harness, standing in for
the person, denied T02's reserved `git push` one second after it was asked. The agent's `pass` note landed
after that and was refused with the generic "nothing is waiting from worker … (unknown worker, or already
answered)" (`coordinator-policy.mjs:215`). The agent guessed "You most likely answered it in T02's
conversation already", and its pointer from the same turn had just told the person to go and answer it.
Reserved items are never `held`, so the command never sent `answeredElsewhere` for them.

## Goal

When an item the agent was briefed on (held or reserved) is answered by someone else first, the agent is
told plainly who answered it and what the answer was, once, and never has to guess.

## Design sections this implements

DESIGN §2.3 (first answer wins, the agent is told), §2.4 (reserved items briefed for a note), as amended
2026-09-28.

## Behaviour (decided with the person, 2026-09-28)

- Every briefed item, reserved or held, that stops waiting without a decision of the agent's is reported
  to the agent in one message on the pass the command sees it gone: who answered it and what they
  answered. Today only held items get this, and without the answer.
- The answer is read from the worker's conversation log (the `reply` or `message` event that closed the
  item: its `from` and its `result`), and stated in plain form: `allowed`, `denied` with its message, the
  chosen answers of a question set, or the text of a message.
- A decision the agent writes for an item already answered this way is refused with the same facts
  ("already answered by the person: denied"), not the generic "unknown worker, or already answered". The
  generic wording stays only for a worker that truly never had an item.
- The skill tells the agent: on this message, if its own last reply sent the person to answer the item,
  say in one line that it is already settled and how; otherwise say nothing about it. Never guess who
  answered.
- A timed-out item (T13) that the person then answers gets the same message.

## Files

- `src/shell/coordinate.mjs` `route()`: track reserved briefed items like held ones for this purpose
  (without holding them: the row, the tally and Remote Control are unchanged).
- `src/shell/coordinator-agent.mjs`: find the closing answer in the worker's log; `answeredElsewhere`
  carries it; the drain's refusal for a known-answered item carries it.
- `src/core/coordinator-brief.mjs`: `answeredElsewhereFor(item, answer)` states who and what.
- `src/core/coordinator-policy.mjs`: the refusal text for a known-answered item.
- `skills/pir-coordinator/SKILL.md`: the rule above.
- Tests beside each (`coordinate.test.mjs`, `coordinator-agent.test.mjs`, `coordinator-brief.test.mjs`,
  `coordinator-policy.test.mjs`, `coordinator-skill.test.mjs`).
- `docs/coordinator-agent.md` § Answer first (the first answer wins, the agent is told who and what).

## Tests

- [ ] Reserved permission denied by the person before the agent's note: the agent gets one message
      naming the person and `denied`; its late `pass` is refused with the same facts; nothing else
      changes (row, tally, Remote Control).
- [ ] Held question set answered by the person first: the message names the chosen answers.
- [ ] Report park answered by the person's message: the message quotes the text.
- [ ] A decision for a worker that never had an item still gets the generic refusal.
- [ ] Each item is reported at most once, across passes.
- [ ] Skill test: the skill names the rule and forbids guessing who answered.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] `/docs` says the agent is told who answered and what.
- [ ] `./install.sh` run after the change.
