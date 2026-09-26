# T06 — plan-box-drill

**Phase:** 2 · **Depends on:** T01, T05 · **Weight:** medium

## Goal

Use the whole feature as the person will, at every size, and judge it against DESIGN §2 and the
prototype: fix what has one right answer with a test each, and bring the person only choices with two
defensible answers. Then make it live with `./install.sh` once the code is on `main`.

## Design sections this implements

DESIGN §2 whole, §5 End to end; `pir-e2e` § drill.

## Files

- `src/shell/plan-rig.test.mjs` (the drill's cases), and whatever file a fix touches
- `plans/dashboard-plan-box/FINDINGS.md` (what the drill saw, written as worker-driven)

## Tests

- [ ] Each fix the drill makes comes with a test that failed before it.

## Done when

- [ ] Every interaction below was driven and passes, recorded in FINDINGS.md as worker-driven.
- [ ] `npm test` green; `./install.sh` run once the code is on `main` with no run live, and the new
      `list-view.mjs` present under `~/.claude/pir-engine/src/shell/`.

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` · sizes: 80×24, 120×40, 80×12
- [ ] 80×12 with more runs than rows: selection stays visible moving through all of them; `↑/↓ n more` correct.
- [ ] A brief long enough to pass 30% of the rows: the box stops growing, scrolls, the list stays visible.
- [ ] Every §2.5 refusal, each with its exact note, the text kept.
- [ ] A rig repo named `plan-implement-review` under `PIR_REPOS`: planning starts there with no flag set (T01).
- [ ] Ctrl+S Ctrl+S on a selected running row while a brief is typed: the stop happens, the brief survives.
- [ ] Two roots in `PIR_REPOS` with the same repo name: the ambiguous note names both paths.
- [ ] Every line at 80 columns fits; the hint and head lines read as §2.6.

## Outside actions

- Refresh the installed engine — `worker`
