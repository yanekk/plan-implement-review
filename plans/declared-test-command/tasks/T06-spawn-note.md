# T06 — spawn-note

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Let the engine append a note to a worker's opening instruction, so T07 can tell a worker its setup
failed and what the output said. Today the instruction is a fixed string with no room for one.

## Design sections this implements

DESIGN §2.4.

## Files

- `src/shell/platform.mjs` — `openingInstruction`, `createPlatform().spawn`
- `src/shell/fake/platform.mjs` — records `note` on each spawn
- `src/core/setupnote.mjs` (new) — the note's text
- matching tests

## Interface

```js
// platform.spawn({ cwd, name, phase, note = null })
// openingInstruction(phase, task, note = null) → the current string, then "\n\n" + note when given.

// formatSetupNote({ line, reason, tail, logPath }) → string, pure:
//   The plan's setup step failed in this worktree before you started: <reason>.
//   Last lines of its output:
//   <tail, indented>
//   Full output: <logPath>
//   Get this worktree ready (the setup lines are at the top of plans/<slug>/DESIGN.md), then carry on
//   with your task.
export function formatSetupNote(result, { slug }) {}
```

## Tests

- [ ] No note → the instruction is byte-identical to today's.
- [ ] A note → appended after one blank line; argv still has the instruction as one positional.
- [ ] The fake platform records the note.
- [ ] formatSetupNote with an empty tail omits the "Last lines" part.

## Done when

- [ ] `spawn` accepts and delivers a note, tested on the real argv builder and the fake.
- [ ] Nothing passes a note yet (T07 does).
