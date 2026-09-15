# T37 — Live: build the blog end-to-end, attended, and prove it runs

**Phase:** 9 · **Depends on:** T36 · **Weight:** medium · **Runs:** you

## Goal

Run the `blog-app` fixture for real and confirm the whole method delivers: a coordinator fans
three workers out at once off one contract, folds two hand-verifications in at the right moments,
and a genuine database-backed blog comes out the far end. This is the capstone proof the PM asked
for — the first fixture whose deliverable is a real multi-component app, not a marker file. It
folds back without review, like every `you` task (§2.6): the person drives, the run's own capture
is the evidence.

## Design sections this implements

DESIGN §4.1 (a live fixture run + its mandatory reflection pass), §5.2 (attended, seatbelted:
never launched unattended by a session), §2.6 (the two `you` check-ins skip review and fold back).

## Run

```
node src/shell/harness/run.mjs blog-app
```

**Before you start:** start Docker Desktop (both check-ins need it; the build phase does not).
The browser-test tool downloads at check-in #2 (`npx playwright install`) — allow a few minutes.

This is **attended**. The build phase (units T01–T04) runs hands-off. Then the runner prints a
`=== HANDS-ON … ===` line naming the worker to drive for each check-in. Talk to that named worker
directly, run its "Needs a person" steps, and report what you saw; the scribe records it. See
TEST-HARNESS.md § the `blog-app` note and § When it fails.

## Needs a person

This whole task is the hand-verification. Two check-ins, each driven through the named verify worker:

```
# Check-in #1 (after the trio merges): the behind-the-scenes half works
docker compose up -d
# create a post and read it back (curl the API or use the page), confirm it persists
docker compose down

# Check-in #2 (after the e2e unit): the whole app, by eye and by test
docker compose up -d
# open the page in a browser; create, edit, and delete a post
npx playwright install && npx playwright test        # the automated browser test
docker compose down
```

Expect: check-in #1 — a created post is returned by a read. Check-in #2 — the blog is usable end
to end in the browser and the e2e test passes.
Tell me: for each check-in, exactly what happened (the post you created and read; whether
create/edit/delete worked in the browser; the e2e pass/fail line), so the scribe's `✅` rows record
what was actually seen. Run `docker compose down` after each — the harness does not stop containers.

## Done when

- [ ] The fact report is `PASS`: `reachedWidth(2)` (work genuinely ran in parallel), `ceilingHeld(3)`,
      `oneMergeToMain`, both `verifyWorkerSpawned`/`youNeverReviewed` pairs, and `scribeWroteFinding`.
- [ ] Both check-ins were driven and their `✅ verified by hand` rows reached `main` in the scratch
      plan's `FINDINGS.md`.
- [ ] The reflection pass is done (§4.1): read this run's own bundle for how it flowed, where a
      session got lost, and where wall-clock or tokens went for no gain. Record the verdict, the
      bundle path, and the findings in this plan's `FINDINGS.md` with the date. Any hardening it
      implies is surfaced to the PM as its own future task — not fixed here (scope).
- [ ] Note in the reflection whether all three of the trio overlapped or a cold start staggered one,
      since `reachedWidth(2)` passes on two.

## Note on cleanup

The scratch repo sits in a temp dir and is not auto-deleted; remove it by hand after. A closed
worker can linger as `stopped` (`claude rm <id>`). Confirm `docker compose down` left no blog
containers running (`docker ps`) — orphaned containers are the one thing teardown does not cover.
