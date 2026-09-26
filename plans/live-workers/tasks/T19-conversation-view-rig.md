# T19 — conversation-view-rig

**Phase:** 4 · **Depends on:** T13 · **Weight:** medium

Added 2026-09-25 by the T13 implementer with the user's approval: the user had no time for T13's hands-on
feel check, so the check moves to T20, and this task builds the rig T20 drives. No paid worker anywhere.

## Goal

One command that puts the real `pir` screen in front of a pretend run whose worker behaves like a live
one, so the conversation view (T13) can be driven end to end without a paid worker; and a driver that runs
that screen in a real pseudo-terminal, sends keys and captures each screen as text.

## Design sections this exercises

DESIGN §2.5–§2.9, §2.11 (conversation view, key table), §2.14 (huge log); §4 (the fake `claude`).

## Files

- `src/shell/conversation-rig.mjs` (new), `src/shell/conversation-rig.test.mjs` (new)
- `src/shell/fake/claude-stream.mjs` only if a script step it lacks is needed (extend, never copy)

## What the rig stands up

`node src/shell/conversation-rig.mjs [--into <scratch>] [--scenario <name>]`, in the foreground until
Ctrl+C or HALT:

- a scratch repo with a one-task plan, and an index record for it (`index-store.mjs`) whose pid and start
  time are the rig's own, so `pir` classifies the run `running` (classifyRun) and a drop is allowed;
- the real platform (`createPlatform`) with the worker spawned on `fake/claude-stream.mjs` through the real
  SDK, the real conversation log and the real person inbox (`startPersonInbox`); `status.json` written as
  the coordinator writes it, so the live view shows the task and → opens its worker;
- a scripted scenario (default `tour`): the opening message; a run of tool steps with results, one failed;
  a permission request with an `addRules` suggestion; one flagged `defaultToNo`; one flagged
  `suppressAlwaysAllowRule`; a two-question set (single and multi-select); replies to typed messages; an
  interrupt honoured mid-turn; `init.slash_commands` including `context` and the four terminal commands;
  a `long` scenario whose log is over 256 KB.
- teardown on exit: every child closed, the index record removed, the scratch folder deleted unless
  `--keep`.

The person or a worker then runs `node src/shell/pir.mjs` (or `pir.mjs <slug>` from the scratch repo).

## The driver

`driveScreen({ cols, rows, keys })` runs `pir.mjs` under a real pseudo-terminal and returns the screen
text after each key. No new npm package (DESIGN §5): use python3's `pty` module or `/usr/bin/script`,
and a minimal screen model for pi-tui's output (it addresses rows absolutely; `drawnRows` in
`pir-tui.test.mjs` is the starting point, extend it rather than copy).

## Tests

- [ ] the rig's run is listed by `loadDashboard` as `running`, with one task whose worker is live
- [ ] each scenario step appears in the conversation log in order; the fake answers a permission reply,
      an answers reply and an interrupt as the real worker would
- [ ] the driver, on the `tour` scenario: opens the worker, sees the pinned permission, answers `y`,
      sees `→ allowed`; walks the question set; sends a message; Esc interrupts; ← returns
- [ ] every captured screen is exactly `rows` lines, the box and hint are on the last lines
- [ ] teardown leaves no child process, no index record and no scratch folder

## Done when

- [ ] `npm test` green with the tests above, and quiet (no paid call, no real `claude`)
- [ ] the rig's command and scenarios are described at the top of `conversation-rig.mjs`

## Outside actions

- Install the locked packages — `worker` (`npm ci` in the worktree)
