# T03 — person-input

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

The pure rules for what the person tells pir: the shape of an inbox drop and its validation, and the
"do not ask this worker again" grant list with its matcher. The forwarder (T07) and the view (T13) both
use it, so the rules live once.

## Design sections this implements

DESIGN §2.5, §2.6.

## Files

- `src/core/person-input.mjs` (new), `src/core/person-input.test.mjs` (new)

## Interface

```js
// Validate a parsed drop. Returns the normalised input or an error string; never throws.
validateDrop(obj) → { ok: true, input } | { ok: false, error }
// input kinds exactly as DESIGN §2.5: message, interrupt, permission, answers, decline-questions.

// Grants, one list per worker, held by the coordinator.
grantFrom(request) → Grant | null            // the request's addRules suggestion, or null
grantMatches(grant, request) → boolean       // same tool; exact ruleContent, or `prefix:*` prefix match
decidePermission(grants, request) → 'allow-by-grant' | 'ask'
```

## Tests

- [ ] each valid kind round-trips; missing `to`, unknown kind, empty message text, missing requestId are errors
- [ ] `answers` values must be strings; a non-object answers map is an error
- [ ] grant from a Bash suggestion `touch a.txt` matches `touch a.txt` only
- [ ] grant `npm test:*` matches `npm test`, `npm test -- x`, not `npm testx`… (follow Claude's rule; note
      the decision in the file header)
- [ ] a grant for Bash never matches Edit; a request without suggestions yields no grant
- [ ] `decidePermission` with several grants, none matching → `ask`

## Done when

- [ ] `npm test` green with the tests above
- [ ] the prefix-match rule is written in the module header with its source (Claude's permission rule docs)
- [ ] boundary test passes
