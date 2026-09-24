# T04 — end-gate-from-block

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

The end-of-run gate runs exactly the declared setup lines and then the test lines on the finished
feature branch, and its reason says which half failed. The prose reader goes away.

## Design sections this implements

DESIGN §2.2, §2.5.

## Files

- `src/shell/coordinate.mjs` — `runFeatureTests` and its `runTests` wiring (~line 894)
- `src/core/conflict.mjs` — the conflict prompt's test step names the block
- `src/core/testcommand.mjs`, `src/core/testcommand.test.mjs` — deleted
- `src/shell/coordinate.test.mjs`, `src/core/conflict.test.mjs`

## Interface

```js
// runFeatureTests(featurePath, { slug, logPath, root }) → { ok, half, command, logPath, reason }
//   root: the main checkout, where DESIGN.md is read (DESIGN §2.2), NOT featurePath.
//   Block invalid → { ok: false, half: null, reason: 'plans/<slug>/DESIGN.md: <parser reason>' }
//   Setup fails   → half 'setup', reason "setup `<line>` exited <n>"
//   Test fails    → half 'test',  reason "test `<line>` exited <n>"
//   Both halves write to the one logPath (setup rewrites, test appends).
```

The conflict prompt's test step becomes "the `test` lines at the top of plans/<slug>/DESIGN.md (run
its `setup` lines first if the worktree is not ready)".

## Tests

- [ ] Green setup and test → ok; tests.log has every `$` header in order.
- [ ] Failing setup → half `setup`, no test line ran.
- [ ] Failing second test line → half `test`, the reason names that line.
- [ ] `setup: none` → only test lines run.
- [ ] DESIGN.md read from `root` even when the feature worktree's copy has no block (the restart case).
- [ ] Invalid block → the parser's reason, no command run.
- [ ] No remaining import of `testcommand.mjs` anywhere.

## Done when

- [ ] The gate runs the block's lines from the main checkout's DESIGN.md, reasons as above, tested.
- [ ] `testcommand.mjs` and its test are gone and `npm test` is green.
