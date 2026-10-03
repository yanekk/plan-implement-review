# T02 — finisher-for-single

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The finisher assumes it is finishing a parallel build: its opening says so, names a plan and a
`REPORT.md`, and its skill reads that report. Make the one finisher able to finish a single run too,
with every rule of its fence, phases, statuses and go unchanged (DESIGN §2.7). Builds see no difference.

## Design sections this implements

DESIGN §1 Stance, §2.7.

## Files

- `src/core/finisher-brief.mjs`, `src/core/finisher-brief.test.mjs`
- `src/shell/finisher-agent.mjs`, `src/shell/finisher-agent.test.mjs`
- `skills/pir-finisher/SKILL.md`, `src/core/finisher-skill.test.mjs`

## Interface

```js
// finisher-brief.mjs. kind defaults to 'build': the existing text, byte for byte.
export function finisherOpening({ kind = 'build', slug, branch, base, rulesPath, rulesSource, statusDir,
  reportPath, promptPath, mainCheckout })
// kind 'single': first line
//   "Invoke the pir-finisher skill and follow it. You are the finisher of the single run `{slug}`: a small
//    change, built and reviewed, whose branch is ready to merge into `{base}`."
// no `Plan:` and no `Report:` line; adds `Change asked for: {promptPath}`; every other line as for a build.

// finisher-agent.mjs: two new optional args; everything else unchanged.
startFinisher({ ..., kind = 'build', promptPath = null, reportPath = null, ... })
// kind 'single': session name `${basename(repoRoot)} / ${slug} / single / finisher` (today hard-coded
// `${basename(repoRoot)} / ${slug} / finisher`); reportPath may be null and is never rendered (no `Report:` line).
// The opening passes kind and promptPath through. The fence, gate, phases, drain, go scan, ledger,
// state.json and resume do not read kind.
```

Skill: the description and opening paragraph cover "a parallel PIR build run or a single run"; § Your
opening instruction lists `Change asked for` as the single run's counterpart of the report; § What to
check, step 5 says: for a build read `plans/{slug}/REPORT.md`; for a single run read the `Change asked
for` file and `git log --oneline <target>..pir/{slug}`, and say in the summary what is being delivered;
the status-folder line (today "ends in `control/finisher/status/`") also names a single run's
`.parallel/single/finisher/status/`. Nothing else in the skill changes.

## Tests

- [ ] `finisherOpening` with no `kind` equals today's text for the same args (snapshot of the current output).
- [ ] `kind: 'single'` names the single run, has `Change asked for:`, has no `Plan:` and no `Report:`, keeps `Target branch:`, `Rules file:`, `Main checkout:`, `Status folder:`, and the go-question line; stays under 1500 characters.
- [ ] `startFinisher({ kind: 'single', reportPath: null, promptPath })` starts with the single opening and the single session name (fake spawner).
- [ ] A single-kind finisher in `preparing` is refused a `git merge` and allowed `git log` exactly as a build's (the gate does not read kind).
- [ ] Skill test: the status-folder line names both folders.
- [ ] Skill test: the skill mentions the single run's `Change asked for` and the `git log` check, and still names `REPORT.md` for builds.
- [ ] Every existing finisher, finisher-brief, finisher-skill and hand-over test passes unchanged.

## Done when

- [ ] `startFinisher` accepts `kind: 'single'` and `promptPath`, with the opening and name above.
- [ ] The skill covers both kinds; `./install.sh` run and the installed skill diffed equal to `skills/pir-finisher`.
- [ ] `npm test` green.

## Outside actions

- Refresh the installed engine and skills — `ask` (DESIGN §5.3)
