# T06 — helpers-drill

**Phase:** 3 · **Depends on:** T03, T05 · **Weight:** light

## Goal

Use the whole flow as the person would, on the rig, and judge it against DESIGN §2.2–§2.6: helper lines
while they work and after they end, the Tab view, a helper's permission request, the warning, the
interrupt and the note. Fix what has one right answer, with a test each; bring the person only a choice
with two defensible answers. Follow `pir-e2e`.

## Design sections this implements

DESIGN §2.2–§2.6, §2.8.

## Files

Whatever the drill fixes, each with a test. The drill's record goes in `FINDINGS.md` as worker-driven.

## End to end (the worker drives this)

- rig: `node src/shell/conversation-rig.mjs --scenario helpers --into <scratch>`, then `pir` from another
  pty · sizes: 80×24, 120×40, and one narrow 60×20
- [ ] The two helper lines read as §2.2 at every size: clipped, not wrapped, never overlapping the pinned
      prompt.
- [ ] Nothing in the default view can be mistaken for the parent's own words or steps; Tab shows the
      helpers' work labelled, and Tab again returns.
- [ ] The helper's permission request names the helper and is answerable with the usual keys.
- [ ] The warning is noticeable, lists the running helpers, and any other key cancels it cleanly.
- [ ] After Esc Esc, the stopped line and the note under the next message read as §2.5–§2.6.
- [ ] The run's list row never reads `asking you` while a helper runs and the parent is idle; it reads
      `asking you · allow a command?` while the helper's request waits.
- [ ] The `tour` scenario still behaves as before (a quick pass: steps, a permission, a question set, Esc).

## Done when

- [ ] Every point above has been driven at every size and holds, or was fixed with a test that passes in
      `npm test`.
- [ ] A dated `FINDINGS.md` row records the drill as worker-driven and names what it fixed.
