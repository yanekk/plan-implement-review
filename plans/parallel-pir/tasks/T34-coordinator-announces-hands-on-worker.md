# T34 — Coordinator announces the hands-on worker on dispatch

**Phase:** 8 (coverage: hands-on verification) · **Depends on:** T33 · **Weight:** light · **Runs:** auto

## Why this exists

T33's live run PASSed but exposed a real gap (FINDINGS 2026-09-15): when the bin spawns a `you`/hands-on
worker, the coordinator says **nothing** to the user. It waits for a `surface` line — which a `you` task
never emits by design — so it sits blind between `spawn Txx` and `merge Txx`. The only reason the T33
run worked is that the attended harness runner printed a cue to stdout and the operator already knew the
drill. In a real (non-harness) run there is no runner cue: the coordinator IS the only thing that can tell
the user a person is needed, and it stays silent. A first-time operator would be stranded.

Root cause in `skills/pir-coordinate/SKILL.md`: step 4 ("Point the user at hands-on tasks") tells the
coordinator "the bin prints which worker to go and drive" — i.e. it points at the bin's **stdout**, the
one channel the rest of the skill (the "Ground truth is the flow log, not the bin's stdout" block)
correctly trains the coordinator never to drive off. Meanwhile the reliable signal already exists — the
bin writes a durable `hands-on Txx` line to the flow log (`loop.mjs:247`) — but `hands-on` is not in the
skill's list of milestone tags to wake on or act on, so the coordinator never keys off it.

## What "done" must behave like

- The coordinator treats a `hands-on Txx` flow-log line as an actionable milestone: the moment it appears,
  it tells the user, in plain English, to open the hands-on worker for `Txx` and run its steps — naming
  the worker by the deterministic convention `{repo} · {plan} · T{nn} · verify` (§2.8), which the user can
  find in `claude agents --json`. It does **not** wait for a `surface` for a `you` task (one never comes),
  and it does **not** drive off the bin's stdout.
- After announcing, the coordinator keeps the run alive and resumes on the task's `merge Txx` line (its
  normal completion signal), exactly as for any other task. No review phase for a `you` task.
- `hands-on` is added to the milestone tag list and to the Monitor wake set, so the coordinator is woken by
  it rather than sleeping through it.
- No behaviour change for `auto` tasks or for the interactive (`surface`) path.

## Files

- `skills/pir-coordinate/SKILL.md` — prose only. Add `hands-on` to the tag list and the Monitor milestone
  set; rewrite step 4 to key off the `hands-on Txx` flow line (not stdout), announce the derived worker
  name, and state explicitly that a `you` task never surfaces.

No `src/` change: `loop.mjs` already emits `hands-on Txx` (T32), and the worker name is deterministic.

## Tests

No new automated test — the deliverable is coordinator prose, and the flow-log emission it keys off is
already covered by the hands-on fixture (T32). `npm test` must stay green (prose change touches no code).

## Confirmation (in place of a fresh-eyes review)

Per the PM's direction, this fix is confirmed by re-running the attended `hands-on` fixture (T33's drill)
with the fix in place: on the rerun the **coordinator itself** must tell the operator which worker to
drive, before the operator goes hunting — not the harness runner's stdout cue. That live rerun is stronger
evidence for a coordinator-prompt change than a code read, and stands in for the usual review session. The
five T33 facts must still be green and the plan must still promote once.

## Done when

- [ ] `skills/pir-coordinate/SKILL.md` keys off `hands-on Txx`, announces the derived worker name, and no
      longer relies on the bin's stdout or a `surface` for a `you` task; `hands-on` is a milestone tag.
- [ ] `npm test` green.
- [ ] Attended `hands-on` rerun PASSes AND the coordinator's own output points the operator at the worker
      (recorded in FINDINGS with the date).
