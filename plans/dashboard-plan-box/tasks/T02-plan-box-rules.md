# T02 — plan-box-rules

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The box's decisions, pure: how its text is read, which repos rank first, and which key goes to the list
and which to the box. Every rule the person can trip over on this screen lives here, so it is tested
exhaustively in milliseconds instead of through a pty.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4 (ordering), §2.5.

## Files

- `src/core/planbox.mjs` (new), `src/core/planbox.test.mjs` (new)

## Interface

```js
export const BARE_TEXT = '@';
export function isBare(text) → boolean                       // '@' or ''
// repos: [{ name, path, mtimeMs }]; roots: display string, e.g. '~/src'
export function parseBoxText(text, repos, { roots }) →
    { ok: true, repo, brief }                                 // brief trimmed, newlines kept
  | { ok: false, reason: 'no-at'|'unknown-repo'|'ambiguous-repo'|'empty-brief', name?, paths?, note }
export function startFailedNote(name, reason) → string        // 'Could not start planning in {name}: {reason}'
export function headLine(text, repos, { roots }) → { text, style }   // §2.6: 'in {name}' | 'start with @repo' (dim bare, amber no name) | '@x is not a repo in {roots}'
export function rankRepos(repos) → repos                      // mtimeMs desc, then name asc; a new array
// key: pi-tui parseKey name ('up', 'enter', 'escape', 'ctrl+c', 'ctrl+s', 'shift+enter', 'a', …) or null for text
export function routeBoxKey({ text, key, completing, newLine }) → 'list'|'box'|'reset'|'quit'|'submit'
//   newLine: true when the data matches tui.input.newLine (the caller asks pi-tui's keybindings)
export function absorbAt(text, data) → data                   // §2.3: text exactly '@' and data starts with '@' → data minus that '@'
```

The note strings are exactly §2.5's table; they are exported so T04/T05 tests assert on the same text.

## Tests

- [ ] Every row of §2.3 on a bare box (both `@` and `''`) and on a typed one, with and without `completing`.
- [ ] Ctrl+S/X/R go to the list whether bare or typed; Esc and Ctrl+C reset when typed, quit when bare.
- [ ] Enter with `newLine` true is `box`, never `submit`.
- [ ] `absorbAt`: `'@'` + `'@'` → `''`; `'@'` + `'@skaut x'` → `'skaut x'`; `''` + `'@'` and `'@s'` + `'@'` unchanged.
- [ ] `parseBoxText`: each §2.5 row; exact-name only (`@ska` with `skaut` listed is `unknown-repo`); a
      multi-line brief keeps its newlines; `@skaut` alone and `@skaut   ` are `empty-brief`; a name
      followed by a newline then the brief parses; two repos named alike give `ambiguous-repo` with both paths.
- [ ] `headLine` for bare, resolved, unknown, and no name (`hello`, `@ hello`: amber `start with @repo`).
- [ ] `parseBoxText('@ a brief')` is `no-at`, as a text without `@` is.
- [ ] `rankRepos`: newest first, equal mtimes by name, input not mutated.
- [ ] `boundary.test.mjs` still passes with the new file.

## Done when

- [ ] `planbox.mjs` exports the interface above with no shell import; `npm test` green.
- [ ] Every §2.3 row and §2.5 case has a named test.
