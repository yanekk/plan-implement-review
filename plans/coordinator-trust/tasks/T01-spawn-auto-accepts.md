# T01 — Worker spawn auto-accepts messages

**Phase:** 1 · **Runs:** auto · **Depends on:** T00 · **Weight:** light

## Goal

Make a spawned worker accept the coordinator's cross-session messages without a person, by
adding the permission-mode flag T00 proved to the worker spawn argv. Today a worker lands in the
default mode, which in the failed run required approval, so a decision the coordinator sent could
not reach the worker on its own. This is the engine half of DESIGN §2.6; the coordinator half
(the receipt loop) is T05.

## Design sections this implements

DESIGN §2.6. Uses the exact flag string T00 recorded in `FINDINGS.md`.

## Files

- `src/shell/platform.mjs` — `spawnArgv`, and the comment above the live-session half that
  documents the spawn mechanics.
- `src/shell/platform.test.mjs` — the argv assertion.

## Interface

```
// before
export function spawnArgv({ name, instruction }) {
  return ['--bg', '-n', name, instruction];
}
// after (flag from T00; shown here as bypassPermissions, replace with what T00 proved)
export function spawnArgv({ name, instruction }) {
  return ['--bg', '-n', name, '--permission-mode', '<flag from T00>', instruction];
}
```

The instruction stays the last, positional argument (`claude --bg` takes the opening turn
positionally; `execFile` passes each element as one argv, so no shell quoting). The flag goes
before it. If T00 found a bare flag (e.g. `--dangerously-skip-permissions`) rather than a
`--permission-mode <mode>` pair, add the single flag instead — match what T00 proved, not this
sketch.

## Tests

- [ ] `spawnArgv` includes the permission flag T00 proved, in the exact form T00 recorded.
- [ ] The instruction is still the final positional argument, after the flag.
- [ ] `-n` still precedes the name, and `--bg` is still first.
- [ ] The existing `spawn` path (which calls `spawnArgv`) still parses the returned id unchanged
      — no behavioural regression in the surrounding function.

## Done when

- `spawnArgv` carries the permission flag and the argv test asserts it.
- `npm test` is green.
- The change is argv-only; the live confirmation that a worker now accepts a message with no
  prompt is T07, not this task (this task cannot spawn a live worker).
