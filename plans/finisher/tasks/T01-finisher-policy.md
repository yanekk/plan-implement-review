# T01 — finisher-policy

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rulebook for the finisher: which phase it is in, what each phase lets it do, which Bash
commands only look, which answer is the person's go, which status files are valid, and which rules
file is used. Everything pir enforces about the finisher is decided here, so it can be tested
exhaustively without a session.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.5, §2.6, §2.7.

## Files

- `src/core/finisher-policy.mjs` (new)
- `src/core/finisher-policy.test.mjs` (new)
- `src/core/coordinator-policy.mjs`: export `commandParts` and `commandTails` if not already exported
  (read-only reuse, no behaviour change).

## Interface

```js
export const PHASES = ['preparing', 'awaiting-go', 'finishing', 'stuck', 'done'];
export const LOOK_ONLY;                       // DESIGN §2.4 list, as matchers over one command part

export function isLookOnly(command) → boolean
// every part from commandParts is on LOOK_ONLY; any `>`/`>>`/`tee`, or a $() / backtick body that is
// not itself look-only, → false

export function finisherVerdict({ phase, toolName, input, askRules, paths }) → 'allow' | 'deny' | 'person'
// paths: { readRoots: string[], statusDir: string } already canonical; the shell canonicalises input
// paths before calling (pure side reads no fs).
// look-only phases: Read/Glob/Grep under readRoots → allow; Bash look-only → allow; Write strictly
//   inside statusDir → allow; Skill pir-finisher → allow; AskUserQuestion → 'person'; else deny.
// finishing: reservedFor(request, askRules) → 'person'; AskUserQuestion → 'person'; else allow.
// done: deny everything.

export function readStatus(obj) → { ok: true, status } | { ok: false, why }
// shapes of DESIGN §2.6; steps a non-empty array of non-empty strings for ready and stuck

export function checkStatus(status, phase) → { ok: true, next } | { ok: false, why }
// accepted-in-phase table of §2.6; next is the phase after it (ready → awaiting-go, stuck → stuck,
// done → done, close → phase unchanged; the shell ends the run)

export function isGoAnswer({ phase, toolName, input, answers }) → boolean
// §2.7: phase awaiting-go|stuck, AskUserQuestion with one question whose header === 'Go',
// answers[thatQuestion] === 'Go'

export function afterRestart(phase) → { phase, stuckSummary | null }
// finishing → stuck with the §2.12 summary; others unchanged; unknown/missing → preparing

export function chooseRules({ featurePath, home, repo, engineDir, exists }) → { path, source }
// source: 'project' | 'yours' | 'default' | 'built-in'; order of §2.2
```

## Tests

- [ ] `isLookOnly`: every LOOK_ONLY entry accepted; `git merge`, `git commit`, `git push`, `rm`, `npm i`,
      `./install.sh` rejected; `git status > x`, `cat a | tee b`, `ls; git merge x`, `echo $(git merge x)`,
      `` echo `rm -rf /` `` rejected; `git branch -D x`, `git branch newname` rejected, `git branch --list` accepted.
- [ ] `finisherVerdict` for every phase × {Read, Glob, Grep, Bash look-only, Bash acting, Write in
      statusDir, Write elsewhere, Edit, Skill pir-finisher, Skill other, AskUserQuestion, WebFetch}.
- [ ] finishing: `rm -rf build` → person; an askRules match → person; `git merge pir/x` → allow.
- [ ] `readStatus`: each valid shape; missing kind, empty steps, non-string step, unknown kind refused.
- [ ] `checkStatus`: the whole accepted-in-phase table, including `done` refused outside finishing.
- [ ] `isGoAnswer`: Go in awaiting-go and stuck → true; Go in preparing/finishing → false; `Not yet`,
      header `go` (case), two questions, a non-AskUserQuestion → false.
- [ ] `afterRestart` for each phase and for undefined.
- [ ] `chooseRules`: each of the four outcomes; a project file wins over an existing personal one.

## Done when

- [ ] Every function above exists with the listed tests passing in `npm test`.
- [ ] `boundary.test.mjs` passes (no fs, clock or process in the module).
- [ ] `coordinator-policy.mjs` behaviour is unchanged (its tests untouched and green).
