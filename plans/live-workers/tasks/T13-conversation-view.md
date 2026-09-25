# T13 — conversation-view

**Phase:** 3 · **Depends on:** T02, T07, T12 · **Weight:** heavy

## Goal

The third view of the `pir` screen: a worker's conversation, read from its log and followed live, with a
typing box that sends to the worker, Esc to interrupt, one-key answers to a permission request, the
question-set picker, slash-command autocomplete, and a read-only mode for a finished worker. Every rule
about content is T02's; this task paints it and routes keys through T07's drop.

## Design sections this implements

DESIGN §2.5 (not-running refusal), §2.6, §2.7, §2.8, §2.9, §2.11 (conversation view, key table), §2.14
(huge log). Prototype: `plans/live-workers/prototype/` (a reference for the feel, not a spec).

## Files

- `src/shell/conversation-view.mjs` (new), `src/shell/conversation-view.test.mjs` (new)
- `src/shell/log-follow.mjs` (new, or inside the view if small): read the last 256 KB, then follow appends
- `src/shell/pir-tui.mjs` (mount the view for `ui.view === 'worker'`)

## Interface

```js
createConversationView({ run /* slug, controlDir, pid */, worker /* openWorker from T12 */,
                         follow, drop = dropPersonInput, alive, onBack }) → pi-tui Component
// Owns: an Editor (pi-tui) with autocomplete from init.slash_commands minus terminal_slash_commands,
// a scroll view of buildConversation(...).lines, the pinned prompt, and the key hint line.
followLog(path, { tailBytes = 262144, onEntries }) → { stop() }   // partial last line held until complete
```

Key routing follows DESIGN §2.11's table exactly. y/n/a and the picker keys act only while the box is
empty; typed text with a pending permission sends a refusal carrying the text; with a pending question set
it sends `decline-questions`.

## Tests

- [ ] follow: tail of a large file starts at a line boundary; appended lines arrive; a partial line waits
- [ ] Enter with text drops a `message`; Esc drops `interrupt`; ← with text does not navigate
- [ ] y / n / a drop the right `permission` decision; `a` absent when the gate says so
- [ ] picker keys drive `pickerReducer` and the final Enter drops `answers`
- [ ] coordinator not alive: nothing dropped, the view says the run is not running, the text stays
- [ ] read-only worker: no editor, only ← and scrolling work
- [ ] autocomplete offers `/context`, never `/doctor`

## Done when

- [ ] `npm test` green with the tests above
- [ ] against a fake run (fake platform, real log and inbox) the view shows a permission, answers it, and the fake continues
- [ ] the person's verdict on the feel is recorded in FINDINGS

## Environment (the worker owns this)

```
bring-up: `npm ci` in this task's worktree; a harness fixture materialised with `installFixture` (it carries
          this worktree's skills/) in a trusted scratch path (not a harness run: those write no index
          record and `pir` would not list them); in the scratch repo,
          `PARALLEL_MAX_WORKERS=1 node <worktree>/src/shell/pir.mjs <fixture>` detached (the installed `pir` is
          still the old engine during the parallel build)
teardown: Ctrl+S twice in pir (or `touch …/control/HALT`), confirm no worker pid from workers.json is alive,
          delete the scratch copy
```

## Needs a person

```
node <worktree>/src/shell/pir.mjs        # then open the scratch run, pick the working task, →
```

Expect: the worker's conversation, one line per step, updating live; typing and Enter reaches the worker;
Esc stops it within a second; a permission request answered with y/n/a; a question set answered with the
picker; ← returns to the run.
Tell me: does it read and respond the way you expected from the prototype, and what feels wrong.

## Outside actions

- Install packages from npm — `ask` (`npm ci` in the worktree)
- Person-check scratch run — `ask` (the scratch run above, ceiling 1)
