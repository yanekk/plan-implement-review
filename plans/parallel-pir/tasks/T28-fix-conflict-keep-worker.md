# T28 — Fix the merge-conflict path: keep the worker, apply the decision

**Phase:** 6 · **Depends on:** T27 · **Weight:** heavy · **Runs:** auto · **Gates:** the T22 re-run

## Why this exists

The T22 live run (2026-09-13, FINDINGS) exposed that the coordinator-hit merge-conflict path of
DESIGN §2.5 does not work end-to-end. Two tasks changed the same line; the coordinator detected the
clash correctly, then **discarded the waiting worker, respawned a fresh one that never heard the
decision, merged the wrong content, promoted it to `main`, and reported success it never checked.**
The human's "keep T01" decision was ignored and the opposite content shipped.

The PM chose **Option 2 (2026-09-13):** on a conflict the coordinator keeps the worker alive, hands it
the decision, and the worker resolves on its own branch and merges cleanly — the run finishes hands-off,
the way DESIGN §2.5 already promises. This task makes that real. (Option 1, "park it for a human and
stop", was rejected because one clash would strand the whole plan's shipment until a person returned.)

## Root cause (confirmed, from the bundle + code)

1. `decideDispatch` puts a done worker in **both** `merge` and `close` (dispatch.mjs: a done branch is
   merged this pass, then its worker closed). This is correct for a *clean* merge.
2. `loop.mjs` step 3d hits the conflict, parks the task (`phase = AWAITING`, records `surface`,
   `continue`) — but leaves the worker in `decision.close`.
3. `loop.mjs` step 3e then runs that close: `platform.close(workerId)`, `worktree.remove(...)`, and
   **`delete state.tasks[num]`**. The park is destroyed in the same pass — worker gone, worktree gone,
   task forgotten.
4. Next pass, `decideDispatch` sees the task still `⬜` in `PROGRESS.md` with no live worker and
   **respawns it as a fresh build**. The fresh branch is cut from the post-T01 feature tip, so its merge
   no longer conflicts and simply overwrites the other task's line.
5. `answer()` (coordinate.mjs) routes the PM's decision to the worker **by name** — but that worker is
   already closed, so delivery fails (the T22 run logged two HTTP 409 disconnects). Even had it landed,
   the respawn ran plain `pir-implement`, not a conflict-resolution flow.
6. The coordinator reported "reads hello there, matching your decision" after inspecting only the task
   branch, never the merged feature branch (which read `hi world`). It asserted an outcome it did not
   verify — against the CLAUDE.md verification contract.

There is **no** `ours`/`theirs` merge strategy anywhere in `src`; `mergeTask` aborts on a code conflict
and never auto-resolves. So the only correct resolver is the worker, which holds the task's context.

## What "done" must behave like (Option 2)

On a conflict the coordinator hits when merging a task branch:

- **Keep the worker alive and parked.** Do not close it, do not remove its worktree, do not delete it
  from `state`, do not respawn it. It stays `AWAITING`, holding its slot under the ceiling (DESIGN §2.5:
  a parked worker holds a slot; several stacking up throttle the run to human speed, which is correct).
- **`decideDispatch` must respect the park.** An `AWAITING` task is *taken* — never re-dispatched
  (spawned) — and its worker is **not** placed in `merge` or `close` while parked. (Today `AWAITING` is
  in the "still a running session" set for the ceiling count, but nothing stops the merge/close/respawn
  race above. Close that race at the decision level, so the loop cannot destroy a parked worker.)
- **Surface to the PM** — already done via `AskUserQuestion` (T27). No change expected here beyond
  confirming it still fires for a conflict.
- **Deliver the decision to that same, still-alive worker** (`answer()` already targets it by name —
  now the target exists).
- **The worker resolves on its own branch.** On receiving the decision the worker integrates the current
  feature branch into its task branch, resolves the clashing file(s) as the decision says (take one
  side, or reconcile/combine — it holds the task context), commits, and signals `done` again. This is a
  **new path in the worker contract** (`pir-worker` / `pir-implement`): "you hit a conflict, here is the
  human's decision, resolve it and re-signal done." Today the worker has no such path.
- **The coordinator then merges the now-clean branch**, reconciles the row to `✅`, and closes the
  worker — the normal clean-merge path, reached only once the branch actually merges without conflict.
- **Never report an unverified outcome.** The coordinator must not claim the decision was honoured
  without evidence the merged feature branch reflects it. Prefer checking the merged result over
  narrating intent. (This misreport is independent of the merge logic and must be fixed regardless.)

## A sub-decision the PM raised — confirm before building

The PM asked whether, when a task's **entire change is overruled** by the decision (its work contributes
nothing to the final product), the coordinator should **flag that back** ("heads up — Task 2 ended up
contributing nothing"). It was left open. It is low-cost and honest, but it is a behaviour change, so
**put it to the PM as a one-line yes/no before building**, and do what they say. If yes, the coordinator
surfaces a short note when a resolution drops a task's whole contribution; if no, leave it out. Do not
decide it silently.

## Fixture + fact must change with the behaviour (this is why the fix is provable)

The current fixture fact `mergeConflictParked` (assertions.mjs) asserts the task **never** merges — which
was only ever right for a terminal park. Under Option 2 the task **does** merge, with the decided content.
So the fixture, its declared fact, and the runner change together:

- **Redefine the fact** (rename off `parked`): a conflict was surfaced **before** any merge of that task;
  **exactly one** worker ran the task (no respawn); the human decision was **delivered** to the live
  worker; the merge that eventually landed took the **decided** side; and `main` promoted **once** with
  the final content matching the decision (e.g. `greeting.txt` reads `hello there`, not `hi world`).
- **merge-conflict is now interactive, not hands-off.** Like `human-decision`, the T17 runner must feed a
  **scripted decision** (e.g. `{"task":"T02","text":"keep T01 / hello there"}`) to the control `answers`
  file when the conflict surfaces, so the re-run is deterministic. Update `TEST-HARNESS.md` (merge-conflict
  needs an answer) and `T22`'s "Facts it must show" to the redefined fact.

## Files (confirm at build time)

- `src/core/dispatch.mjs` — exclude an `AWAITING` task's worker from `merge`/`close`; keep it "taken" so
  it is never respawned. Stays a pure function; the boundary scan must stay green.
- `src/shell/loop.mjs` — on a conflict, park **and protect** the worker (no close, no worktree removal,
  no `delete state.tasks`); route the delivered decision to the parked worker; merge only once the branch
  is clean.
- `src/shell/coordinate.mjs` — `answer()` delivery to the parked worker; the report/verify change so the
  coordinator does not assert an unverified merge outcome.
- `skills/pir-worker/SKILL.md` (and `pir-implement` if the resolution flow lives there) — the new
  "resolve this conflict per the human's decision, then re-signal done" path.
- `skills/pir-coordinate/SKILL.md` — prose for the keep-alive-and-deliver flow and the no-unverified-
  success rule.
- `src/shell/harness/assertions.mjs`, `src/shell/harness/fixtures/merge-conflict.mjs`,
  `src/shell/harness/run.mjs` — the redefined fact and the scripted decision.
- `plans/parallel-pir/DESIGN.md` §2.5 — clarify the coordinator-hit-conflict backstop (keep the worker,
  deliver the decision, worker resolves, then merge). §2.5 already chose "worker resolves, escalates if
  stuck"; make the mechanics of the backstop explicit so this cannot regress.
- `plans/parallel-pir/TEST-HARNESS.md`, `tasks/T22-fixture-merge-conflict.md` — merge-conflict is
  interactive; the redefined fact.

## Tests

- [ ] A unit test proving the loop **does not** close/remove/delete a worker whose merge just conflicted,
      and that `decideDispatch` neither respawns nor merges/closes an `AWAITING` task. (Mutation check:
      the old behaviour should red the new test.)
- [ ] A test that a delivered decision reaches the parked worker (fake platform), and that after the
      worker re-signals `done` the loop merges the clean branch exactly once.
- [ ] The redefined merge-conflict fact passes on a bundle where the decided side won, and **fails** on a
      bundle where the losing side merged or the task was respawned.
- [ ] `npm test` green; the boundary scan green (no clock/network/randomness in the core).

## Done when

- [ ] On a coordinator-hit conflict the worker stays alive, receives the decision, resolves on its own
      branch, and the coordinator merges the clean branch — no respawn, no clobber, no unverified success
      report.
- [ ] The redefined fact + scripted-decision fixture are in place, `T22`/`TEST-HARNESS.md`/`DESIGN.md`
      §2.5 updated, and the PM's sub-decision (flag a fully-overruled task) applied per their answer.
- [ ] `npm test` and the boundary scan green.

## After this task — not self-verifying

A conflict path is only proven under real agents. Its proof is the **T22 re-run** (`run.mjs
merge-conflict`), gated behind this task: the conflict must surface, the scripted decision must reach the
still-alive worker, the worker must resolve, and `main` must promote once with the **decided** content —
the redefined fact all-green — followed by the reflection pass (DESIGN §4.1). Then T23 (parallel +
kill-switch) runs last on the fixed machinery.
