# T03 — group-steps-drill

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** light

## Goal

Use the finished conversation view as a person would, at every size, and judge it against DESIGN §2 and
the approved prototype; fix what has one right answer, bring the person only choices with two defensible
answers, and write the behaviour into `/docs` and the README so a reader learns it exists.

## Design sections this implements

DESIGN §2 as a whole; §1 success criteria; `CLAUDE.md § The README follows every major feature`.

## Files

- `docs/detached-runs.md`: § The conversation view (the paragraph that says each tool step is one line),
  § Key bindings (the Conversation row's `Tab` wording), § The mouse (the Conversation row of the table,
  and the rule that a click outside the box does nothing now excepts group lines)
- `README.md`: the paragraph on the conversation view and the mouse paragraph under the key table
- `src/core/conversation.mjs`, `src/shell/conversation-view.mjs` and their tests, only for a drill fix,
  each with a test

## Tests

- [ ] Each drill fix comes with a test that failed before it.

## Done when

- [ ] The drill below was run at both sizes and its result is written in the commit message and one PROGRESS note line.
- [ ] `docs/detached-runs.md` and `README.md` describe grouping, the per-kind label, `· N failed`, `· N refused`, click to open and fold, hover, and Tab's full detail, and say only what the code does.
- [ ] `npm test` is green; under PROGRESS "Blocked on the user" the `./install.sh` refresh after the merge is noted (DESIGN §5).

## End to end (the worker drives this)

- suite: `src/shell/conversation-rig.test.mjs` for any fix; the drill itself by driving `pir` under the rig (`node src/shell/conversation-rig.mjs`, or `openScreen` scripted) against the fake Claude · sizes: 80×24, 120×40
- [ ] Watch the `tour` opening arrive: each step shows while running and folds when done; the count grows; the failed step flags the group; a refused request's step reads refused.
- [ ] Open and fold groups with clicks while following the end and while scrolled up; the clicked line stays put, the steps come into view.
- [ ] Hover over group lines and other lines; only group lines brighten.
- [ ] Drag to copy across a group line and a message (only with T02's `pbcopy` shim on `PATH`, never the real clipboard).
- [ ] Tab to full detail and back, with a group open.
- [ ] Leave the conversation with ← and reopen it: all folded.
- [ ] At 80 columns a long mixed label clips with `…` and keeps `· N failed`.
- [ ] Compare with `plans/group-commands/prototype/index.html`: same markers, same wording, same order.
