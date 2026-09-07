# T01 — Project scaffold, `npm test`, the boundary test

**Phase:** 1 · **Depends on:** — · **Weight:** light · **Runs:** auto

## Goal

Give the project the one thing the base method requires and it does not yet have: a test command
that is the only evidence a session may produce on its own. Set up a dependency-free Node
project, wire `npm test` to run `node --test` quietly, with no colour, loud on failure, and
write the boundary test that keeps the pure core pure. Everything after this task proves itself
through this command, so it is built first.

## Design sections this implements

DESIGN §3.1 (the boundary and the test that enforces it), §5 (the environment and the exact test
command).

## Files

- `package.json` — `"type": "module"`, the `test` script, no runtime dependencies.
- `src/core/` and `src/shell/` — created, each with a first stub so the layout is real.
- `src/core/boundary.test.mjs` — the boundary scanner test.
- A short `README.md` note on how to turn verbose output back on.

## Interface

```
package.json:
  "scripts": { "test": "NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'" }
  # exact glob/reporter confirmed on the machine; a passing run is a few lines, exit code carries it.
  # verbose for debugging: node --test --test-reporter=spec 'src/**/*.test.mjs'

boundary.test.mjs:
  reads every file matching src/core/*.mjs (excluding *.test.mjs)
  fails if any contains:  node:fs | node:child_process | node:net | fetch( |
                          Date.now | new Date() with no argument | Math.random
  message on failure names the file and the forbidden token, and says: move it to shell/.
```

## Tests

- [ ] `npm test` exits 0 on an all-green run and prints only a short summary, not a line per test.
- [ ] `npm test` exits non-zero and prints the failing test's file, line and diff when one fails.
- [ ] The boundary test passes on the empty/stub core.
- [ ] The boundary test fails when a core stub is given a `node:fs` import (prove it bites), then
      that stub is reverted.
- [ ] Colour is off in the output even when `FORCE_COLOR=1` is set in the environment.

## Done when

- [ ] `npm test` runs, is quiet on pass, loud on failure, and colourless regardless of the
      caller's environment.
- [ ] The boundary test exists and has been shown to fail on a forbidden import and pass without.
- [ ] `env | grep -i color` was checked and anything forcing colour is recorded in DESIGN §5.
