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
// every part from commandParts is on LOOK_ONLY (a git entry may lead with `-C <path>`; `cd <path>` is
// on it); redirects are checked on the raw command first, since commandParts cuts them. Any `>`/`>>`/
// `tee`, `<(`/`>(`, a nested or non-look-only $() / backtick body, `git -c`, `--output`, `--ext-diff`
// → false

export function finisherVerdict({ phase, toolName, input, askRules, fileVerdict }) → 'allow' | 'deny' | 'person'
// fileVerdict: 'allow' | 'deny', the coordinator agent's `gateFor` answer for Read/Glob/Grep/Write/Skill
// (roots, status folder and skill `pir-finisher`), computed by the shell (T04), which owns the path
// canonicalising; this module does no path checks of its own (DESIGN §3.2).
// look-only phases: Read/Glob/Grep/Write/Skill → fileVerdict; Bash look-only → allow;
//   AskUserQuestion → 'person'; else deny.
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

export function afterRestart(phase) → { phase, stuckSummary | null }   // goGiven is kept as stored
// finishing → stuck with the §2.12 summary; others unchanged; unknown/missing → preparing

export function chooseRules({ featurePath, home, repo, engineDir, exists }) → { path, source }
// source: 'project' | 'yours' | 'default' | 'built-in'; order of §2.2
```

## Tests

- [ ] `isLookOnly`: every LOOK_ONLY entry accepted; `git merge`, `git commit`, `git push`, `rm`, `npm i`,
      `./install.sh` rejected; `git status > x`, `cat a | tee b`, `ls; git merge x`, `echo $(git merge x)`,
      `` echo `rm -rf /` `` rejected; `git branch -D x`, `git branch newname` rejected, `git branch --list` accepted;
      `git -C /repo status`, `cd /repo && git status` accepted; `git -C /repo merge x`, `git -c core.pager=x log`,
      `git log --output=f`, `git diff --ext-diff`, `diff <(ls) x`, `echo $(echo $(rm x))` rejected.
- [ ] `finisherVerdict` for every phase × {Read, Glob, Grep, Write, Skill with fileVerdict allow and deny,
      Bash look-only, Bash acting, Edit, AskUserQuestion, WebFetch}.
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
