# T06 — dashboard-label

**Phase:** 1 · **Depends on:** T00 · **Weight:** light

## Goal

Show the person, at a glance, that a worker is being nudged or has been marked stuck, without pulling
them in: the row label gains `· nudged N×` or `· stuck`. It is a display change only; T05 puts the
fields on the run-state task.

## Design sections this implements

DESIGN §2.6.

## Files

- `src/core/display.mjs`: `rowFor` appends the suffix to an active row's label.
- `src/core/display.test.mjs`
- `src/shell/render.mjs` / `render.test.mjs` only if the longer label breaks the `padEnd(24)` column
  (`reviewing · nudged 2×` is 21 characters; check, and widen the column if a real label overflows).

## Interface

```
run-state task (input, set by T05's buildRunState): { …, nudges?: number, stuck?: boolean }
rowFor(active task):
  stuck            → label `${PHASE_LABEL[phase]} · stuck`
  nudges > 0       → label `${PHASE_LABEL[phase]} · nudged ${nudges}×`
  otherwise        → unchanged
kind is unchanged (building / reviewing), so running counts and styles are unchanged.
```

`asking` and `merging` rows never carry the suffix. T05 never sets the fields on those phases, and
the display must not show one there either.

## Tests

- [ ] `building` with `nudges: 1` → `building · nudged 1×`; `reviewing` with `nudges: 2` →
      `reviewing · nudged 2×`.
- [ ] `stuck: true` → `building · stuck`, whatever `nudges` says.
- [ ] `nudges: 0` or absent → label unchanged (every existing display test still passes).
- [ ] `asking` and `merging` rows ignore the fields.
- [ ] The `running` count is unchanged by a stuck row.
- [ ] The rendered row keeps its elapsed column aligned with the longest label.

## Done when

- [ ] The suffixes render as above, and every existing display and render test is still green.
- [ ] No new row `kind` was introduced.
- [ ] `npm test` is green and `./install.sh` has refreshed the installed engine (grep `nudged` in
      `~/.claude/pir-engine/src/core/display.mjs`).

## Outside actions

- refresh-install — `worker`
