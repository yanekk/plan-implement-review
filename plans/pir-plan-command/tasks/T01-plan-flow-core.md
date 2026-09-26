# T01 — plan-flow-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rulebook of a planning run: given its saved state and what the shell just observed, what
happens next. Every transition of DESIGN §2.5–§2.7 and §2.14 lives here, so the planning program
(T06, T07) is a thin executor and every crash point is tested in milliseconds.

## Design sections this implements

DESIGN §2.3 (names, instructions), §2.4, §2.5, §2.6 (as sub-step decisions), §2.7, §2.14, §3.3, §3.5.

## Files

- `src/core/planflow.mjs` (new)
- `src/core/planflow.test.mjs` (new)

## Interface

```js
export const RUN_ID_RE = /^plan-[0-9a-f]{4}$/;
export function isValidSlug(slug) → boolean          // kebab, not RUN_ID_RE
export function runIdFrom(hex4) → 'plan-' + hex4      // throws on non-hex4
export function planSessionName({ repo, plan, step }) → '{repo} / {plan} / plan / planner|reviewer'
export function plannerInstruction({ reportsDir, brief }) → string   // DESIGN §2.3, exact
export function reviewerInstruction({ reportsDir, slug }) → string   // DESIGN §2.3, exact
export function parsePlanReport(text) → { kind: 'planned'|'no-plan'|'reviewed'|'not-reviewed', plan } | null
export function initialPlanState({ id }) → state      // DESIGN §3.5, step 'plan', slug null
export function decidePlanStep(state, facts) → { state, actions }
//   facts = { resume: bool, reports: [parsed], activity: 'busy'|'idle'|'permission'|'questions'|'exited'|'none',
//             checks: { ok: bool, reason: string|null } | null,          // §2.5/§2.7 git checks for the last report
//             renamed: { branch, worktree, control, index } }            // sub-steps already done on disk
//   actions ⊂ [{type:'spawn', step, resumeSessionId?}, {type:'send', text}, {type:'close'},
//              {type:'rename', substep:'branch'|'worktree'|'control'|'index'},
//              {type:'finish', outcome}, {type:'exitCrashed'}]
```

`parsePlanReport` accepts the header form of DESIGN §2.4 only; a body without it is `null`, never
guessed (the worker parser's prose fallback is not carried over, because a planning session has no
reason to write `kind=` in prose).

## Tests

- [ ] `isValidSlug`: kebab accepted; uppercase, spaces, leading dash, empty, `plan-3f9a` rejected.
- [ ] `parsePlanReport`: each of the four kinds; `plan=-`; garbage and missing header → null.
- [ ] Instructions match DESIGN §2.3 byte for byte, brief with blank lines kept.
- [ ] First decide on a fresh state spawns the planner, no resume id.
- [ ] `planned` with checks ok while busy → no close yet; then idle → close and rename sub-steps in order.
- [ ] `planned` with a failed check → one `send` naming the reason; state stays in `plan`.
- [ ] The same failed report seen twice → one `send`, not two.
- [ ] `no-plan` → close, finish `no-plan`.
- [ ] Planner `exited` with no report → `exitCrashed`.
- [ ] Rename with some sub-steps done → only the missing ones, then spawn reviewer.
- [ ] `reviewed` ok → close when not busy, finish `reviewed`; failed check → `send`.
- [ ] `not-reviewed` → close, finish `not-reviewed`.
- [ ] Resume in `plan`, in `review`, in a half-done rename, and after `not-reviewed`: spawns the step with
      the last session id; a finished `reviewed` or `no-plan` state yields no actions.
- [ ] A report whose `plan=` differs from the renamed slug during review is ignored.

## Done when

- [ ] Every row above passes in `npm test`; `boundary.test.mjs` still green.
- [ ] `decidePlanStep` reads no clock and no file (boundary test).
- [ ] The action list is the only way it asks for effects.
