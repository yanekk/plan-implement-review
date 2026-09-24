# T01 — parse-test-block

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The pure parser for the setup/test front-matter block at the top of DESIGN.md. Every other part of the
plan (start refusal, end gate, worker setup, the fixture check) reads the block through this one
function, so its reasons are the messages the person sees.

## Design sections this implements

DESIGN §2.1, §3.1.

## Files

- `src/core/testblock.mjs` (new)
- `src/core/testblock.test.mjs` (new)

## Interface

```js
// parseTestBlock(designText) →
//   { ok: true,  setup: string[], test: string[] }      // setup [] when `setup: none`
//   { ok: false, reason: string }                        // reason is shown to the person verbatim
export function parseTestBlock(designText) {}
```

Reasons, exactly: `no front-matter block` (first line not `---`, or no closing `---`), `no setup key`,
`no test key`, `setup: expected none or a list`, `test: expected a list of commands` (for `none`, a
string, or an empty list), `line {n}: expected "  - <command>"` (n is the 1-based file line).

## Tests

- [ ] The DESIGN §2.1 example → setup `['cd server && npm ci']`, test `['make test', 'make server-test']`.
- [ ] `setup: none` → setup `[]`; `setup:` with an empty list → `setup: expected none or a list`.
- [ ] `test: none`, `test: make test`, `test:` with no items → the test reason.
- [ ] Missing `setup` / missing `test` → the matching reason.
- [ ] No block, a block not on line 1, an unclosed block → `no front-matter block`.
- [ ] Blank lines and whole-line `#` comments anywhere in the block are skipped; `- make test  # quiet`
      keeps the trailing comment; `setup: none  # note` is rejected (no comments on key lines).
- [ ] Quotes, colons and `&&` in a line survive verbatim.
- [ ] Unknown keys (with or without their own lists) are ignored.
- [ ] A stray non-item line inside a list → `line {n}` with the right number.
- [ ] CRLF line endings parse the same as LF.
- [ ] null/undefined/'' → `no front-matter block`.

## Done when

- [ ] `parseTestBlock` returns the shapes above for every listed case, and `npm test` is green.
- [ ] `boundary.test.mjs` still passes (no fs, no child_process).
