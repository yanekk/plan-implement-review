# T05 — split-conversation-rig

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Split `src/shell/conversation-rig.test.mjs` (21 top-level tests, about 72 s serial; two "group lines" tests
at about 18 s each, the tour walk at 15.5 s) into 2–3 files so its cost drops to about its largest group.
Keep the group-lines tests and the tour in different files. Every test is kept unchanged.

## Design sections this implements

DESIGN §2.4.

## Files

- `src/shell/conversation-rig.test.mjs` — kept holding one part, or removed.
- `src/shell/conversation-rig-*.test.mjs` — the other parts.
- `src/shell/conversation-rig-helpers.mjs` — only if more than one new file needs a helper (for example
  `scratchHome`). Not a test file, and distinct from `conversation-rig.mjs`, which is not changed here.

## Interface

No product interface.

## Tests

- [ ] Before the split, save the sorted test names of the file (spec reporter).
- [ ] After, the same over `src/shell/conversation-rig*.test.mjs` gives an identical sorted list.
- [ ] Each new file passes alone.

## Done when

- [ ] The sorted test-name lists before and after are identical, shown in the commit.
- [ ] `npm test` is green and no test body or assertion changed.
- [ ] No new file takes longer than 40 s alone, quiet machine (or under load per DESIGN §5 Measuring time), with the per-file times in the commit.
