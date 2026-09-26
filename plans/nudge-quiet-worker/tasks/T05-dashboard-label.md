# T05 — dashboard-label

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Show the person, at a glance, that a worker is being nudged or has been marked stuck, without pulling
them in: the row label gains `· nudged N×` or `· stuck`. It is a display change only; T04 puts the
fields on the run-state task.

## Design sections this implements

DESIGN §2.6.

## Files

- `src/core/display.mjs`: `rowFor` appends the suffix to an active row's label, for the plain phase
  labels and for `fixing conflict` (`isFixingConflict`).
- `src/core/display.test.mjs`
- `src/shell/render.mjs` / `render.test.mjs`: the label column is `padEnd(24)` (render.mjs, the row line
  the `pir` watch view also draws). `reviewing · nudged 2×` is 21 characters and fits;
  `fixing conflict · nudged 2×` is 27 and does not. Keep the elapsed column aligned for the longest
  real label, without changing any row that carries no suffix (live-workers §2.11: the screens look as
  before).

## Interface

```
run-state task (input, set by T04's buildRunState): { …, nudges?: number, stuck?: boolean }
rowFor(active task), base = PHASE_LABEL[phase] or 'fixing conflict':
  stuck            → label `${base} · stuck`
  nudges > 0       → label `${base} · nudged ${nudges}×`
  otherwise        → unchanged
kind is unchanged (building / reviewing / fixing-conflict), so running counts and styles are unchanged.
```

`asking` (every `asking you · …` label) and `merging` rows never carry the suffix. T04 never nudges
those phases, and the display must not show a suffix there either.

## Tests

- [ ] `building` with `nudges: 1` → `building · nudged 1×`; `reviewing` with `nudges: 2` →
      `reviewing · nudged 2×`; a fixing-conflict row with `stuck: true` → `fixing conflict · stuck`.
- [ ] `stuck: true` → `building · stuck`, whatever `nudges` says.
- [ ] `nudges: 0` or absent → label unchanged (every existing display test still passes).
- [ ] `asking you · …` and `merging` rows ignore the fields.
- [ ] The `running` count is unchanged by a stuck row.
- [ ] The rendered row keeps its elapsed column aligned with the longest label, and a row with no
      suffix renders exactly as before.

## Done when

- [ ] The suffixes render as above, and every existing display, render and pir-tui test is still green.
- [ ] No new row `kind` was introduced.
- [ ] `npm test` is green and `./install.sh` has refreshed the installed engine (grep `nudged` in
      `~/.claude/pir-engine/src/core/display.mjs`), with no parallel run live.

## Outside actions

- refresh-install — `worker`
