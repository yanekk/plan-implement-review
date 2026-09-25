# T17 — docs

**Phase:** 4 · **Depends on:** T06, T07, T08, T13, T14, T15 · **Weight:** medium

## Goal

Make `/docs` describe what the code now does: workers as SDK-driven stream-json children, the line down and why the
old "routes nothing" rule is gone, the conversation log and inbox in the control folder, answering in the
`pir` screen, the conflict fix sent to the worker, reaping, the new view and keys, and no `pir-coordinate`.

## Design sections this implements

All of DESIGN §2, as current behaviour.

## Files

- `docs/README.md` (components: workers, platform.mjs; launcher line)
- `docs/human-flow.md` (questions, live actions, merge conflicts: answered in `pir`)
- `docs/control-folder.md` (the one-direction section rewritten; `conversations/`, `inbox/`, `workers.json`)
- `docs/detached-runs.md` (the view and key bindings; stop reaps children; install needs npm)
- `docs/run-lifecycle.md` (each pass without `claude agents`; the footer)
- `docs/restart-recovery.md` (reap from `workers.json`; hygiene clears `inbox/`)
- `docs/branch-model.md` (agent names: `-n` on a `-p` worker; listed in `claude agents`, not attachable)
- `CLAUDE.md` only where it names `pir-coordinate` or `claude agents` as how parallel mode is used
- `README.md` (root: its install section says only `src/` is copied to the engine; T10 adds packages)
- stale `claude agents` comments in code no other task rewrites: `core/naming.mjs`, `core/dispatch.mjs`,
  `core/dashboard.mjs`, `shell/control-run.mjs`, `core/display.mjs`

## Tests

- [ ] every file above is consistent with DESIGN §2 and the code at this commit
- [ ] no doc tells the person to attach to a worker or run `pir-coordinate`

## Done when

- [ ] `grep -rn "pir-coordinate\|attach" docs` finds only history notes
- [ ] each rewritten section cites the code module it describes, as the docs do today
- [ ] `npm test` still green (docs-linked tests, if any)
