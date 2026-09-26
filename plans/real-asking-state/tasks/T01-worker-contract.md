# T01 — worker-contract

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Stop workers dropping a question report before an `ask`-bin action. pir shows a pending permission
request as `asking you` by itself, and in auto mode the prompt may never come, which is how T10's row
read `asking you` while it worked.

## Design sections this implements

DESIGN §2.3.

## Files

- `skills/pir-worker/SKILL.md`: the "Actions on the outside world follow their `DESIGN.md §5.3` bin"
  paragraph.
- `src/shell/*.test.mjs` only if a test pins the skill text (search for `kind=question task=Txx] report
  first`).

## Interface

The paragraph's `ask` sentence becomes, in substance: "`ask` you explain and then run in the same turn;
if the permission rule stops your session, pir shows the request to the person as asking, and they
approve or refuse it there. Do not drop a report for it." Keep the rest of the paragraph.

## Tests

- [ ] `grep -n "report first" skills/pir-worker/SKILL.md` finds nothing in the outside-actions paragraph.
- [ ] Any existing test that asserts skill wording still passes, updated if it pinned the removed line.

## Done when

- [ ] The skill no longer tells a worker to drop a report before an `ask` action.
- [ ] `./install.sh` run, and the new wording is in `~/.claude/skills/pir-worker/SKILL.md`.
- [ ] `npm test` green.

## Outside actions

- `./install.sh`, `worker` bin (DESIGN §5.3); not while a parallel run is live.
