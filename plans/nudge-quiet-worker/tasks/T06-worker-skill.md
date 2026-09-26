# T06 — worker-skill

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

Teach every parallel worker what a `[pir:nudge n/max]` message is and how to act on it, and correct
the skill's statements that the conflict fix is the only message `pir` may send. A worker that does not
recognise the nudge may reply to it, ask the person about it, or treat it as a new instruction, which
would defeat the feature.

## Design sections this implements

DESIGN §2.5, Stance.

## Files

- `skills/pir-worker/SKILL.md`: a new section, and edits to the lines that name the conflict fix as the
  one later message from `pir` (today the opening paragraph, "so may one later message from `pir` (a
  merge-conflict fix, below)" and "that one message from `pir` if it comes", and the report section,
  "The one message `pir` itself may send you after your opening instruction is a merge-conflict fix").

## Interface

The new section says, in the skill's own register:

- A message starting `[pir:nudge` comes down the same line as the opening instruction, sent by `pir`
  automatically, never by the person. It is sent when you have shown no progress for a while.
- Act on it; do not reply to it, and do not ask the person about it.
- Check whether a background command, Monitor, watcher or wait-loop is holding you. Stop the ones you
  no longer need, following the existing rule about not `pkill -9`-ing a wrapper. Then continue the
  task you were given.
- If the work is finished, drop the report as this skill already says.
- If you are waiting on the person's answer to a question you already asked in plain text, drop the
  question report if you have not, and keep waiting. The nudge never means "stop waiting and guess".
- It is not a new instruction and not a change of task, and it does not relax any rule in this skill.
- Only your own progress stops further nudges (a changed worktree or a report); a reply does not.

The opening lines become accurate: `pir` may send you a merge-conflict fix or a `[pir:nudge …]`, and
nothing else; the person may also talk to you in your session. Reports still go up by file drop only.

## Tests

- [ ] `npm test` stays green. `planner-templates.test.mjs` and any test that scans skill text must
      still pass; if one pins the "one message" wording, update it to the new wording rather than
      deleting it.
- [ ] The tag in the skill matches the prefix `nudgeMessage` produces (T02), checked by a small test
      that reads both.

## Done when

- [ ] The section exists and covers every bullet above; no line in the skill still says the conflict
      fix is the only message `pir` may send.
- [ ] The tag-match test passes in `npm test`.
- [ ] `./install.sh` has run (no parallel run live) and `grep 'pir:nudge'
      ~/.claude/skills/pir-worker/SKILL.md` finds the section.

## Outside actions

- refresh-install — `worker`
