# T05 — Update `/docs` to the corrected behaviour

**Phase:** 2 · **Runs:** auto · **Depends on:** T03, T04 · **Weight:** light

## Goal

`/docs` is the canonical behavioural spec for parallel mode (CLAUDE.md). Today `docs/restart-recovery.md`
documents the in-flight-work loss and the control-folder contamination as honest known limitations,
and `docs/control-folder.md` describes the feeds as reused-not-cleared. Once T03 and T04 land, those
descriptions are wrong. This task rewrites them to the corrected behaviour, so the docs match the code.
This is part of the plan, not an afterthought.

## Design sections this implements

DESIGN §2 in whole (the corrected restart behaviour), specifically §2.1–§2.7.

## Files

- `docs/restart-recovery.md` — replace the "Known limitations" section with the reconciliation
  behaviour.
- `docs/control-folder.md` — correct the reuse/contamination description to the startup cleanup.
- `docs/run-lifecycle.md` — a short addition to "Start" noting reconciliation on restart.

Do not touch `plans/parallel-pir/DESIGN.md` (sealed; its banner redirects here) or any other plan's
files.

## What each doc must now say

`docs/restart-recovery.md`:

- **What a restart picks up** keeps the feature-branch/worktree reuse (still true), and now adds that
  in-flight task work is adopted from each task branch: a `✅`-but-unmerged branch is merged, a `🔍`
  branch gets a fresh review, a half-built branch is rebuilt clean, a `⛔` task stays blocked, a
  never-started task is implemented normally.
- **Remove the "in-flight task work is not adopted" limitation** — it is fixed. Replace it with the
  reconciliation description (DESIGN §2.1–§2.6), including that git is the ground truth and the
  committed task-branch glyph is the signal.
- **Correct the control-folder limitation** to the cleanup: the transient feeds are cleared on startup;
  `log` and `HALT` are preserved; a `HALT` present at startup refuses the run with an instruction to
  remove it.
- The note that `plans/parallel-pir/DESIGN.md §6` is the stale build-time aspiration can stay, but the
  specifics it points at are now the corrected behaviour, not a gap.

`docs/control-folder.md`:

- Correct the statement that the folder is "created if missing but never cleared on restart": the
  transient feeds (`reports/`, `outbox`, `answers`, `surfaced`) are cleared at startup; `log` is
  preserved with a `restart` marker; `HALT` is preserved and refuses a restart until removed.

`docs/run-lifecycle.md`:

- In "Start", after the feature branch opens, add one line: on a restart the coordinator reconciles
  each task from its own task branch before dispatching (pointer to restart-recovery.md).

## Tests

Docs carry no automated test. The check is a read against the code and DESIGN:

- [ ] every behaviour claim in the three docs matches what T03 and T04 actually do (traced to
      `loop.mjs`/`coordinate.mjs`).
- [ ] no "known limitation" remains for a limitation this plan fixed.
- [ ] `npm test` still passes (unchanged — docs only).

## Done when

- [ ] `docs/restart-recovery.md` describes adoption (merge/review/rebuild/blocked/implement) and the
      control-folder cleanup, with no stale "not adopted" limitation.
- [ ] `docs/control-folder.md` describes the startup cleanup and the preserved `log`/`HALT`.
- [ ] `docs/run-lifecycle.md` notes reconciliation on restart in "Start".
- [ ] a reader following the docs would predict exactly what the code does; `npm test` is green.
</content>
