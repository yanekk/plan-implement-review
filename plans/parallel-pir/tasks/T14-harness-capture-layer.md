# T14 — Live-harness capture layer: flow, agent-status timeline, transcript bundle

**Phase:** 6 · **Depends on:** T09 · **Weight:** medium · **Runs:** auto

## Goal

Build the read-only capture that turns a live coordinator run into a self-contained, dated **bundle**
of evidence: the coordinator's flow log, a sampled agent-status timeline, a snapshot of every
session's transcript, and the scratch repo's `git log`. This is the foundation the assertion layer
(T15) checks and the live runner (T17) produces. It observes only — it must not modify the reviewed
coordinator (`coordinate.mjs`, `loop.mjs`, `platform.mjs`) or change any run behaviour.

The three sources and their exact shapes are settled in DESIGN §4.1 (confirmed on this machine
2026-09-10). Read it before building.

## Do

- **Flow.** Read `plans/{slug}/.parallel/control/log` in place (already written by the coordinator,
  one ISO-timestamped line per action). The bundle references or copies it; it is not re-derived.
- **Agent-status timeline (the one thing that must be sampled live).** A poller that runs
  `claude agents --json` every `intervalMs` (default ~2000) and appends `{ ts, agents: [...] }` to
  `agents-timeline.jsonl`. Keep every agent each tick (not just this run's) but tag which are this
  run's workers/coordinator by name (`isWorkerOf` / `coordinatorName`). `status` (`idle`/`busy`) and
  `pid` are present only while a session is live — DESIGN §4.1 — so the timeline is the only record
  of the busy→idle transition. On stop, also capture one `claude agents --json --all` as
  `agents-final.json` for the resting states.
- **Transcript snapshot.** For every session seen in the timeline, resolve its transcript path —
  `~/.claude/projects/<escape(cwd)>/<sessionId>.jsonl`, where `escape` replaces every `/` and `.`
  in the absolute cwd with `-` — and copy it into `transcripts/<worker-name-or-role>.jsonl`. Copy at
  stop (they persist under `~/.claude` after a kill, DESIGN §4.1), and write a `manifest.json`
  mapping name → { sessionId, cwd, transcriptPath, role, copied }.
- **`git log`.** Capture the scratch repo's `git log --oneline --graph --all` (feature branch, task
  branches, main) as `git-log.txt` at stop, so a merge/promotion is checkable after teardown.
- **The bundle** is one directory, dated, e.g. `plans/{slug}/.parallel/capture/{ISO}/`, holding
  `flow.log` (copy), `agents-timeline.jsonl`, `agents-final.json`, `transcripts/`, `manifest.json`,
  `git-log.txt`. Provide an in-process API the runner (T17) drives — start sampling, stop-and-seal —
  and a `loadBundle(dir)` that reads a sealed bundle back into a plain object for the assertions.
- The `claude` and transcript-store access is **injected** (a runner function and a projects-dir
  path), exactly as `platform.mjs` injects `runClaude`, so escaping, path resolution, timeline
  assembly, tagging and `loadBundle` are all unit-tested against canned `agents --json` output and a
  temp `projects/` tree with no live agent.

## Acceptance (build / fakes)

- `escape(cwd)` matches the observed convention: `/Users/j/src/pir-t10/.claude/worktrees/pir-scratch-T01`
  → `-Users-j-src-pir-t10--claude-worktrees-pir-scratch-T01` (every `/` and `.` → `-`), with a test.
- A canned sequence of `agents --json` snapshots (a worker `busy`, then `idle`, then absent) assembles
  a timeline that shows the transition and the disappearance; a test reads it back via `loadBundle`.
- Given a temp `projects/` tree with a fake transcript for a `sessionId`, the snapshot copies it and
  the manifest maps name → path; a session whose transcript is missing is recorded `copied: false`,
  not a throw.
- The poller keeps every agent per tick and tags this run's by name; a foreign agent is tagged not-ours.
- Nothing in `src/core/` or the reviewed `coordinate.mjs`/`loop.mjs`/`platform.mjs` is edited.

## Files (expected — the implementing session confirms)

- `src/shell/harness/capture.mjs` — the poller, transcript resolver/snapshotter, bundle seal/load.
- `src/shell/harness/capture.test.mjs`.
- Possibly a small shared `escapeProjectPath` helper (its own file if reused by T17).

## Done when

- [ ] The bundle format is produced and read back by `loadBundle`, all fields present.
- [ ] `escape(cwd)`, timeline assembly, transcript resolution/snapshot and tagging each have a test
      against canned data — no live agent.
- [ ] The layer is read-only: no edit to the reviewed coordinator, and `npm test` green.

## Needs a person

None. This task is fully provable against canned `agents --json` and a temp transcript store; the
live agents it will observe arrive in T17.
