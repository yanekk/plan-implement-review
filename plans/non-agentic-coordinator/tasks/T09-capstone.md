# T09 — capstone

**Phase:** 4 · **Runs:** you · **Depends on:** T06, T08 · **Weight:** light (gated on the person)

## Goal

See the whole thing work for real, on a throwaway plan in a throwaway repo. The tests prove the pure
model and the loop over the fakes; they cannot prove that the in-place display reads right, that a
worker's `/`-separated slug name renders in `claude agents` and that `claude --bg -n` accepts a `/` at
launch, that a person can find and answer a blocked worker, that Ctrl-C kills real workers and a
re-run resumes, or that a worker's own git/test clears the classifier without a prompt. This task sets
all that up and puts the running thing in front of the person to judge.

## Design sections this implements

DESIGN §5.1 (what the test command cannot reach) and §2.3, §2.2, §2.6, §2.4, §2.9 confirmed live.

## Environment (the worker owns this)

The worker sets up and tears down the scratch world; it does not run the live drive itself (that
spawns real paid agents against real branches, which only the person may watch — DESIGN §5.2).

```
# bring-up: a throwaway clone and a lean scratch plan (a few trivial tasks with kebab slugs, one that
# asks a question), marked reviewed so the command will run.
git clone . ../pir-scratch
# seed plans/scratch/ in ../pir-scratch: PROGRESS.md (reviewed, slug Task cells), a few tiny tasks,
# deps giving 2–3 concurrent, one task whose doc asks a genuine question.

# teardown (the worker runs this before marking done, and confirms it is gone):
rm -rf ../pir-scratch
```

## Automated checks (the worker runs these)

```
# in the scratch clone, on the feature branch the run produces:
npm test        # record the pass/fail the worker observed
```

## Needs a person

This is a folded escalation: the worker prepares the scratch world and hands the person the exact
seatbelted commands, then records what the person reports. The person runs the live drive and judges
what only a person can.

```
cd ../pir-scratch
PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 node src/shell/coordinate.mjs scratch   # first, ceiling 1
# then, once that looks right, raise the ceiling:
PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=4 node src/shell/coordinate.mjs scratch
```

Expect: the live `docker compose up`-style display paints in place — tasks moving through building,
reviewing, merged, each row showing its id and slug, with the ceiling and elapsed times; in
`claude agents` the workers show `/`-separated slug names (`scratch-repo / scratch / T0n / {slug} /
implement`); one task parks as `asking you`; answering it (find it in `claude agents`, attach, reply)
un-parks it; Ctrl-C closes the workers and leaves the scratch `main` untouched; re-running resumes
from committed work; the run ends by printing the green branch and `git merge`; a worker committed
without a classifier prompt.

Tell me:
- Does the live display read right in a real terminal (in place, legible, id + slug, right statuses)?
- Do the worker names render correctly with `/` and the slug in `claude agents` (and did launch accept
  the `/`)?
- Did answering a blocked worker directly, then Ctrl-C, then a re-run, behave as described?
- Did a worker's own `git commit`/`npm test` run without a permission prompt (T06 working live)?

Record two separate confirmations in `FINDINGS.md` with the date: the machine result (`npm test` on
the branch) and the person's judgement of the live behaviour, never rounding an ambiguous reply up.

## Done when

- [ ] The person confirms the live display reads right (id + slug), the `/`-separated slug names
      render in `claude agents` and launch accepted the `/`, direct answer + Ctrl-C + re-run behaved as
      described, and a worker's own commands cleared the classifier without a prompt.
- [ ] The run ended at a green feature branch merged by hand; the scratch clone is torn down and
      confirmed gone.
- [ ] Both confirmations (machine result and the person's judgement) are recorded in `FINDINGS.md`
      with the date.
