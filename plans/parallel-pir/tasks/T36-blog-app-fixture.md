# T36 — The blog-app fixture: a realistic multi-component app built in parallel

**Phase:** 9 · **Depends on:** T32, T34, T35 · **Weight:** heavy · **Runs:** auto

## Goal

Every fixture so far forces a single narrow coordinator path with a trivial deliverable — a
one-line `greet.mjs`, a marker file, a same-line conflict. None proves the thing the plan
actually exists to do: build a *real, multi-component* program by fanning several workers out
at once and folding a person's hand-verification in at the right moments. This fixture is that
capstone. Its scratch plan is a small but genuine database-backed blog — a seeded author and
CRUD over posts, a backend, a browser front end, an end-to-end browser test, and a
docker-compose that boots the lot — shaped so three workers build concurrently off one shared
contract, with two `you` check-ins where a person confirms the app really runs. T36 builds the
fixture, its one new fact, and the runner/doc support it needs; T37 runs it live, attended.

This task writes fixture code and gets a fresh-eyes review like any `auto` task. The end-to-end
run cannot be forced without a person and paid workers, so the app-actually-works half is
confirmed by T37, not here.

## Design sections this implements

DESIGN §4.1 (the live-scenario harness; this adds the eighth fixture and the concurrency fact),
§2.6 (the build→verify split — the two `you` check-ins skip review and fold back), §5.2 (every
run is seatbelted: scratch repo, ceiling, wall-clock HALT, kill switch).

## Files

- `src/shell/harness/fixtures/blog-app.mjs` — new. The fixture: its PROGRESS task graph, the
  seven task docs (prompts, not file contents), the contract both parallel workers build against,
  the scenario (facts + seatbelts), and `finalContent` on the scratch plan's `FINDINGS.md`.
- `src/shell/harness/fixtures.mjs` — import `blog-app` and register it in the frozen `FIXTURES` map.
- `src/shell/harness/assertions.mjs` — new fact `reachedWidth(n)` (see Interface).
- `src/shell/harness/assertions.test.mjs` — tests for `reachedWidth` against canned bundles.
- `src/shell/harness/run.mjs` — only if the announce path does not already handle two hands-on
  handoffs in one run (see Interface → "Two check-ins"). Extend it the way T32 added the single
  signal, not by inventing an auto-driver.
- `plans/parallel-pir/TEST-HARNESS.md` — a per-fixture note for `blog-app`.
- `plans/parallel-pir/DESIGN.md` §4.1 — the eighth-fixture paragraph is written by the plan
  amendment; confirm it matches what you build and correct it if the build diverges (say so in
  the review).

## Interface

**The scratch plan (its seven units).** Task numbers are the fixture's own `T01…T07`. The trio
`T02/T03/T04` depends only on `T01`, so the coordinator can build all three at once; the file
partition below is what lets their three branches merge without a conflict.

```
T01  contract + core + schema/seed + runnable stubs   (auto, deps: —)
T02  docker: db + backend server + frontend server    (auto, deps: T01) ┐
T03  real backend (contract endpoints over Postgres)  (auto, deps: T01) ├ built concurrently
T04  real frontend (page + vanilla JS on the API)     (auto, deps: T01) ┘
T05  CHECK-IN #1 — the app works                       (you,  deps: T02,T03,T04)
T06  end-to-end browser test                           (auto, deps: T05)
T07  CHECK-IN #2 — final: click through + run e2e      (you,  deps: T06)
```

**The contract T01 pins, and T03/T04 consume.** Write it out in T01's task doc so backend and
frontend, built by separate workers at the same time, actually fit. A minimal REST-ish shape:

```
GET    /api/posts            → 200 [{ id, title, body, authorId, createdAt }]
GET    /api/posts/:id        → 200 { id, title, body, authorId, createdAt } | 404
POST   /api/posts            → 201 { id, ... }          body: { title, body }
PUT    /api/posts/:id        → 200 { id, ... } | 404    body: { title, body }
DELETE /api/posts/:id        → 204 | 404
GET    /api/author           → 200 { id, name }         the single seeded author
```

Tables: `authors(id, name)` seeded with exactly one row; `posts(id, title, body, author_id → authors.id,
created_at)`. Single-author by PM decision — a real users↔posts relation, but no sign-up/log-in flow.

**The file partition (what keeps the trio from colliding).**

- `T01` creates: `src/core/*.mjs` + their tests (pure validation, CRUD-decision, SQL-text
  builders — stdlib only), the contract module/doc, `db/schema.sql`, `db/seed.sql`, and throwaway
  **stubs** `backend/server.mjs` + `frontend/index.html`/`frontend/app.js` that boot but do little.
- `T02` owns: `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `README.md`. It
  wires the *stubs* so `docker compose up` boots the whole stack. It does **not** edit
  `backend/*.mjs` or `frontend/*` logic, and does **not** edit `package.json`.
- `T03` owns: `backend/*.mjs` (replaces the stub server; adds a thin `pg` data layer) and the
  `pg` entry in `package.json`. It is the only trio member that edits `package.json`.
- `T04` owns: `frontend/*` (replaces the stub page/JS; any pure render logic gets a stdlib test).
  Adds no dependency.

**`npm test` stays install-free, always.** The scratch scaffold's `npm test` is `node --test`
with no `npm install` step, run in every task worktree and every reviewer's fresh worktree. So
every test a worker writes must import only the stdlib pure core — never `pg`, never a browser,
never a running server. The thin backend shell (which imports `pg`) and the front end are **not**
unit-tested; they are hand-verified at the two check-ins. This is the project's own pure-core /
thin-shell boundary applied to the fixture, and it is why the app can carry runtime deps (`pg`,
`@playwright/test`) without breaking a green baseline. This is **not** a DESIGN §5 violation: §5
forbids runtime deps in the *coordinator's* code for portability; the throwaway app a fixture
builds is not that code. Say so in the fixture's header comment so no later reader misreads it.

**The two check-ins (`you` tasks).** Each carries a "Needs a person" block. #1 (T05): bring the
stack up and confirm a post can be created and read back — proof the behind-the-scenes half works
before the polish is judged. #2 (T07): the full click-through (create/edit/delete in the browser)
plus running the e2e test. Both blocks must (a) state that **Docker Desktop must be running**, and
(b) end with `docker compose down` — the harness tears down Claude sessions, not containers, so an
un-torn-down stack leaks. The browser-test tool installs at check-in #2 (`npx playwright install`),
by the person, not by a worker under the clock.

**Two check-ins in one run.** The hands-on machinery (T32/T34) was built for one `you` task.
Confirm the runner announces the *second* hands-on handoff too (`handsOnToAnnounce` says it takes
"the next un-announced" line, which suggests it already loops — verify it, do not assume). If it
only fires once, extend it so both check-ins are announced in sequence. Do not add an auto-driver;
attended-only stands (§4.1).

**The new fact.**

```
reachedWidth(n)  → a pure predicate over a bundle. PASS iff some timeline tick shows at least n
                   distinct task-implementer slots active (busy/working) at the same time.
                   Keyed on the worker→task mapping already in the timeline agent names.
```

`ceilingHeld(n)` only proves an upper bound (never more than n at once); nothing today proves the
lower bound the whole plan is about — that work *actually ran in parallel*. `reachedWidth` is that
proof. Assert `reachedWidth(2)` as the load-bearing fact: even two of the trio overlapping proves
genuine concurrency, and a slow third cold-start should not redden a real success. The fixture is
designed for width 3 (ceiling 3); whether all three overlapped is for T37's reflection to note.

**The scenario.**

```
seatbelts: { ceiling: 3, timeoutMs: 90 * 60 * 1000 }   // room for 5 auto builds + reviews, e2e,
                                                        // and two human check-ins; still auto-HALTs.
facts: [
  reachedWidth(2),
  ceilingHeld(3),
  oneMergeToMain(),
  verifyWorkerSpawned('T05'), youNeverReviewed('T05'),
  verifyWorkerSpawned('T07'), youNeverReviewed('T07'),
  scribeWroteFinding({ file: `plans/blog-app/FINDINGS.md`, needle: '✅' }),
]
finalContent: { file: `plans/blog-app/FINDINGS.md` }
```

## Tests

- [ ] `reachedWidth(n)` passes on a canned timeline where n task-implementer slots are busy in one
      tick; fails when the same tasks only ever appear in separate ticks (built one at a time).
- [ ] `reachedWidth(n)` counts by task, not by OS roster row, and does not count a reviewer or a
      verify scribe as an implementer slot (mirror how `ceilingHeld` groups).
- [ ] The `blog-app` fixture object is well-formed and registered: `listFixtures()` includes it;
      its `T02/T03/T04` rows are `auto` with deps `['T01']`; `T05` and `T07` are `runs: 'you'` with
      "Needs a person" blocks; the graph parses through `parseProgress`.
- [ ] Each `you` task's "Needs a person" block names the Docker precondition and ends with
      `docker compose down`.
- [ ] `npm test` and the boundary scan are green.

## Done when

- [ ] The `blog-app` fixture exists and is registered; its scratch plan is the seven units above,
      with `T02/T03/T04` a concurrent trio off `T01` and two `you` check-ins.
- [ ] `reachedWidth` is built and tested; the reused facts (`ceilingHeld`, `oneMergeToMain`,
      `verifyWorkerSpawned`, `youNeverReviewed`, `scribeWroteFinding`) are wired into the scenario.
- [ ] The runner announces both hands-on check-ins in one run (verified, extended if it did not).
- [ ] TEST-HARNESS.md has a `blog-app` note (Docker precondition, the two check-ins, `docker
      compose down`, playwright install at #2) and DESIGN §4.1 matches what was built.
- [ ] `npm test` and the boundary scan are green. The end-to-end live run is T37, not this task.
