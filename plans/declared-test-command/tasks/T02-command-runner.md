# T02 — command-runner

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

One shell module that runs a list of command lines in a folder, logging each to a file. The end gate
needs it synchronously and worker setup needs it in the background, polled once per pass, so both
share one env scrub, one log format and one result shape.

## Design sections this implements

DESIGN §2.4, §2.5.

## Files

- `src/shell/commands.mjs` (new)
- `src/shell/commands.test.mjs` (new)

## Interface

```js
// scrubEnv(env) → a copy without PARALLEL_* and PIR_RUN (moved from runFeatureTests).
export function scrubEnv(env) {}

// Result of a run of lines:
//   { ok: true, logPath }
//   { ok: false, line, status, signal, logPath, tail, reason }
//     reason: "`<line>` exited <status>" | "`<line>` could not run (<code|signal>)"
//     tail:   the last 20 lines of the log, '' when there is no log

// runLines(lines, { cwd, logPath, append = false, env = process.env }) → result. Synchronous. Each line
// via `/bin/sh -c`, in order, stopping at the first failure. The log gets "$ <line>\n" before each
// line's output. An unwritable log does not turn a green run red (the current runFeatureTests rule).
export function runLines(lines, opts) {}

// startLines(lines, { cwd, logPath, env = process.env, spawn }) → handle. Same semantics, background.
//   handle.poll() → null while running, else the result (stable once returned).
//   handle.kill() → kills the running line and its children (detached process group) and makes the
//                   result { ok: false, reason: 'killed' }.
// No lines → a handle whose first poll() returns { ok: true }.
export function startLines(lines, opts) {}
```

## Tests

- [ ] `runLines(['true', 'echo hi'])` → ok; the log holds both `$` headers and `hi`.
- [ ] `runLines(['true', 'exit 3', 'touch never'])` → `exited 3`, the third line did not run.
- [ ] A missing binary → exit 127 in the reason; `tail` holds the shell's error.
- [ ] `append: true` keeps the earlier content; the default rewrites.
- [ ] cwd is honoured (`pwd` output); a `cd` in one line does not carry to the next.
- [ ] `PARALLEL_X` and `PIR_RUN` are absent from the child env; others pass through.
- [ ] An unwritable logPath still runs and returns ok on green.
- [ ] `startLines` polls null then ok; a failing line gives the same result shape as `runLines`.
- [ ] `startLines(['sleep 30'])` then `kill()` → result `killed`, and no `sleep` process is left.
- [ ] `tail` is capped at 20 lines.

## Done when

- [ ] Both functions behave as specified, tested against real `/bin/sh` in a temp dir, `npm test`
      green and still quiet.
- [ ] Nothing else in `src` calls them yet (T04 and T07 wire them).
