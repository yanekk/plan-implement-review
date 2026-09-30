# T02 — finisher-brief

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Every message pir sends the finisher session, as pure functions, so the wording is reviewed in one
place and tested, as `coordinator-brief.mjs` does for the coordinator agent.

## Design sections this implements

DESIGN §2.2, §2.7, §2.8, §2.12.

## Files

- `src/core/finisher-brief.mjs` (new), `src/core/finisher-brief.test.mjs` (new)

## Interface

```js
export function finisherOpening({ slug, branch, rulesPath, rulesSource, statusDir, reportPath, mainCheckout })
// engages the pir-finisher skill; names the rules file and its source (built-in says install.sh never
// ran), the branch, the person's main checkout path, the report, the status folder; says look-only
// until the go, and how the go is asked (§2.7)
export function finisherResumed({ phase, stuckSummary })    // restarted; re-ask the go if one was open
export function finisherRefusal(why, file)                   // a status file refused, and why
export function finisherResynced({ mainSha })                // main moved: re-check, write a fresh ready
export function finisherGateRefusal(toolName, phase)         // what it may do in this phase
export function finisherNotGo(answer)                        // the person answered Not yet / other: wait
```

## Tests

- [ ] Opening names each rules source distinctly, including `built-in`, and the status folder path.
- [ ] Opening and resumed mention `pir-finisher` and the `Go` header.
- [ ] Resumed after `finishing` carries the stuck summary and says a fresh go is needed.
- [ ] Gate refusal differs between look-only phases and `done`.
- [ ] No function reads the clock or env (boundary test).

## Done when

- [ ] The functions exist with the tests above passing.
- [ ] Every message is plain text under 1500 characters.
