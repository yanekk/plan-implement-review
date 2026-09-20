# T09 — capstone

**Phase:** 4 · **Runs:** you · **Depends on:** T06, T08, T10, T15 · **Weight:** light (gated on the person)

> Status 2026-09-20: three of four by-eye items confirmed live (attach-and-answer, Ctrl-C + main
> untouched, re-run resume, no classifier prompt, plus the T12 word-proof). The remaining item — the
> live display reading right — FAILED (it streams, not in place); fixing it is T15, hence the added
> dependency. Once T15 lands, the person re-checks only the display and T09 closes.

## Goal

See the whole thing work for real, over real Claude workers, and confirm the parts the test command
cannot reach: that the in-place display reads right, that a worker's `/`-separated slug name renders in
`claude agents` and `claude --bg -n` accepts a `/` at launch, that a person can find and answer a
blocked worker, that Ctrl-C kills real workers and a re-run resumes, and that a worker's own git/test
clears the auto-mode classifier without a prompt.

**Verified by reusing the existing live-scenario harness and its existing fixtures — not a bespoke
scratch plan.** The harness (`src/shell/harness/run.mjs`) already builds a throwaway scratch repo per
fixture, carries the current skills into it (`installFixture` → the scratch repo's `.claude/skills/`, so
workers read the current contract with no change to `~/.claude/skills`), sets every seatbelt, spawns the
real coordinator over real workers, captures a bundle, and checks the run against declared facts. This
task launches those fixtures and puts the running thing in front of the person to judge.

## Design sections this implements

DESIGN §5.1 (what the test command cannot reach) and §2.2, §2.3, §2.6, §2.9 confirmed live.

## Environment (the harness owns the setup)

No hand-seeded scratch plan and no manual clone. `installFixture` lays each fixture down as a
self-contained scratch repo, carries `src/` and the current `skills/` into it, and seeds a reviewed
`PROGRESS.md`. Seatbelts are automatic (DESIGN §5.2): `PARALLEL_LIVE=1`, the fixture's own low ceiling,
a wall-clock timeout that auto-arms the `HALT` kill switch, a refusal to run inside the canonical repo
(pass `--into <dir>` or `PARALLEL_ALLOW_HERE=1`), and teardown of every worker on exit.

## Automated checks (the person launches each fixture, attended, one at a time)

Every run spawns real paid `claude` workers, so launch each one attended and one at a time. Each ends
in a fact-by-fact report (`PASS`/`FAIL`) and a bundle path; a green report is that fixture's automated
evidence.

Run from the repo root. The runner refuses to launch inside the canonical repo without `--into <dir>`
(a seatbelt; the actual run still happens in that throwaway scratch repo), so name a scratch dir per run:

```
node src/shell/harness/run.mjs single         --into /tmp/pir-single         # happy path: spawn → implement → 🔍 → fresh review → merge → handoff
node src/shell/harness/run.mjs review-queue   --into /tmp/pir-review-queue   # a review handoff while another task builds
node src/shell/harness/run.mjs clean-merge    --into /tmp/pir-clean-merge    # two clean merges + one handoff
node src/shell/harness/run.mjs parallel       --into /tmp/pir-parallel       # concurrency + ceiling held + the kill-switch drill (auto HALT)
node src/shell/harness/run.mjs human-decision --into /tmp/pir-human-decision # a worker parks and asks; it holds its slot; another task merges past it
node src/shell/harness/run.mjs restart        --into /tmp/pir-restart        # kill-and-resume: SIGKILL mid-run, relaunch reconciles from git
```

**Do not run `merge-conflict`.** Its fixture still carries a `scriptedAnswer` and its
`mergeConflictResolved` fact still requires an `answer` flow line, both of which assume the removed
down-channel (§2.2); the loop no longer emits `answer`, so it cannot pass under the current model.
Converting it is a separate task, not this one (FINDINGS).

## Needs a person — the by-eye / interactive half the harness cannot show

The harness launches the coordinator with its **stdout ignored** (it reads the run from the flow log and
`claude agents`, never the coordinator's screen), so it never shows the live in-place display, and it
**automates** the restart (SIGKILL + relaunch) rather than an interactive Ctrl-C, and it **captures** the
parked worker holding its slot rather than a person answering it. So these judgments are made in a real
terminal, on a fixture's own scratch repo, by running the coordinator directly:

```
# Reuse an existing fixture's scratch repo (no new plan) and watch the REAL display:
REPO="$(pwd)"                          # run from the repo root
D=/tmp/pir-eye; rm -rf "$D"
node -e "import('$REPO/src/shell/harness/fixtures.mjs').then(m => { m.installFixture('human-decision', { into: '$D' }); console.log('installed human-decision at', '$D'); })"
cp "$REPO/.claude/settings.json" "$D/.claude/settings.json"   # carry T06's worker permissions.allow, as a real installed target repo has it
cd "$D"
PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=2 node src/shell/coordinate.mjs human-decision
```

Note on the classifier (judgment 4): `installFixture` carries `src/` and `skills/` but NOT
`.claude/settings.json`, so the automated `run.mjs` fixtures do not ship T06's project
`permissions.allow`. On this machine the account-global `~/.claude/settings.json` already allows
`git add`/`git commit`, so the fixture workers still commit; the `cp` above puts the project rule into
the by-eye scratch so judgment 4 tests T06 as a real installed repo would have it. (That `installFixture`
does not carry `.claude/settings.json` is a harness gap — FINDINGS — not this task's to fix.)

Expect / confirm by eye:
- the live `docker compose up`-style display paints in place — tasks moving through building, reviewing,
  merged, each row showing its id and slug, with the ceiling and elapsed times;
- in `claude agents` the workers show `/`-separated slug names (`{repo} / human-decision / T0n / {slug} /
  {role}`), and launch accepted the `/`;
- one task parks as `asking you`; find it in `claude agents`, attach, reply directly, and it un-parks;
- Ctrl-C closes the workers and leaves the scratch `main` untouched; re-running the command resumes from
  committed work;
- a worker committed (`git commit` / `npm test`) without a classifier prompt.

Tell me:
- Does the live display read right in a real terminal (in place, legible, id + slug, right statuses)?
- Do the worker names render correctly with `/` and the slug in `claude agents` (and did launch accept the `/`)?
- Did answering a blocked worker directly, then Ctrl-C, then a re-run, behave as described?
- Did a worker's own `git commit` / `npm test` run without a permission prompt (T06 working live)?

Record two separate confirmations in `FINDINGS.md` with the date: the machine result (the fixtures'
`PASS` reports, with bundle paths) and the person's judgement of the live behaviour, never rounding an
ambiguous reply up.

## Done when

- [ ] Every fixture above except `merge-conflict` reports `PASS`, and its bundle path is recorded.
- [ ] The person confirms, in a real terminal, that the live display reads right (id + slug), the
      `/`-separated slug names render in `claude agents` and launch accepted the `/`, direct answer +
      Ctrl-C + re-run behaved as described, and a worker's own commands cleared the classifier without a
      prompt.
- [ ] Both confirmations (the machine `PASS` reports and the person's judgement) are recorded in
      `FINDINGS.md` with the date; scratch repos and any `--into`/`/tmp/pir-eye` dirs are torn down.
