---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Base branch — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T10 carries the resulting behaviour into `/docs` and the README. It never edits a finished plan's
DESIGN.md.

## 1. Purpose

pir assumes every repo has a branch named `main`: a planning run and a build are cut from it, the end of
a build merges it into the feature branch, and the person is handed `git merge pir/{slug}` to run on it.
Some repos the person works in have no `main`. They keep fixed `dev`, `stage` and `prod` branches, work
starts from one of them (usually `dev`), and code is promoted between them by other means. This plan makes
the branch pir starts from and hands back to, the base branch, a per-repo setting, and has pir start work
from the newest copy of it rather than whatever the local clone last saw.

### Success criteria

- In a repo with only `dev`, a `.pir/settings.json` naming `dev`, and a remote whose `dev` is ahead of
  the local one, `pir plan` cuts its branch from the remote's newest `dev`, the build ends synced with
  `dev`, and the hand-off reads `git switch dev && git merge pir/{slug}`. Proven with fake sessions and a
  local bare remote in `npm test` (T09).
- A repo with no settings, a broken settings file, an unreachable remote, or a local base that has split
  from the remote's is refused before anything is created, with a message naming the cause and the fix.
- A repo with no remote plans and builds from its local base branch, with no fetch and no warning.
- No user-visible text says `main` unless the base branch is `main`.

### Stance

- The base branch is stated, never guessed. pir does not read the remote's default branch or
  `init.defaultBranch`: in a dev/stage/prod repo the remote's default is often `prod`, and building off
  it silently is the failure this plan exists to prevent.
- The written plan is branch-agnostic. Which base a plan is built on is a fact about the run and its
  branch, not something `plans/{slug}/*.md` records (user, 2026-09-29).
- pir reads from the remote and never writes to it: it fetches, it never pushes.

---

## 2. Behaviour specification

### 2.1 Where the base branch is set

Two JSON files, both optional:

- `<repo>/.pir/settings.json`, committed in the repo, read from the primary checkout's working tree. It is
  the team's answer, shared by every machine that clones the repo.
- `${PIR_HOME ?? HOME}/.pir/{repo}/settings.json`, on this machine only, where `{repo}` is the basename of
  the primary checkout (the same name the run index uses, `~/.pir/runs/{repo}__{slug}.json`). It overrides
  the repo file key by key, so a person can point their own machine elsewhere without a commit.

The key is `baseBranch`, a string. Unknown keys are ignored, so later settings can be added without
breaking an older pir. The effective base is the user file's `baseBranch` if it has one, else the repo
file's.

When neither file names a base branch, pir refuses to plan and refuses to start a build, even in a repo
that has `main` (user, 2026-09-29, reversing an earlier "default to main"). The refusal names both files
and the exact line to add. Why: a single rule with no fallback means pir never builds off a branch nobody
chose, and the cost, one small file per repo, is paid once.

The primary checkout's working tree is read rather than a committed tree because the setting decides
which branch to read, so it cannot itself be read from that branch. In practice every branch carries the
same file.

### 2.2 Validating the settings

A file that does not exist is fine. A file that exists and is not a JSON object, or whose `baseBranch` is
present but not a non-empty string, or not a valid branch name, is an error and pir refuses, naming the
file and what is wrong. That holds even when the other file would have supplied a good value: a broken
file is a mistake the person should see, not one to paper over.

A valid branch name follows `git check-ref-format --branch` rules, checked in pure code: no leading `-`,
no whitespace or control characters, none of `~ ^ : ? * [ \`, no `..`, no `@{`, no `//`, not ending in
`/`, `.` or `.lock`, no component starting with `.`. A name starting `pir/` is also refused, because pir's
own branches live there and a base inside that namespace would collide with a feature branch.

### 2.3 Which commit is the base: fetch, compare, move the local copy when safe

Whenever pir cuts a branch from the base (§2.6, §2.7) or merges the base into a finished build (§2.8), it
first prepares the base:

1. Choose the remote (§2.4). With no remote, use the local base branch as it is. If it does not exist,
   refuse (`no-base-branch`).
2. Ask the remote whether it has the branch (`git ls-remote --exit-code --heads <remote> <base>`: exit 0
   yes, 2 no, anything else unreachable), and if it has, fetch it into `refs/remotes/<remote>/<base>`.
   Unreachable, or a fetch that fails or times out, is `fetch-failed`.
3. Compare the local branch L with the remote-tracking copy R:

| Local L | Remote R | Use | Local branch |
|---|---|---|---|
| missing | missing | refuse `no-base-branch` | — |
| present | missing on the remote | L | left alone |
| missing | present | R | created at R, tracking `<remote>/<base>` |
| equal to R | present | R | left alone |
| behind R | present | R | fast-forwarded to R when safe (below), else left alone |
| ahead of R | present | L | left alone: it holds commits the remote lacks |
| split from R | present | refuse `diverged` | left alone |

Fast-forwarding the local base is safe when it is not checked out in any worktree (`git branch -f <base>
<R>`, which git itself refuses on a checked-out branch), or when it is checked out in a worktree whose
tracked files are clean (`git merge --ff-only <R>` run in that worktree). Any other case, or a
fast-forward git refuses, leaves the local branch where it is and still uses R: the person asked for work
to start from the newest commit (user, 2026-09-29) and for their copy to be moved forward only when that
cannot disturb them.

Why the remote's copy counts at all: the person's clone is often days behind a shared `dev`, and a build
cut from a stale base hands back a branch that conflicts with everything the team pushed since.

### 2.4 The remote, and a fetch that can never hang

The remote is the local base branch's configured upstream (`branch.<base>.remote`) if it has one, else
`origin` if it exists, else none. A repo whose only remotes have other names and whose base has no
upstream is treated as having no remote. Why: `origin` is git's own default name, and an upstream set by
hand is the person's explicit answer.

Every network call runs with `GIT_TERMINAL_PROMPT=0` and, when neither `GIT_SSH_COMMAND` nor
`core.sshCommand` is set, `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`, under a 30-second timeout. An
expired login or a passphrase prompt then fails at once instead of waiting on a prompt nobody can see in
a detached run. Measured 2026-09-29: `git ls-remote` on an unreachable https repo with
`GIT_TERMINAL_PROMPT=0` exits 128 in about 0.6 s; on a file remote without the branch, exit 2.

### 2.5 The run remembers its base

When pir cuts a planning branch or a feature branch it records the base in git's config for that branch:
`git config branch.<pir-branch>.pirBase <base>`. Every later step of that run (the build that takes over
a planning branch, a restart, the end-of-run sync, the merge watch) reads the base from there, never from
the settings files again. So changing the setting mid-build cannot move a running build to another base
(user, 2026-09-29: "the run remembers the branch, not the plan").

Why git config: `git branch -m` carries a branch's config section to its new name (measured 2026-09-29),
so the planning run's rename to `pir/{slug}` keeps it with no extra step. It survives restarts, needs no
new file, and dies with the branch. It is written with `git config`, never by editing `.git` directly.

The run index record gains a `baseBranch` field, a copy for display and for a resume that has not reached
git yet. It is never the source of truth.

A feature branch with no `pirBase` (cut before this change) takes its base from the settings, as a fresh
start would, and records it then; with no settings it is refused like a fresh start.

### 2.6 Starting a planning run

`pir plan` and the dashboard's `@repo/plan` box, before anything is created: find the repo; resolve the
settings (§2.1, §2.2); prepare the base (§2.3); cut `pir/plan-{hex4}` from the prepared commit; record
`pirBase`; write the run record with `baseBranch`. Every refusal leaves the repo exactly as it was, apart
from a remote-tracking ref the fetch may have updated and a local base branch §2.3 created or moved
forward, both of which are safe to have happened.

The slug check (`slugTaken`) looks for a plan committed on the run's base branch, not on `main`. The
planner skill's own check (`git ls-tree -d <base> plans/{slug}`) reads the base from `pirBase` on its
branch.

The dashboard's repo list (`@` pop-up) lists a repo only when its effective settings name a base branch
that exists locally or as a remote-tracking ref. This keeps the list's existing promise that `↵` on a
listed repo starts a run; the scan does no network call.

The fetch runs in `pir`'s own process, synchronously, before the detached planning program starts, so a
refusal reaches the person directly. It is bounded by §2.4's timeout.

### 2.7 Starting a build

`pir start {slug}` (and a restart of a build):

- If `pir/{slug}` exists, its base is its `pirBase` (§2.5). No fetch: the branch is already cut, and the
  end-of-run sync fetches anyway.
- If it does not (a plan made by hand on the base branch), resolve the settings, prepare the base, cut
  `pir/{slug}` from the prepared commit and record `pirBase`, all in `startRun` before the detached
  coordinator starts, so a refusal is shown to the person. `startRun` passes the base and the commit to
  the coordinator (`--base <name> --base-sha <sha>`); a coordinator started without them (the classic
  `node src/shell/coordinate.mjs {slug}`) resolves them itself the same way.

`ensureMain` (which created a local `main` at HEAD on the live path when a scratch clone lacked one) is
removed: §2.3 creates a missing local base from the remote's copy, which covers the scratch clone, and
creating a branch at an arbitrary HEAD is the silent guess this plan exists to remove.

### 2.8 The end of a build

Only with the coordinator agent on, as today. Before merging the base into the feature branch, pir
prepares the base (§2.3) and merges the commit it chose.

- `fetch-failed` or `diverged` holds the run in `preparing` with the reason visible in the live view and
  the status snapshot (`preparing: can't reach origin, retrying`, `preparing: your dev and origin/dev have
  split apart`), and retries every 60 seconds. No hand-off is given until it succeeds; nothing is lost and
  it continues on its own (user, 2026-09-29). A worker is not spawned for either: neither is a conflict a
  session can resolve.
- While the run waits in `ready to merge`, each pass checks whether the local base contains the feature
  tip, and every 5 minutes it fetches (without moving anything but the remote-tracking ref) and checks
  the remote-tracking copy too, so a merge done on GitHub is seen. If the base moved to a commit that does
  not contain the tip, the run re-syncs as today. A failed fetch while waiting changes nothing but a
  `last check of origin failed at {time}` note in the snapshot.

Without the coordinator agent the command prints the hand-off and exits, as today, with no sync.

### 2.9 What the person sees

Every user-facing string that names `main` names the run's base instead: the planning refusal, the
end-of-run notification (`Merge with dev unresolved on pir/{slug}`), the live view's `preparing: syncing
dev, writing the report`, the coordinator agent's brief and the delivery report footer (`Synced with
`dev` at {sha}`), the finished line (`✔ pir/{slug} is in dev. The run is finished.`), and the hand-off,
which becomes `git switch {base} && git merge pir/{slug}` so it is right whichever branch the person has
checked out. The internal helper label `main-sync` and its agent name are kept, because a restart after
the upgrade must still recognise a helper worker recorded under that name; only its prose changes.

The refusals (`src/core/basebranch.mjs`, `refusalText`):

- `no-base-setting`: `pir: no base branch is set for {repo}. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/{repo}/settings.json (this machine only).`
- `bad-settings`: `pir: {file} is not usable: {why}.`
- `no-base-branch`: `pir: the base branch {base} (set in {file}) exists neither locally nor on {remote}.` (`… and this repo has no remote.` without one)
- `fetch-failed`: `pir: could not fetch {base} from {remote}: {git's last line}. Nothing was created; try again when {remote} is reachable.`
- `diverged`: `pir: your {base} and {remote}/{base} have split apart ({a} local, {b} remote commits not in the other). Pull or push to reconcile them, then try again.`

The dashboard box shows a short form of each (`planbox.mjs` reasons).

### 2.10 Sessions and the project's rules

The skills and the `CLAUDE.md` this repo installs into projects stop saying `main` where they mean the
base: the classic flow works "in the main checkout, on the base branch" (the branch the repo's
`.pir/settings.json`, or the person's override, names); a worker's branch is "never the base branch"; the
coordinator never merges into the base or pushes; the planner checks its slug against the base read from
`pirBase`. The auto-mode rule text in `src/core/settings.mjs` changes the same way. This repo gets its own
`.pir/settings.json` naming `main`, or pir would refuse to run on itself once §2.1 lands.

### 2.11 The unhappy paths

- No settings: refused (§2.1). Broken settings: refused, naming the file (§2.2).
- No remote: local base only, no fetch, no warning. Local base missing too: `no-base-branch`.
- Remote unreachable or login expired at start: `fetch-failed`, nothing created. At the end: hold and
  retry (§2.8).
- Remote exists but lacks the branch: the local branch is used (the person may not have pushed a new
  `dev` yet); missing locally too, `no-base-branch`.
- Local and remote split: `diverged` at start; hold at the end.
- Local base checked out with changes: not moved, remote commit still used (§2.3).
- Settings changed mid-build: ignored by the running build (§2.5).
- A repo named `runs` would put its user settings at `~/.pir/runs/settings.json`, inside the run index
  folder. `listRecords` skips a file that is not a run record, so nothing breaks; accepted rather than
  renaming the index.
- Two repos with the same folder name share one user settings file, as they already share the run-index
  name prefix. Accepted.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: takes inputs as parameters, returns decisions. No clock, no I/O, no network.
src/shell/  git, files, processes, the network fetch.
```

`src/core/boundary.test.mjs` scans `src/core/` for `node:fs`, `node:child_process`, `fetch(`, the clock
and randomness. If it fails, move the code into `src/shell/` and pass the result in; never relax the test.

### 3.2 Modules

- `src/core/basebranch.mjs` (new, T01): `parseSettings`, `effectiveBase`, `validBranchName`,
  `decideBase` (the §2.3 table), `refusalText`, `holdText`. Pure.
- `src/core/runrecord.mjs` (T01): the optional `baseBranch` field.
- `src/shell/base-branch.mjs` (new, T02): reads the two settings files, picks the remote, runs the
  bounded `ls-remote`/`fetch`, gathers the facts `decideBase` needs, applies its create/fast-forward, and
  returns the commit. `prepareBase` and `resolveBaseSetting` are its entry points.
- `src/shell/worktree.mjs` (T03): branches are cut from a given commit and record `pirBase`; `slugTaken`,
  `syncBase`, `baseContains`, `baseTip`, `readRunBase` take the base as an argument.
- Text modules (T04): `conflict.mjs`, `coordinator-brief.mjs`, `coordinator-report.mjs`, `notify.mjs`,
  `render.mjs`, and the hand-off renderers take the base name.
- Wiring: `launch.mjs`, `pir.mjs`, `planbox.mjs`, `repo-scan.mjs`, `plan-run.mjs` (T05);
  `launch.mjs` `startRun`/`resumeRun`, `coordinate.mjs` start (T06); `coordinate.mjs` end of run,
  `display.mjs` (T07).

### 3.3 The decision function

`decideBase(facts) → { use: sha, local: 'keep'|'create'|'ff' } | { refuse: reason, … }` is the whole of
§2.3. Its input is plain data the shell gathered: whether there is a remote, whether the remote was
reached and has the branch, the local and remote-tracking shas, their ancestry both ways, and where the
local branch is checked out and whether that checkout is clean. It is tested exhaustively on the table.

### 3.4 Data flow

```
settings files ──resolveBaseSetting──▶ base name ─┐
remote/ls-remote/fetch/rev-parse ──facts──────────┴▶ decideBase ─▶ create/ff local ─▶ sha
sha ─▶ openPlanBranch / openFeature (cut + pirBase) ─▶ run record baseBranch
end of run: readRunBase ─▶ prepareBase ─▶ syncBase(sha) | hold(reason)
```

### 3.5 Storage

The settings files are read, never written by pir. `pirBase` is in the repo's git config, written by one
`git config` call after the branch is created; a crash between the two leaves a branch with no `pirBase`,
which §2.5's fallback handles. The run record field is written with the record, atomically as today.

---

## 4. Testing

- Pure (T01): the settings parser and merge, every §2.2 rejection, every row of the §2.3 table, each
  refusal text.
- Git (T02, T03, T06, T07): real git in temp repos, with a local bare repository as the remote. No test
  touches the network: a file-path remote exercises the same fetch, ancestry and fast-forward code.
  An unreachable remote is a file-path remote pointing at a directory that does not exist.
- End to end (T09): the existing harness and planning rig in a repo with only `dev`, driving `pir`'s real
  screen under a pty with fake sessions (§5 End to end).

What none of them prove: a fetch over the real network with the person's real credentials, including an
expired login (§5.1). T09 runs one read-only fetch of this repo's public origin to narrow that.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5) |
| Runtime | Node v24.2.0 |
| Git | 2.50.1 (Apple Git-155) |
| **Deliberately absent** | GNU `timeout` (not on macOS: bound processes with Node's `spawnSync` `timeout`) |

**The test command** is `npm test`: `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`. Quiet dot reporter, colour forced off in the command itself; failures print in
full. For detail, run one file with `node --test --test-reporter=spec path/to/file.test.mjs`.

**Setup** is `test ! -f package-lock.json || npm ci`, as in every recent plan in this repo.

**Dependencies.** None added. Node built-ins and the git CLI only.

**End to end.** Reuse, do not add: the harness (`src/shell/harness/`, fake platform and fake sessions)
for builds, and the planning rig (`src/shell/plan-rig.mjs`, the real `pir.mjs` under a pty via
`conversation-rig.mjs`) for the `pir plan` screen and the dashboard box. Both run inside `npm test`
against fake Claude sessions, 80×24 and 120×40.

**Every test repo now needs settings.** Once T05 and T06 wire §2.1, a repo with no `.pir/settings.json`
is refused. T02 therefore makes every shared test-repo helper commit `.pir/settings.json` with
`{"baseBranch": "main"}` (`fake/worktree.mjs`, `harness/fixtures.mjs` `seedGit`, `plan-rig.mjs`), and
each later task fixes the per-file helpers it breaks.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A fetch from a private remote with the person's real credentials, and an expired one failing fast | Only the person's own login and remotes exercise it; T09 covers a public https fetch only |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| Fetch timeout | 30 s, `GIT_TERMINAL_PROMPT=0`, ssh `BatchMode=yes` | A network call can never hang a run or wait on a hidden prompt |
| Local bare remotes in tests | every test | `npm test` never touches the network |
| Rig `PIR_HOME`/`HOME` | scratch folder | Tests never read or write the person's real `~/.pir` settings |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | Exact locked versions only | Delete `node_modules` | none | none |
| Public read-only fetch (T09) | `node src/shell/harness/real-fetch-check.mjs` | `worker` | Reads a public repo into a temp clone; writes nothing anywhere else | Delete the temp folder (the script does) | none | none |
| `./install.sh` | refresh the installed engine and skills, after `pir/base-branch` is merged | `worker` | Local and idempotent; never while a run is live | Re-run from the previous commit | none | none |

Credentials: none needed. This repo's origin is public https (`github.com/yanekk/plan-implement-review`).

---

## 6. Recovery

A refused start leaves nothing to clean up. A branch whose recorded base is wrong: `git config
branch.pir/{slug}.pirBase <base>` fixes it, or `git config --unset` makes the next start re-read the
settings. A local base branch pir created that the person did not want: `git branch -d <base>`.

---

## 7. Decisions and rationale

- Settings in `.pir/settings.json`, overridden by `~/.pir/{repo}/settings.json` (user, 2026-09-29). The
  alternatives were detecting the remote's default branch (wrong in repos whose default is `prod`),
  asking at every plan start, and a machine-only setting.
- 🔄 No settings means refuse (user, 2026-09-29). Agreed first as "default to main", then reversed at the
  task checkpoint to "block planning and starting until set".
- A local base missing but present on the remote is created from it (user, 2026-09-29); the alternative
  was to refuse and tell the person to create it.
- Fetch at start and end, fast-forward the local base when safe (user, 2026-09-29), over fetching only at
  start or never moving the local branch.
- Start refuses when the remote exists but cannot be reached (user, 2026-09-29), over carrying on locally
  with a warning. A repo with no remote is not refused (user, 2026-09-29).
- End-of-run fetch failure holds and retries every minute (user, 2026-09-29), over handing off on the
  local copy or stopping the run red.
- The run remembers its base, the plan files do not (user, 2026-09-29). Stored as `branch.<b>.pirBase`
  because `git branch -m` carries it.
- One base per repo, not per plan (user, 2026-09-29: "fixed names, pick one").
- Chosen by the planner, shown at the playback, not objected to: the 5-minute fetch while waiting for the
  merge; the hand-off `git switch {base} && git merge pir/{slug}`; no `pir-install` prompt for the setting.
- Survey of what exists (2026-09-29): nothing reads a per-repo pir setting, `origin/HEAD` or
  `init.defaultBranch`, and nothing touches the network. `~/.pir/` already holds `runs/`, `notify.json`,
  `presence`, so the user file sits beside them. `testblock.mjs` would tolerate a `base:` key in the
  DESIGN block, but the base is not a plan fact (Stance), so it is not used. `ensureMain` is removed, not
  extended (§2.7). `planHome` reads the primary checkout's working tree whatever branch it is on, so it
  needs no change beyond its `'main'` label's comment.

---

## 8. Explicitly out of scope

- Promoting between `dev`, `stage` and `prod`. The repo's own process does that.
- Pushing, opening pull requests, or any write to a remote. pir hands the person a local merge.
- A different base per plan, or a flag to override the base for one run: the user chose one base per
  repo.
- `pir-install` asking for or writing the settings file: the refusal message gives the exact line.
- Detecting the base from the remote's default branch: see Stance.
