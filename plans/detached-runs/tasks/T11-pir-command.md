# T11 — pir-command

**Phase:** 4 · **Depends on:** T08 · **Weight:** medium

## Goal

The `pir` entry point and its launcher wrapper: parse the two invocations and dispatch them. `pir
{slug}` starts a run (T08) and, when it is already running, opens its live view instead; `pir` with
no argument opens the dashboard (T12). This task owns the argv handling and the `bin/pir` wrapper
and hands off to the TUI; the TUI painting itself is T12.

## Design sections this implements

DESIGN §2.1 (the two invocations), §2.5 (start-or-open), §2.9 (naming, `bin/pir`).

## Files

- `bin/pir` — new: logic-free wrapper, `exec node "__PIR_ENGINE__/src/shell/pir.mjs" "$@"`, exactly
  mirroring `bin/pir-coordinate`. The `__PIR_ENGINE__` token is a placeholder `install.sh` substitutes
  with the installed engine dir at install time (T13); it is not a shell/env variable.
- `src/shell/pir.mjs` — new: argv dispatch and the entry into the TUI.
- `src/shell/pir.test.mjs` — new: the dispatch decision, TUI injected.

## Interface

```
run(argv, { startRun, openDashboard, openWatch, stderr } = {}) → exitCode
  argv = []            → openDashboard()                         // the dashboard (T12)
  argv = [slug]        → r = startRun(slug)                      // T08
                         r.started            → openWatch(slug)  // drop into the live view
                         r.alreadyRunning     → openWatch(slug)  // open, do not start a second
                         r.reason==='no-plan'      → stderr "no plan '{slug}' — plans/{slug}/ not found", exit 1
                         r.reason==='not-reviewed' → stderr "'{slug}' is not reviewed — run /pir-review-plan {slug}", exit 1
  argv longer than 1   → usage to stderr, exit 2
```

`startRun`, `openDashboard`, `openWatch` are injected so the dispatch is tested without launching
anything or entering raw mode. Reason the errors print to stderr and exit non-zero: a refused start
is a scriptable failure, not a dashboard state.

## Tests

- [ ] no args → `openDashboard` called.
- [ ] `[slug]` that starts → `openWatch(slug)` called once, no error.
- [ ] `[slug]` already running → `openWatch(slug)` called, `startRun` did not spawn (its
      `alreadyRunning` path), no error.
- [ ] `no-plan` and `not-reviewed` each print the right message to stderr and exit 1, no watch opened.
- [ ] two or more args → usage, exit 2.
- [ ] `bin/pir` execs the engine (a smoke check that the wrapper points at `__PIR_ENGINE__/src/shell/pir.mjs`).

## Done when

- [ ] The two invocations dispatch correctly, with start-or-open for an already-running slug.
- [ ] Pre-flight refusals surface as clean stderr messages and non-zero exits.
- [ ] `npm test` passes.
