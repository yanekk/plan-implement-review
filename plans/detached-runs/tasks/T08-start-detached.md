# T08 — start-detached

**Phase:** 2 · **Depends on:** T05, T06 · **Weight:** heavy

## Goal

`pir {slug}`'s engine: run the pre-flight checks, launch the coordinator detached from the
terminal, record and register the run, and hold the Mac awake for its lifetime. This is the task
that makes a run outlive WezTerm. The launch mechanism was verified in planning (FINDINGS); this
task builds it for real and has the user confirm survival by hand.

## Design sections this implements

DESIGN §2.5 (start), §2.9 (keep-awake), §3.4 (data flow), §5.2 (seatbelts).

## Files

- `src/shell/launch.mjs` — new.
- `src/shell/launch.test.mjs` — new.
- Reuses `src/core/progress.mjs` (`parseProgress`) for the review gate, `src/shell/identity.mjs`
  (T05) and `src/shell/index-store.mjs` (T06).

## Interface

```
startRun(slug, { cwd, spawn, exec, kill, fs, now, env } = {}) →
  { started:true, pid, record } | { started:false, reason, alreadyRunning? }

reasons: 'no-plan' | 'not-reviewed' | 'already-running'
```

Pre-flight, in order, before anything is spawned (§2.5):
1. `plans/{slug}/` exists → else `{started:false, reason:'no-plan'}`.
2. `parseProgress` shows the plan reviewed → else `'not-reviewed'` (same gate as the coordinator).
3. no live run for the slug: read the index entry (T06), resolve liveness (T05), `classifyRun`
   (T01); if `running` → `{started:false, reason:'already-running', alreadyRunning:true}` so the
   caller opens the live view instead (§2.5).

Then launch:
```
child = spawn('node', ['src/shell/coordinate.mjs', slug], {
  cwd: repoRoot, detached: true,
  stdio: ['ignore', fd, fd],                 // fd = control/run.log, opened append
  env: { ...process.env, PARALLEL_LIVE:'1', PIR_RUN:'1' },
});
child.unref();
```
- capture `startTime = startTimeOf(child.pid)` (T05) right after spawn, write the index entry (T06)
  with pid, startTime, repo, repoPath, controlDir, branch `pir/{slug}`, startedAt, finalState null.
- start keep-awake: `spawn('caffeinate', ['-i','-w', String(child.pid)], { detached:true,
  stdio:'ignore' }).unref()` — `-w` ties it to the coordinator so it releases on any death (§2.9).

`spawn`, `exec`, `kill`, `fs`, `now` are injected so the test never launches a real coordinator or
holds the real Mac awake.

## Tests

- [ ] pre-flight: absent plan → `no-plan`, no spawn called.
- [ ] pre-flight: an unreviewed plan (fake `PROGRESS.md`) → `not-reviewed`, no spawn.
- [ ] pre-flight: an already-running slug (index entry + faked-alive, matching start time) →
      `already-running`, no spawn.
- [ ] a crashed/stopped/finished existing run does not block a start (spawn is called).
- [ ] happy path: `spawn` called with `detached:true`, `PIR_RUN=1` and `PARALLEL_LIVE=1` in env,
      stdio to the run log; `unref` called.
- [ ] the index entry written carries the child's pid and the captured start time.
- [ ] keep-awake: `caffeinate -i -w {pid}` spawned detached and unref'd.

## Needs a person

The automated tests prove the pre-flight and that the right spawn is issued, but only a person can
confirm a real run keeps going after its terminal is gone. The worker starts a real short run, then
hands over:

```
pir some-reviewed-slug        # starts a real detached run, drops into its live view
# then, from the user: quit the live view (Esc), fully quit and reopen WezTerm / my-agentic-ide
pir                           # the run is still listed as running; open it — it is still progressing
```

Expect: after the terminal is closed and reopened, the run is still `running` and its task display
is still advancing; the Mac did not idle-sleep while it ran.
Tell me: did the run survive the restart, and was it still making progress when reopened?
