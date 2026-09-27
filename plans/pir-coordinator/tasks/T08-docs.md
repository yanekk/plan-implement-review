# T08 — docs

**Phase:** 3 · **Depends on:** T02, T04, T05, T06 · **Weight:** light

## Goal

Carry what was built into the places a reader looks: `/docs` (canonical behaviour), `README.md` (what
a user gets), `CLAUDE.md` (the rules every session obeys, amended for the stand-in), and the worker
skill (a worker's answer may come from the coordinator agent). Say only what the code does.

## Design sections this implements

DESIGN §2 throughout, §2.6 (CLAUDE.md amendment), §8 (limits a reader would otherwise assume away).

## Files

- `docs/coordinator-agent.md` (new): what the agent is, its two rule layers, answer-first, what is
  reserved, passing on, its conversation and Remote Control, the ledger, the end sequence and
  `ready to merge`, `--no-coordinator`, known limitations.
- `docs/README.md` (components list and document index), `human-flow.md` (who answers first; the
  pointer), `run-lifecycle.md` (the new end), `control-folder.md` (`coordinator/`), `restart-recovery.md`
  (agent resume, ready-to-merge restart), `detached-runs.md` (`--no-coordinator`, the coordinator
  conversation key, the `ready to merge` label), `branch-model.md` (main merged into the feature branch
  before the hand-off; `REPORT.md`).
- `README.md`: the coordinator agent as a user-facing feature, with a link.
- `CLAUDE.md` of this repo, and the method text `install.sh` appends to other projects if it is a
  separate copy: "Who decides what" and the task-adding paragraph name the coordinator agent as the
  person's stand-in in a parallel run, within its reserved limits.
- `skills/pir-worker/SKILL.md`: an answer to the worker's question may come from the coordinator agent
  on the person's behalf; approval to add a task likewise.

## Tests

- [ ] Any existing doc or skill text test (`planning-skills.test.mjs` style) still passes; add one
      asserting `pir-worker` mentions the coordinator agent.

## Done when

- [ ] Every file above describes the built behaviour; nothing claims more than the code does.
- [ ] `grep -rn "never merges to main\|coordinator agent" docs README.md CLAUDE.md` reads consistently.
- [ ] `./install.sh` run; the installed `pir-worker` skill has the new line.
