# T01 — coordinator-rulebook

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure rules that make the agent safe without trusting it: which waiting items are reserved for the
person, what a decision file must look like, and whether a given decision may be applied to what is
waiting now. Everything the command later refuses or passes on is decided here, in the pure core.

## Design sections this implements

DESIGN §2.3 (decision kinds), §2.4, §2.11 (bad decisions), §3.3.

## Files

- `src/core/coordinator-policy.mjs` (new), `src/core/coordinator-policy.test.mjs` (new).
- `src/core/person-input.mjs`: export `ruleMatches` (no behaviour change).

## Interface

```js
// request: the normalised request from stream.mjs readRequest, plus matchedAskRule/defaultToNo when present.
// askRules: string[] from the project's .claude/settings.json permissions.ask (the shell reads the file).
export const DESTRUCTIVE; // RegExp[] over a Bash command; DESIGN §3.3
export function reservedFor(request, askRules = []) // → null | { kind: 'ask-rule'|'destructive', why: string }

// A decision file, as the agent writes it:
//   { kind: 'permission', worker, requestId, decision: 'allow'|'deny', reason, notable?: bool }
//   { kind: 'answers',    worker, requestId, answers: { [question]: string }, reason, notable? }
//   { kind: 'message',    worker, text, reason, notable? }
//   { kind: 'pass',       worker, requestId?, reason, suggestion }
//   { kind: 'report',     sections: { delivered, checkByHand, risks } }   // markdown strings
//   { kind: 'close' }
export function readDecision(obj) // → { ok: true, decision } | { ok: false, error }

// waiting: [{ worker, task, kind: 'permission'|'questions'|'report', requestId?, request?, reserved? }]
export function checkDecision(decision, waiting) // → { ok: true, apply } | { ok: false, why, passOn: bool }
```

`apply` is the decision normalised for the shell (`{ kind, worker, requestId, result | text, ledger }`),
so the shell does no interpretation. `passOn` is true only for a `permission` on a reserved item: the
item goes to the person with the agent's reason as its note.

## Tests

- [ ] `reservedFor`: each recorded case in `src/shell/fake/fixtures/coordinator-requests.json` (T00).
- [ ] `matchedAskRule` present → ask-rule; `defaultToNo` → destructive; neither and no match → null.
- [ ] A `Bash(git push:*)` ask rule matches `git push origin main`, not `git status`.
- [ ] Each `DESTRUCTIVE` entry matches its command and does not match a near miss (`rm file.txt`,
      `git push`, `git reset --soft`, `git branch -d`, `select * from drops`).
- [ ] Destructive matching inside a compound command (`cd x && rm -rf y`).
- [ ] `readDecision`: every kind accepted with its fields; missing field, unknown kind, non-object,
      `answers` not a map, empty `text` all refused with a named error.
- [ ] `checkDecision`: unknown worker, unknown or already-gone requestId, kind mismatch (`answers` for a
      permission), `message` to a worker not report-parked, `permission` on a reserved item (passOn),
      `pass` on anything waiting (ok), `report`/`close` pass through.

## Done when

- [ ] `coordinator-policy.mjs` exports the interface above and `boundary.test.mjs` passes with it.
- [ ] Every test above passes in `npm test`.
- [ ] `ruleMatches` is exported and the grant tests still pass unchanged.
