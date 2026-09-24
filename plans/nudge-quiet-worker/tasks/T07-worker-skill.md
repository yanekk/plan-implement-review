# T07 — worker-skill

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

Teach every parallel worker what a `[pir:nudge n/max]` message is and how to act on it, and correct
the skill's statements that nothing ever messages a worker. A worker that does not recognise the nudge
may reply to it, ask the person about it, or treat it as a new instruction, which would defeat the
feature.

## Design sections this implements

DESIGN §2.5, Stance.

## Files

- `skills/pir-worker/SKILL.md`: a new section, and edits to the lines that say nothing messages the
  worker (currently around "there is no channel back and nothing sends you anything", "nothing
  messages you now").

## Interface

The new section says, in the skill's own register:

- A note starting `[pir:nudge` comes from the run's coordinator automatically, never from the person.
  A hook shows it (after a tool call, or by waking the session), or it arrives as the message a stopped
  session is resumed with. It is sent when the worker has shown no progress for a while.
- Act on it; do not reply to it, and do not ask the person about it.
- Check whether a background command, Monitor, watcher or wait-loop is holding you. Stop the ones you
  no longer need, following the existing rule about not `pkill -9`-ing a wrapper. Then continue the
  task you were given.
- If the work is finished, drop the report as this skill already says.
- If you are waiting on the person's answer to a question you already asked, drop the question report
  if you have not, and keep waiting. The nudge never means "stop waiting and guess".
- It is not a new instruction and not a change of task, and it does not relax any rule in this skill.
- Only the worker's own progress stops further nudges; a reply does not.

The "nothing messages you" lines become accurate: the person may talk to you in your session, and the
coordinator may show you `[pir:nudge …]` and nothing else. Reports still go up by file drop only.

## Tests

- [ ] `npm test` stays green. `planner-templates.test.mjs` and any test that scans skill text must
      still pass; if one asserts "nothing messages you", update it to the new wording rather than
      deleting it.
- [ ] The tag in the skill matches the prefix `nudgeMessage` produces (T02), checked by a small test
      that reads both.

## Done when

- [ ] The section exists and covers every bullet above; no line in the skill still says a worker is
      never messaged.
- [ ] The tag-match test passes in `npm test`.
- [ ] `./install.sh` has run and `grep 'pir:nudge' ~/.claude/skills/pir-worker/SKILL.md` finds the
      section.

## Outside actions

- refresh-install — `worker`
