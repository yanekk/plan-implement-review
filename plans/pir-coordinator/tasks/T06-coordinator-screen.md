# T06 — coordinator-screen

**Phase:** 3 · **Depends on:** T04, T05 · **Weight:** medium

## Goal

Make the agent visible in `pir`: its conversation opens from the run like a worker's, rows say whether
the agent or the person holds a question, and a finished run reads `ready to merge` on the run view and
the dashboard until it ends. The person must be able to find the agent, read its pointers and the
report, and type to it, all from the existing screens.

## Design sections this implements

DESIGN §2.5 (row labels), §2.8, §2.9 step 5, §2.10.

## Files

- `src/core/display.mjs`, test: task rows read `asking coordinator` for items the agent holds and
  `asking you` for the person's; the footer counts only the person's; a `handoff` block renders
  `ready to merge · git merge pir/{slug}` or `not ready · tests red`, with the report path.
- `src/core/dashboard.mjs`, test: run state label `ready to merge`; a key opens the coordinator's
  conversation (same chord family as opening a task's worker; pick the one free in `dashboardReducer`).
- `src/shell/coordinate.mjs` `buildRunState`: carries `coordinator: { id, live, logPath }` and each
  task's holder.
- `src/shell/pir-tui.mjs`, `conversation-view.mjs`, tests: open the coordinator's conversation; its
  pointers and hand-off are its own replies and pir's hand-off message, rendered as today; typing sends to it through the inbox like a
  worker message.
- `src/shell/conversation-rig.mjs` or its tests: end-to-end cases below.

## Interface

```js
// run state additions (buildRunState)
runState.coordinator = { id, live: bool, logPath } | null   // null with --no-coordinator
runState.tasks[i].asking = 'permission'|'questions'|'question' | null   // unchanged
runState.tasks[i].holder = 'coordinator'|'person' | null
runState.handoff = { state, reportPath, mainSha } | null      // from T05
```

## Tests

- [ ] Display: holder coordinator → `asking coordinator`, person → `asking you`, footer counts person only.
- [ ] Display: `handoff` ready, red, preparing; absent with the agent off.
- [ ] Dashboard: `ready to merge` label; open-coordinator key; no coordinator → the key does nothing, with a note.
- [ ] Conversation view renders the agent's pointer reply, and pir's hand-off message with the reply.

## End to end (the worker drives this)

- suite: the existing pseudo-terminal rig (`conversation-rig.mjs`, run in `npm test`) · sizes: 80×24, 120×40
- [ ] Fake run with the agent holding T01's question → T01 row reads `asking coordinator`.
- [ ] The agent passes it → the row reads `asking you`, the coordinator's conversation shows the pointer.
- [ ] Open the coordinator's conversation, type "where are we?" → it is delivered to the agent's session.
- [ ] Fake run reaches `ready` → run view shows `ready to merge · git merge pir/{slug}` and the report path;
      dashboard row reads `ready to merge`.

## Done when

- [ ] Every test and end-to-end case above passes in `npm test` at both sizes.
- [ ] With `--no-coordinator` the screens are unchanged (existing rig tests pass untouched).
- [ ] `./install.sh` run after the change.
