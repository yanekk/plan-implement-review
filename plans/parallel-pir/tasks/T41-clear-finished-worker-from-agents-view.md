# T41 — Clear a finished worker from the "Claude agents" view

**Phase:** 12 · **Depends on:** T14, T29 · **Weight:** medium · **Runs:** auto (+ a `you` live confirmation)

## Goal

When a worker finishes, the coordinator ends it and tears its worktree down, but it never clears the
session's leftover record from the "Claude agents" view. That leftover — a `stopped` session with no
live work behind it — is what accumulates as the run goes, one per implement/review/verify worker, and
clutters the view. The gap is already documented: `platform.close` runs `claude stop <id>` then SIGTERMs
the pid (`src/shell/platform.mjs:298-310`), `worktree.remove` deletes the worktree and branch, and
**nothing in the running code ever runs `claude rm`** — which is the command the design already names as
the cleanup for the leftover record (DESIGN §2.3 lines 152-156, 863-866; `TEST-HARNESS.md:172`;
`PROGRESS.md` housekeeping note). Today that cleanup is left to the operator by hand. This task makes the
coordinator do it, so a worker leaves the view **as soon as it finishes** (PM decision, 2026-09-16).

## The change

1. **A `remove(id)` platform primitive.** Add `remove(id)` to `platform.mjs` (a `removeArgv(id)` →
   `['rm', id]`, parallel to `closeArgv`) that runs `claude rm <id>`. It is best-effort: removing an id
   that is already gone is not an error, and a `remove` never throws the loop off course. The id it acts
   on is the **authoritative list id** the loop already tracks (`t.workerId`, written back from
   `claude agents --json` at `loop.mjs:102`), the same id `close` uses — never the spawn-returned id.

2. **Remove on every normal finish path, right after the existing close.** In the coordinator loop
   (`src/shell/loop.mjs runPass`) and `teardownRun` (`src/shell/coordinate.mjs`), wherever a worker is
   closed because its work is done, follow the `close` (and `worktree.remove`, where that path does one)
   with `platform.remove(workerId)`:
   - the **merged** worker (loop 3d) and the **dead / torn-down** worker (loop 3a) — both already close +
     remove the worktree; add the session removal;
   - the **implementer closed at review hand-off** (loop 3c/3e) — its worktree is kept for the reviewer,
     but the implementer session itself has finished, so its record is removed (this is the
     "implementer lingered beside its reviewer" clutter, `src/core/naming.mjs:14`);
   - `teardownRun`'s per-worker close on a clean exit.
   Keep the id in `state.closedIds` as today so a removed/relisted session is never recounted as live.

3. **The one exception: the kill switch does not auto-remove.** On `halt-close` (loop 3a halted) the run
   is an emergency stop and its worktrees/branches are deliberately left on disk for forensics; leave the
   session records too, so the operator can still open a killed worker. Removal is for workers that
   *finished*, not for ones a HALT killed. (Flagged to the PM; reversible if they want a HALT to clean the
   view as well.)

4. **Do not cost the harness a worker's transcript.** The live-scenario harness builds its bundle from the
   on-disk transcripts at `~/.claude/projects/…/<sessionId>.jsonl`, which the design confirms survive a
   worker's SIGTERM and its worktree's removal (`src/shell/harness/capture.mjs:19-22`), and it seals
   (`cap.seal()`) **before** its own teardown (`run.mjs:385`). But the coordinator now removes workers
   *mid-run*, and it is **undocumented whether `claude rm` deletes the `.jsonl` transcript** as well as the
   list record. The build must not depend on the answer:
   - Resolve it first — see the `you` spike below — and if `claude rm` leaves the transcript on disk,
     nothing more is needed and the seal is unaffected.
   - If `claude rm` deletes the transcript, the capture layer must snapshot each worker's transcript into
     the bundle when it first observes that worker leave `working` (an eager copy on `cap.tick()`), so the
     bundle still holds it after the coordinator removes the session. Either way, a sealed bundle from a run
     in which workers were removed mid-run still contains every worker's transcript.

5. **Update the stale docs.** The notes that name `claude rm` as a manual operator step now describe
   coordinator behaviour: DESIGN §2.3 (close now also clears the leftover record), `TEST-HARNESS.md:172`,
   and the `PROGRESS.md` housekeeping note.

## Files

- `src/shell/platform.mjs` — `removeArgv` + `remove(id)` (`claude rm`), best-effort.
- `src/shell/loop.mjs` — call `platform.remove` on the merged, dead, and review-hand-off close paths; not
  on `halt-close`.
- `src/shell/coordinate.mjs` — `teardownRun` removes each worker it closes on a clean exit.
- `src/shell/harness/capture.mjs` — only if the spike shows `claude rm` deletes the transcript: eager
  per-worker transcript snapshot so the bundle survives mid-run removal.
- `src/shell/platform.fake.mjs` (or wherever the fake platform lives) — a fake `remove` that records the
  ids removed, so the loop tests can assert it.
- `skills/pir-coordinate/SKILL.md`, `skills/pir-worker/SKILL.md` — describe the finished-worker removal if
  the prose asserts the close contract.
- `plans/parallel-pir/DESIGN.md` (§2.3), `plans/parallel-pir/TEST-HARNESS.md`, `plans/parallel-pir/PROGRESS.md`
  — the `claude rm` notes now describe coordinator behaviour, with the HALT exception.

## Tests

Unit tests against the fake platform, install-free, `npm test` green:
- each normal finish path (merged, dead, review hand-off, `teardownRun`) calls `platform.remove` with the
  authoritative `workerId`, after its `close`;
- `halt-close` does **not** call `remove` (the HALT exception bites — a mutation that removes on halt
  reddens it);
- a removed id is still in `closedIds` and is not recounted as live;
- the harness capture yields a worker's transcript in the sealed bundle even when that worker was removed
  mid-run (drive it with an on-disk transcript fixture + a fake `remove`, so no live agent is needed).

## Done when

- [ ] `platform.remove(id)` runs `claude rm <id>`, best-effort, on the authoritative list id.
- [ ] Every normal finish path removes the worker's session record right after closing it; `halt-close`
      does not; tests bite on both.
- [ ] A sealed harness bundle still contains every worker's transcript when workers were removed mid-run.
- [ ] The `claude rm` notes in DESIGN §2.3, `TEST-HARNESS.md` and `PROGRESS.md` describe the coordinator
      doing it, with the HALT exception. `npm test` green, install-free.

## Live proof (a `you` follow-up, not this task)

Two facts here are live-only and need the real `claude` CLI, so they ride the same attended re-run pending
for T39/T40 (real workers, one at a time, §5.2):
1. **The spike that gates the ordering:** spawn one throwaway `claude --bg` with a trivial turn, note its
   transcript path under `~/.claude/projects/…`, run `claude rm <id>`, and check whether the `.jsonl`
   still exists. Seatbelt: a single scratch bg session, trivial turn, no real branch, removed immediately.
   The answer decides whether step 4's eager-copy is needed.
2. **The behaviour itself:** in the attended blog-app re-run, watch that each worker leaves the "Claude
   agents" view when it finishes and that a HALT-killed worker stays. Record both in `FINDINGS.md`.

This task builds and unit-tests the contract on the safe assumption; it does not assert the live behaviour.
Flag it for the PM.

## Scope

`src/shell` (platform, loop, coordinate, capture), the fake platform, the two skills, and the DESIGN/doc
notes. No change to what a worker builds or how a task folds back. Everything else goes in FINDINGS.md.
