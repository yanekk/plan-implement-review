---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Single-run finisher — Design

How parallel mode, single runs and the finisher behave is canonical in `/docs`. This file is build-time
rationale for this plan. T09 carries the resulting behaviour into `docs/single-runs.md`,
`docs/finisher.md`, `docs/human-flow.md`, `docs/control-folder.md`, `docs/detached-runs.md` and the
README. It never edits a finished plan's DESIGN.md (`plans/single-runs/`, `plans/finisher/`).

## 1. Purpose

A single run (`@repo/single`) ends today at `ready to merge`: pir hands the person
`git switch {base} && git merge pir/{name}` to paste. A build with the coordinator agent instead ends
with the finisher, a session pir holds that reads the project's finishing rules, prepares the steps
without running any of them, asks the person one fixed `Go` question, and after `Go` carries them out
(merge, install, check). This plan gives single runs the same ending, reusing the finisher and the
build's end-of-run base sync rather than writing second copies of either.

### Success criteria

- A green single run in a scratch repo ends with the finisher asking `Go`; after the person's `Go` the
  change is merged into the run's base by the finisher and the run ends `finished`. Nothing changes in
  the main checkout before the `Go`.
- If the base moved after the run started, pir merges it into `pir/{name}` and runs the tests before the
  finisher sees the branch; a clash is resolved by a helper session and red tests get one fix session.
- A red single run after its fix attempt reads `not ready`, offers no merge, and waits like a red build.
- Builds behave exactly as before: every existing finisher and coordinator test stays green.

### Stance

- One finisher. The session, its fence, its phases, its status files, its go detection and its rules
  lookup are the build's (`finisher-agent.mjs`, `finisher-policy.mjs`). A single-run finisher that
  differs from the build's in any rule is a defect, because the person trusts one `Go`, not two.
- What lands on the base is what pir tested green, as for builds.
- The go is the person's and only the person's. A single run has no coordinator agent, so every
  question, permission request and `Go` is theirs.

---

## 2. Behaviour specification

### 2.1 When the finisher comes in

Always, on every single run, with no setting to turn it off (user, 2026-10-01). The person can still
merge by hand at any moment before their `Go`; pir sees it and ends the run (§2.5). Reason: the person
asked for single runs to finish as builds do, and a switch costs a setting, its refusals and its docs
for no case they named.

A `dropped` run gets no finisher and no sync: nothing is to be merged.

### 2.2 The end sequence: review → sync → wait

Today the review step ends with `finish('ready')` once its accepted head tested green with a clean
tree. That point now starts the **sync** step instead. The sync mirrors the build's end sequence
(`endSync`, `endSyncing`, `endTests`, `startFix`, `endFixing` in `coordinate.mjs`), with these steps:

1. **Prepare the base.** `prepareBase(root, base, { mode: 'start' })` (`base-branch.mjs`), as a build's
   end does: fetch the remote's copy and decide which commit is the base. A failure (`fetch-failed`,
   `diverged`) holds the sync with `holdText`'s reason and retries every 60 s, as `holdSync` does.
   Reason: never merge a base this sync did not just try to fetch (base-branch DESIGN §2.3, §2.8).
2. **Already merged?** If the base (local ref, or the commit just prepared) already contains
   `pir/{name}`'s tip, the person merged by hand: the run ends `merged`.
3. **Merge the base in.** `syncBase(worktree, { baseSha, base })` (`worktree.mjs`):
   - `up-to-date`: the tested head stands; go to the wait (§2.4) with tests green.
   - `merged` (a merge commit `sync {base} into pir/{name}`): run the tests (§2.3).
   - `conflict`: hold a **resolve** helper (§2.3). `syncBase` throwing (git refused before merging):
     logged, the sync is `unresolved`, the run waits red.
4. **Tests.** Setup then test lines, as every single-run test run (`runLines`). Green: the wait.
   Red, and this sequence has had no fix helper: hold a **fix** helper (§2.3), then test again. Red
   after the fix: the wait, red (§2.6).

Reason for mirroring the build exactly, helpers included: the person chose the build's behaviour over
a lighter fallback (user, 2026-10-01), so that what the finisher merges is what pir tested.

Each sync sequence gets at most one fix helper and one resolve helper; a later sequence (the base moved
again) gets its own, as `resync` resets `fixUsed` for builds.

### 2.3 The two helper sessions

Held through the run's holder exactly as the builder and the reviewer are (`held-session.mjs`): auto
permission mode, Remote Control on, the person answers their questions. One session at a time; the
reviewer is closed before the sync starts.

| Role | Step | Session name | Starts when | Asked to |
|---|---|---|---|---|
| `resolve` | `sync` | `{repo} / {name} / single / resolve` | `syncBase` returns `conflict` | finish the merge in progress: resolve the listed files, keep both sides' intent, commit the merge, report |
| `fix` | `sync` | `{repo} / {name} / single / fix` | the tests are red after a sync, first time this sequence | make the tests pass without undoing the change or the merged base, commit, report |

Their opening instructions (`helperInstruction` in `singleflow.mjs`) name the `pir-single` skill and
the role, say the session is run by `pir single`, and give the reports folder, the branch, the base, and
for `resolve` the conflicted files, for `fix` the failing reason and the log path. The `pir-single`
skill gains one section for the two roles (T04).

Reports, in the single-run format:

```
[pir:v1 kind=resolved single={name}]   the merge is committed
[pir:v1 kind=fixed single={name}]      the fix is committed (or nothing could be fixed; the body says why)
```

Checks: `resolved`: no merge in progress (`syncPending` false), the worktree is clean, `{name}` is the
run's. `fixed`: the worktree is clean, `{name}` is the run's. A failed check is sent to the session once,
as for `built` and `reviewed`. Neither helper may report `dropped`; a helper's kind sent by another step
is ignored, as today.

A helper that exits without an accepted report: `resolve` with the merge still in progress → pir runs
`abortSync`, the sync is `unresolved`, the run waits red (as `endSyncing` does). `fix` → pir runs the
tests anyway (as `endFixing` does). Reason: builds treat a helper that went away the same way, and a
single run must not crash at its last step for it.

Helpers get no red rounds: the `fix` helper is the one attempt (builds' T10 rule), and its result is the
next test run.

### 2.4 The wait, and the hand-over

Once a sync sequence settles, the run is in the **wait** step, with tests `green` or `red`.

- **Green, finisher never started this run** → hand over: start the finisher (§2.7). This happens on
  the pass the sync settles green.
- **Green, finisher fell back** (§2.8) → wait for the person's hand merge, as today's `ready`.
- **Red** → wait red (§2.6).

The single-run program keeps running through the wait (it used to exit at `ready`). Reason: the run
now has things to do there (watch the base, hold the finisher), as a build's coordinator does.

### 2.5 While the finisher waits for the go

Each pass with the finisher on, in the order `finisherWaiting` uses:

1. Drain its statuses (`finisher.drain()`): `done` → the run ends `finished`; `close` → the run ends
   `closed`.
2. After any go (`finisher.goGiven()`), nothing else: the run ends only on `done` or `close`. Reason:
   the finisher's own merge moves the base, and a `stuck` after that merge must still reach the person
   (finisher DESIGN §2.8).
3. Before any go, watch the base (§2.9): `merged` → the run ends `merged` and the finisher is closed;
   `moved` → `finisher.resyncing()` (no go counts from this pass), then a new sync sequence (§2.2).
   When it settles green, `finisher.resynced(baseSha)` (the finisher re-checks and writes a fresh
   `ready`); when it settles red, the finisher is closed for good (fallback `red`) and the run waits red.
   It is never handed over again in this run (user 2026-09-29 for builds, kept here).
4. `finisher.givenUp()` → fallback `gave-up` (§2.8).

### 2.6 Red: not ready, and waiting

A sync sequence that settles red (unresolved merge, or red after the fix helper) leaves the run in the
wait step, tests red. No merge is offered: the merge row and the alert say `not ready` with the reason.
The run keeps watching the base (§2.9) and on `moved` runs a new sync sequence; green then hands over to
the finisher, unless the finisher already fell back in this run. A hand merge by the person ends the run
`merged`. Reason: the person chose to wait like a build over ending the run (user, 2026-10-01).

### 2.7 The finisher for a single run

`startFinisher` (`finisher-agent.mjs`) is called from the single-run program with:

| Arg | Value |
|---|---|
| `kind` | `'single'` (new; `'build'` is the default, so builds are unchanged) |
| `controlDir` | the run's control folder (after the rename, `plans/{name}/.parallel/single/`) |
| `featurePath` | the run's worktree `.claude/worktrees/pir-{name}` |
| `repoRoot`, `mainCheckout` | the repo root |
| `slug` | `{name}`; the branch is `pir/{name}` as for builds |
| `base` | `state.base` |
| `rules` | `chooseRules({ featurePath, home, repo, engineDir, exists })`, unchanged: the same `on-finish.md` and order (user, 2026-10-01) |
| `reportPath` | `null` |
| `promptPath` | `{controlDir}/prompt.md` (new) |
| `askRules` | the worktree's `.claude/settings.json` ask rules, as builds read them |
| `startWorker`, `claudePath`, `remote`, `env` | the single run's own, as it passes them to its holder |

What changes for `kind: 'single'`:

- Session name `{repo} / {name} / single / finisher`. Reason: matches the run's other sessions and
  carries no `T{nn}`, so no coordinator counts it.
- `finisherOpening` says it is the finisher of the single run `{name}` (not "the parallel build of
  plan"), drops `Plan:` and `Report:`, and adds `Change asked for: {promptPath}`. The skill tells it,
  for a single run, to read that file and `git log --oneline {target}..pir/{name}` in place of
  `REPORT.md`. Every other line, the resumed and re-synced messages, the gate's refusals: unchanged.
- Everything else is the build's: the hook, the gate, the look-only list, the phases, `state.json`,
  the ledger, the status shapes and their phases, go recognition, restart budget, `afterRestart`.

Routing the person's answers: the single run's person inbox is wrapped with `withAgent(holder.platform,
() => finisher)` (`coordinator-agent.mjs`), as the build wraps its platform with the coordinator. Reason:
the go is recognised only as an answer logged `from: 'person'` in the finisher's own conversation, and
`holder.platform` knows only the held sessions.

### 2.8 Fallback

The finisher failing to start (`finisher failed to start: …` in `run.log`), or giving up (a fourth exit
in the hour), or the branch turning red under it (§2.5) → fallback, for good in this run. Failed or
gave up: the run waits as today's `ready`, the merge row shows `git switch {base} && git merge
pir/{name}`, and the run ends `merged` when the person merges. Red: §2.6. Reason: the build's fallback
(finisher DESIGN §2.12).

### 2.9 Watching the base

The build's `watchBase` decision moves to a pure function in core (T01) used by both programs:

```
baseWatchVerdict({ containsTip, localTip, localSeen, watched, baseSha }) → 'merged' | 'moved' | null
watchDue({ now, watchFrom, watchMs }) → boolean
```

Each pass in the wait (finisher before any go, red, or fallback) the shell reads the local base; every
`watchMs` (`DEFAULT_BASE_WATCH_MS`, `PARALLEL_BASE_WATCH_MS` overrides, as for builds) it also runs
`prepareBase(…, { mode: 'watch' })`. `containsTip` is `baseContains('pir/{name}', { refs: [local,
tracking] })`. Reason: one rule for "merged or moved" means a fix to it lands in both programs.

### 2.10 Outcomes and resume

A finished single run carries `outcome`:

| Outcome | When | Row |
|---|---|---|
| `finished` | the finisher wrote `done` | `◌ finished` |
| `merged` | the person merged by hand before any go (or during a red or fallback wait) | `◌ merged` |
| `closed` | the finisher wrote `close` | `◌ closed`, merge line still shown |
| `dropped` | as today | `◌ finished` |
| `ready` | legacy only: a run finished by an older pir; read as today (merged check) | as today |

A finished run is final, as today. A run stopped or crashed in `sync` or `wait` is resumable:

- `sync` with a merge in progress and no live resolve helper → `abortSync`, then the sync sequence
  starts again from step 1. A resolve or fix helper's session is reopened by id with the resume message.
  A test run in flight is started again.
- `wait` with the finisher on → `startFinisher` again; it finds its `state.json` and resumes by id, and
  `afterRestart` moves `finishing` to `stuck` (finisher DESIGN §2.12). With `finisher/state.json` present
  and `phase: 'done'` → the run ends `finished` at once.
- `wait` red or fallback → the watch carries on.

### 2.11 On screen

The steps view (opening the row) gains a `sync` row between `review` and `merge`; `merge` becomes the
finisher's row.

```
  build    built · 4m
  review   reviewed · 3m
  sync     main brought in · tests green
  merge    ◆ finisher  waiting for your go
```

| Row | Text | Style |
|---|---|---|
| sync | `waits on review` / `not started` | pending |
| sync | `bringing in {base}` | working |
| sync | `{holdText reason} · retrying` | amber |
| sync | `resolving a clash` (resolve helper working) | working |
| sync | `testing…` (with the test clock) | working |
| sync | `fixing tests` (fix helper working) | working |
| sync | `asking you · …` (a helper asking) | amber |
| sync | `up to date` / `{base} brought in` + ` · tests green` | done |
| sync | `not ready · tests red` / `not ready · clash unresolved` | red |
| merge | `waits on sync` / `not started` | pending |
| merge | `◆ finisher  preparing` / `waiting for your go` / `finishing` / `stuck · needs you` / `asking you` / `done` | the build's finisher row words and styles (`display.mjs`) |
| merge | `git switch {base} && git merge pir/{name}` | fallback wait, and `closed` |
| merge | `merged` | ended `merged` or `finished` |

`→`/`↵` on `sync` opens the current (or last) helper's conversation, or says `sync has no session — pir
brought {base} in itself.`; on `merge` opens the finisher's conversation, or the existing no-session
notes. `c` opens the finisher while it is on; otherwise `a single run has no coordinator agent.` as
today. The conversation header reads `agent` for the finisher, as in builds.

The runs list (dashboard): STATE adds `● syncing` (sync step working), `● ready for your go` (amber,
counted, finisher in `awaiting-go` and nothing else asking), `● finishing` (finisher `preparing` or
`finishing`), `● ready to merge` (amber, counted: the fallback wait), `✗ not ready` (red wait),
`◌ closed`. A finisher `stuck` or holding a request reads `● asking you`. PROGRESS: `build ✓ review ✓
sync …`, `… sync · tests …`, `… sync ✓ merge …`, `build ✓ review ✓ sync ✗` (red wait), `build ✓ review
✓ sync ✓ merge ✓` (finished or merged).

Reason for this shape: it reuses the build finisher's words and colours, so a person who has said `Go`
to a build recognises it, and it keeps the single run's one-row-per-step steps view.

### 2.12 Phone alerts

Through the existing machinery (`notifyStep`, `notify.mjs`), only when `pir notify` is set up:

| When | Alert |
|---|---|
| a helper asks | as the builder's and reviewer's: `{name} · resolve` / `· fix` |
| finisher phases | the build finisher's set (`finisherNotifyView`) with `{name}` as the slug: `ready for your go`, `finisher stuck`, `finisher`, `finished`, `finisher gave up` |
| the run settles red | `endAlert({ slug: name, ready: false, reason, unresolved, base })`: `{name} · not ready` |
| fallback after the finisher failed to start | `singleEndAlert`: `{name} · ready to merge` |

`singleEndAlert` is no longer sent when the finisher takes over. Reason: the finisher's alerts replace
it, as `endAlert` is replaced for builds.

### 2.13 The unhappy paths

- **The base moves during build or review**: nothing until the sync; the sync brings it in.
- **Two single runs finish in one repo**: each has its own finisher; the first merge moves the base,
  the second sees `moved` and re-syncs.
- **The person's main checkout is dirty or on another branch**: the finisher's own rules (finisher
  skill § The target branch), unchanged.
- **A stop during a helper or the finisher**: §2.10. The finisher is not in `workers.json` (as in
  builds); the stop closes it through the program, and a SIGKILLed program leaves it running, found by
  `ps -ax -o pid,command | grep '/ single / finisher'`.
- **A sync merge commit** on `pir/{name}` is expected when the base moved; the finisher merges the
  branch with it.
- **An old run finished `ready` before this change**: displayed as today.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: inputs as parameters, decisions out. No clock, no fs, no process, no network.
src/shell/  everything that touches git, sessions, files, timers.
```

`src/core/boundary.test.mjs` scans `src/core` for forbidden imports. If it fails, move the code; never
relax the test.

### 3.2 Modules

| Module | Side | Change |
|---|---|---|
| `src/core/basewatch.mjs` | core | new (T01): `baseWatchVerdict`, `watchDue` |
| `src/shell/coordinate.mjs` | shell | T01: `watchBase` calls the core verdict; behaviour unchanged |
| `src/core/finisher-brief.mjs` | core | T02: `finisherOpening({ kind, promptPath, … })` single variant |
| `src/shell/finisher-agent.mjs` | shell | T02: `kind`, `promptPath`, session name; `reportPath` optional |
| `skills/pir-finisher/SKILL.md` | skill | T02: covers a single run (prompt and log in place of REPORT.md) |
| `src/core/singleflow.mjs` | core | T03: `sync`/`wait` steps, helper roles, new actions and facts, outcomes, `helperInstruction`, `singleProgress` |
| `skills/pir-single/SKILL.md` | skill | T04: the resolve and fix roles and their reports |
| `src/shell/single-run.mjs` | shell | T05: executes the new actions, holds helpers, the finisher, the watch; T06 alerts; T07 `singleRunState` rows |
| `src/shell/launch.mjs`, `src/core/dashboard.mjs` | shell/core | T05: resume of `sync`/`wait`; T07: display states |
| `src/core/plandisplay.mjs`, `src/shell/pir-tui.mjs`, `src/shell/conversation-view.mjs` | core/shell | T07: rows, `c`, `→` |
| `src/shell/fake/sessions.mjs` | test | T05: fake resolve/fix helpers and a single-run finisher script |

### 3.3 The decision function

`decideSingleStep(state, facts)` stays the one place the run's steps are decided. New actions:

```
{ type: 'prepareBase', mode: 'start'|'watch' }   → facts.base: { ok, sha, remote, reason, text }
{ type: 'syncBase', baseSha }                    → facts.sync: { state: 'up-to-date'|'merged'|'conflict'|'error', files, error }
{ type: 'abortSync' }
{ type: 'spawn', step: 'resolve'|'fix' }         (helpers, held like build/review)
{ type: 'startFinisher' }                        (start or resume; the shell builds its args, §2.7)
{ type: 'finisherResyncing' } / { type: 'finisherResynced', baseSha }
{ type: 'closeFinisher' }
{ type: 'finish', outcome: 'finished'|'merged'|'closed'|'dropped' }
```

New facts: `base`, `sync`, `syncPending`, `watch: 'merged'|'moved'|null` (the shell computes it with
`baseWatchVerdict`), `finisher: { started, phase, goGiven, givenUp, accepted: [{ kind }] }`, `now` for
the hold's retry. State gains `end: { seq, sync: { state, baseSha, files }, tests, testsReason, fixUsed,
resolveUsed, hold, localSeen, remote, finisher: null|'on'|'fallback', fallback }`, and `sessions` gains
`resolve` and `fix`. `step` values: `setup`, `build`, `rename`, `review`, `sync`, `wait`.

### 3.4 Storage

All in the run's control folder, gitignored, written temp-then-rename as today: `state.json` (new fields
above), `finisher/` (the build finisher's `state.json`, `session.json`, `status/`, `ledger.jsonl`),
`conversations/resolve-{n}.ndjson`, `fix-{n}.ndjson`, `finisher-{n}.ndjson`, `sync-tests-{n}.log`
continue `tests-{n}.log`'s numbering. A crash mid-sync leaves a merge in progress in the worktree;
resume aborts it (§2.10).

---

## 4. Testing

- Core: `singleflow.test.mjs` walks every new path in milliseconds (up-to-date, merged-green,
  merged-red-fix-green, red-after-fix, conflict-resolved, conflict-unresolved, helper exit, held base,
  hand merge before go, moved before go to green and to red, done, close, gave up, failed to start,
  resume in each step). `basewatch.test.mjs`, `finisher-brief.test.mjs`, skill text tests.
- Shell: `single-run.test.mjs` runs `runSingle` in-process against a scratch repo with the fake Claude
  shim, now including a fake finisher script that writes `ready`, asks `Go`, and on `Go` merges and
  writes `done`; a second repo commit on the base drives the sync and clash paths.
- Builds: the existing finisher, hand-over and coordinator tests must stay green untouched (T01, T02).
- End to end: the existing pty rig (`plan-rig.mjs`, `plan-rig-single-*.test.mjs`) at 80×24 and 120×40,
  extended by T07 and driven whole by T08.
- Nothing above proves a real finisher session finishing a real single run; T10 does, once.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.6.0) |
| Language / runtime | Node, ES modules. `package.json` `engines` `>=22.19`. This shell's first `node` on `PATH` is nvm's v22.17.1 (below the floor); `/opt/homebrew/bin/node` is v26.7.0 (measured 2026-10-01) |
| Toolchain | Claude Code 2.1.286; `@anthropic-ai/claude-agent-sdk` 0.3.282; git 2.55.0 |
| Deliberately absent | no TypeScript, no bundler, no test framework beyond `node:test` |

**The test command.** `npm test`, the block at the top. It runs `FORCE_COLOR=0 NO_COLOR=1 node --test
--test-reporter=dot 'src/**/*.test.mjs'` and ends with `TESTS PASSED` or `TESTS FAILED`. Quiet on pass,
full failure output, colour off inside the command because this shell sets `COLORTERM=truecolor`. For
detail run one file: `node --test --test-reporter=spec path/to/file.test.mjs`. Measured at plan time in
a fresh copy under load average ~23 (other pir runs on the machine): about 13 minutes, and each of two
runs failed a different set of timing-bound pty and live-worker tests, which passed when rerun alone
(FINDINGS). A red run under load is rerun on the failing files before it is believed.

**Setup.** `test ! -f package-lock.json || npm ci`; `node_modules/` is gitignored, so the copy stays
clean (measured: `git status --porcelain` empty after it).

**Dependencies.** No new npm packages.

**End to end.** The existing pty rig (`conversation-rig.mjs` bound by `plan-rig.mjs` to a scratch repo,
fake Claude first on `PATH`, scratch `PIR_HOME`/`HOME`/`PIR_REPOS`), the `plan-rig-single-*` tests and
their drill helpers. No second rig. Sizes: 60×20, 80×24 and 120×40, as the single drill uses. It is in
`npm test`.

**Install.** Engine and skill changes are live only after `./install.sh` (CLAUDE.md). T02, T04, T05 and
T07 change installed code or skills; T10 runs against the installed copy.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| A real finisher session finishing a real single run | Only real `claude` sessions do it (T10, worker bin, plan limits) |
| The person's `Go` | By design only the person gives it; a worker answering it would be the worker giving the go (T10) |
| Phone alerts arriving | `~/.pir/notify.json` does not exist on this machine (measured 2026-10-01), so no alert is sent; the phone path is the build finisher's, verified 2026-09-30 |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| The finisher's look-only fence | always | nothing changes before the go |
| Scratch repo and scratch `PIR_HOME`/`HOME`/`PIR_REPOS` | every rig, test and harness run | never the person's repos, index or skills |
| Fake Claude on `PATH` | every `npm test` | no model is called by the test command |
| `perl -e 'alarm 1500; exec @ARGV'` around the live run | T10 | a stuck live run is killed |
| One fix helper per sync sequence | always | red tests do not loop |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | worker | exact locked versions | delete `node_modules` | none | none |
| Refresh the installed engine and skills | `./install.sh` | worker | CLAUDE.md requires it after engine or skill changes; local, idempotent | re-run on the previous commit | none | none |
| Real single run with a real finisher (T10) | `perl -e 'alarm 1500; exec @ARGV' node src/shell/harness/run.mjs single-finisher-live --into /tmp/pir-single-finisher-live` | worker | plan limits only, no paid API; a scratch repo | delete `/tmp/pir-single-finisher-live` | three or four short sessions | `claude auth status` (measured logged in, claude.ai, 2026-10-01) |
| Scratch teardown | `rm -rf /tmp/pir-single-finisher-live` | worker | local scratch only | none needed | none | none |

No `ask` rows. The finisher's runtime actions (the person's merge, install) are not build actions of
this plan; in T10 they land in the scratch repo after the person's `Go`.

---

## 6. Decisions and rationale

- **Always on, no switch** (user, 2026-10-01). §2.1.
- **Same `on-finish.md` and lookup as builds** (user, 2026-10-01). A separate single-run rules file was
  declined: a second set of files to track for no named need.
- **Sync and retest before the hand-over and whenever the base moves before the go** (user, 2026-10-01),
  over "re-check only", so what lands is what was tested.
- **Full build behaviour on a clash or red: resolve helper, one fix helper** (user, 2026-10-01), over a
  lighter fallback. Reverses single-runs DESIGN's "pir never merges the base into a single run's branch"
  for the end of the run only; the build and review steps still never sync.
- **Red waits like a build** (user, 2026-10-01), over ending the run `not ready`.
- **Reuse, not copy** (Stage 4 survey): `finisher-agent.mjs` is parameterised by `kind` rather than
  forked; the build's `watchBase` decision is extracted to core and shared; `syncBase`, `abortSync`,
  `syncPending`, `baseContains`, `prepareBase`, `holdText`, `chooseRules`, `withAgent`,
  `finisherNotifyView`, `endAlert` and the finisher row words are used as they are. Helper wording is
  new in `singleflow.mjs` rather than `buildConflictPrompt`/`mainSyncOpening`, because those name the
  `pir-worker` contract and plan-build reports, which a held single-run session does not follow.
- **No prototype.** The surface reuses the build finisher's row, words and colours in the single run's
  existing steps view; the sketch in §2.11 was shown to and approved by the user with the requirements,
  2026-10-01.

## 7. Out of scope

- A way to turn the finisher off for single runs, per repo or per run.
- A separate rules file for single runs.
- Push, pull request or anything beyond what the rules file says.
- Syncing the base during build or review.
- A coordinator agent for single runs.
- Changing the build finisher's behaviour in any way.
