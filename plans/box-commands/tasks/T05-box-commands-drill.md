# T05 — box-commands-drill

**Phase:** 2 · **Depends on:** T04 · **Weight:** medium

## Goal

Use the whole box as the person will, at every size, and judge it against DESIGN §2 and the prototype:
fix what has one right answer with a test each, and bring the person only choices with two defensible
answers. Then make it live with `./install.sh` once the code is on `main`.

## Design sections this implements

DESIGN §2 whole, §5 End to end; `pir-e2e` § drill.

## Files

- `src/shell/plan-rig.test.mjs` (the drill's cases), and whatever file a fix touches
- `plans/box-commands/FINDINGS.md` (what the drill saw, written as worker-driven)

## Tests

- [ ] Each fix the drill makes comes with a test that failed before it.

## Done when

- [ ] Every interaction below was driven and passes, recorded in FINDINGS.md as worker-driven.
- [ ] `npm test` green; `./install.sh` run once the code is on `main` with no run live, and `plan-scan.mjs` present
      under `~/.claude/pir-engine/src/shell/`. Built in parallel (on a task branch): no install; PROGRESS
      "Blocked on the user" says `./install.sh` follows the merge (DESIGN §5).

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` · sizes: 80×24, 120×40
- [ ] The success-criteria path of DESIGN §1: three letters and Enters only, from `@` to the build's live view.
- [ ] Every §2.4 refusal, each with its exact note, the text kept.
- [ ] Every §2.5 head line, and the hint on bare, typed `/plan`, typed `/start` and with a chord armed.
- [ ] Esc with each pop-up open, then Esc again; the pop-up never reopens on its own after Esc or a slug pick.
- [ ] A rig repo with no buildable plan: `/start ` shows `nothing to build in …` and no pop-up.
- [ ] Every line at 80 columns fits, including the slug pop-up with an 18-character slug and `· building`.

## Outside actions

- Refresh the installed engine — `worker`
