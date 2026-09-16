// blog-app — the CAPSTONE live fixture (DESIGN §4.1, T36). Every fixture before this forces one narrow
// coordinator path with a throwaway deliverable — a one-line greet.mjs, a marker file, a same-line
// conflict. None proves the thing the whole plan exists to do: build a REAL, multi-component program by
// fanning several workers out at once off one shared contract, folding a person's hand-verification in at
// the right moments, with a genuine app out the far end. This fixture is that proof.
//
// The scratch plan is a lean database-backed blog — one seeded author, CRUD over posts — built as a
// WALKING SKELETON so the middle three tasks run concurrently:
//   T01 auto            pins the shared REST contract + the stdlib pure core + schema/seed + runnable stubs
//   T02 auto (deps T01) docker-compose glue that boots the stubbed stack  ┐
//   T03 auto (deps T01) the real Postgres-backed backend                  ├ built CONCURRENTLY off T01,
//   T04 auto (deps T01) the real vanilla-JS front end                     ┘ partitioned by file so the
//                                                                           three branches merge clean
//   T05 you  (deps T02,T03,T04)  CHECK-IN #1 — the stack runs and a post persists
//   T06 auto (deps T05)          the end-to-end browser test
//   T07 you  (deps T06)          CHECK-IN #2 — final click-through + run the e2e test
//
// THE PURE-CORE / THIN-SHELL BOUNDARY, applied to the APP (this is the load-bearing design point, read it
// before changing a task doc). The scratch scaffold's `npm test` is `node --test` with NO `npm install`
// step — it runs in every task worktree and in every reviewer's fresh worktree. So every test a worker
// writes here must import ONLY the stdlib pure core T01 pins (post validation, the CRUD-decision function,
// the SQL-text builders) — never `pg`, never a browser, never a running server. The thin backend shell
// (which imports `pg`) and the front end are deliberately NOT unit-tested; they are hand-verified at the
// two `you` check-ins. That is why the app can carry real runtime deps (`pg`, `@playwright/test`) without
// ever breaking the green baseline. This is NOT a DESIGN §5 violation: §5 forbids runtime deps in the
// COORDINATOR's own code, for its portability — the throwaway app a fixture builds is not that code.
//
// The new fact reachedWidth(2) is the point of the whole capstone: ceilingHeld(3) only bounds concurrency
// from above (never more than 3 at once); reachedWidth(2) proves the LOWER bound — that at least two of
// the T02/T03/T04 trio were genuinely building in the same timeline tick. Two overlapping is enough to
// prove real parallelism; whether all three overlapped is for T37's reflection to note, not a fact that
// should redden on a slow third cold-start. The `you` check-ins reuse verifyWorkerSpawned/youNeverReviewed
// (§2.6, one per check-in), and scribeWroteFinding proves the hand-verified row reached main.
//
// ATTENDED, with TWO `you` check-ins in one run. The runner's hands-on announce path (T32/T34) already
// takes "the next un-announced `hands-on Txx` line" each poll, so it announces T05 then T07 in sequence
// with no change (verified against run.mjs handsOnToAnnounce + its loop; a run.test.mjs regression locks
// it). No auto-driver — attended-only stands (§4.1); the person drives each verify worker by hand.

import { defineScenario } from '../scenario.mjs';
import {
  reachedWidth,
  ceilingHeld,
  oneMergeToMain,
  verifyWorkerSpawned,
  youNeverReviewed,
  scribeWroteFinding,
} from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'blog-app';
const FINDINGS_PATH = `plans/${slug}/FINDINGS.md`;
const APP_URL = 'http://localhost:8080';

// The REST contract T01 pins and T03/T04 build against. Written out here (and into T01's task doc) so the
// backend and the front end, built by SEPARATE workers at the SAME time, actually fit at merge.
const CONTRACT = `\
GET    /api/posts        → 200 [{ id, title, body, authorId, createdAt }]
GET    /api/posts/:id    → 200 { id, title, body, authorId, createdAt } | 404
POST   /api/posts        → 201 { id, ... }        body: { title, body }
PUT    /api/posts/:id    → 200 { id, ... } | 404  body: { title, body }
DELETE /api/posts/:id    → 204 | 404
GET    /api/author       → 200 { id, name }       the single seeded author

Tables:
  authors(id, name)                                   seeded with EXACTLY one row
  posts(id, title, body, author_id → authors.id, created_at)

Single author by design — a real authors↔posts relation, but NO sign-up / log-in flow.`;

const progress = progressDoc({
  slug,
  summary:
    'A real DB-backed blog built in parallel: T01 pins the contract + pure core, then T02/T03/T04 build ' +
    'concurrently off it (ceiling 3), two you check-ins confirm the app runs, an e2e test seals it (§4.1, §2.6).',
  tasks: [
    { num: 'T01', name: 'Contract + pure core + schema/seed + runnable stubs', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T02', name: 'Docker: db + backend + frontend servers boot the stack', runs: 'auto', deps: ['T01'], state: '⬜' },
    { num: 'T03', name: 'Real backend: contract endpoints over Postgres', runs: 'auto', deps: ['T01'], state: '⬜' },
    { num: 'T04', name: 'Real frontend: page + vanilla JS on the API', runs: 'auto', deps: ['T01'], state: '⬜' },
    { num: 'T05', name: 'CHECK-IN #1 — the app works (you)', runs: 'you', deps: ['T02', 'T03', 'T04'], state: '⬜' },
    { num: 'T06', name: 'End-to-end browser test', runs: 'auto', deps: ['T05'], state: '⬜' },
    { num: 'T07', name: 'CHECK-IN #2 — final click-through + run e2e (you)', runs: 'you', deps: ['T06'], state: '⬜' },
  ],
});

const tasks = {
  'T01-contract-core-stubs.md': taskDoc({
    num: 'T01',
    title: 'Contract + pure core + schema/seed + runnable stubs',
    goal:
      `Lay the shared foundation the whole blog is built on. This task pins the REST contract the ` +
      `backend and front end are built against, the stdlib-only pure core they both reuse, the database ` +
      `schema and its one-row author seed, and throwaway STUBS that boot so the docker task has something ` +
      `to wire before the real backend/front end land. Later tasks REPLACE the stubs; do not build the ` +
      `real server or real page here.\n\n` +
      `THE CONTRACT (write it into a \`CONTRACT.md\` at the repo root verbatim; T03 and T04 consume it):\n\n` +
      '```\n' + CONTRACT + '\n```\n\n' +
      `THE PURE CORE (\`src/core/*.mjs\`, stdlib only — this is the only code with tests). At least: a post ` +
      `validator (title and body non-empty strings, trimmed; returns the clean fields or the reason it is ` +
      `invalid), a CRUD-decision helper that maps a method+id to the intended action and its success status ` +
      `(201/200/204/404) with no I/O, and SQL-TEXT builders that return the parameterised statement strings ` +
      `for each contract operation (the query text and the ordered params — they build strings, they do NOT ` +
      `connect to anything). Every one gets a \`node --test\` test that imports only stdlib.`,
    files: [
      '`CONTRACT.md` — the REST + tables contract above, verbatim.',
      '`src/core/posts.mjs` + `src/core/posts.test.mjs` — post validation and the CRUD-decision helper (pure).',
      '`src/core/sql.mjs` + `src/core/sql.test.mjs` — the parameterised SQL-text builders (pure, no `pg`).',
      '`db/schema.sql` — `authors` and `posts` tables.',
      '`db/seed.sql` — exactly one author row.',
      '`backend/server.mjs` — a throwaway stub HTTP server that boots and serves the contract shape from memory (no `pg`).',
      '`frontend/index.html` + `frontend/app.js` — a throwaway stub page that loads and lists whatever `/api/posts` returns.',
    ],
    tests:
      'A `node --test` test per pure-core module, stdlib only: the validator accepts a good post and names ' +
      'the reason for each bad one; the CRUD-decision helper maps every contract row to its action + status; ' +
      'the SQL builders return the expected statement text and ordered params. No test imports `pg`, a ' +
      'server, or a browser — `npm test` must stay install-free.',
    doneWhen: [
      '`CONTRACT.md` states the six endpoints and the two tables exactly as above.',
      'The pure core (validation, CRUD-decision, SQL-text builders) exists under `src/core/` with stdlib-only tests, and `npm test` is green.',
      '`db/schema.sql` creates both tables and `db/seed.sql` inserts exactly one author.',
      'Stub `backend/server.mjs` and `frontend/` boot (the docker task wires them); they are placeholders the real tasks replace.',
    ],
  }),
  'T02-docker-compose.md': taskDoc({
    num: 'T02',
    title: 'Docker: db + backend + frontend servers boot the stack',
    goal:
      `Make the whole stack come up with one command. Write a \`docker-compose.yml\` that boots three ` +
      `services — a Postgres database (running \`db/schema.sql\` then \`db/seed.sql\` at init), the backend ` +
      `server, and a static server for the front end — and Dockerfiles for the backend and front end that ` +
      `run the STUBS T01 committed. Front end is served at ${APP_URL}. You wire the stubs so the stack boots ` +
      `today; T03 and T04 replace the stub logic under you, and because you touch different files the three ` +
      `branches merge without conflict.\n\n` +
      `SCOPE FENCE (this is what keeps the T02/T03/T04 trio from colliding at merge): you own the docker and ` +
      `doc files ONLY. Do NOT edit \`backend/*.mjs\` or \`frontend/*\` logic, and do NOT edit \`package.json\`.`,
    files: [
      '`docker-compose.yml` — db + backend + frontend, db initialised from `db/schema.sql` and `db/seed.sql`.',
      '`backend/Dockerfile` — runs the backend server.',
      '`frontend/Dockerfile` — serves the static front end at ' + APP_URL + '.',
      '`README.md` — how to bring the stack up and down (`docker compose up --build`, `docker compose down`).',
    ],
    tests:
      'None new. This task adds no pure-core code, so it writes no `node --test` test; leave `npm test` ' +
      'green. The stack itself is hand-verified at check-in #1 (T05), not unit-tested (the pure-core boundary).',
    doneWhen: [
      '`docker compose up --build` boots db + backend + frontend with no error.',
      'The database is created from `db/schema.sql` and seeded from `db/seed.sql` on first boot.',
      '`README.md` documents bringing the stack up and `docker compose down` to tear it down.',
      'No `backend/*.mjs`, `frontend/*` logic, or `package.json` was touched — only docker and doc files.',
    ],
  }),
  'T03-backend.md': taskDoc({
    num: 'T03',
    title: 'Real backend: contract endpoints over Postgres',
    goal:
      `Replace the stub backend with the real one: an HTTP server that implements all six \`CONTRACT.md\` ` +
      `endpoints over Postgres. Reuse T01's pure core — the validator on writes, the CRUD-decision helper ` +
      `for the status codes, the SQL-text builders for every statement — and add a THIN \`pg\` data layer ` +
      `that runs those statements against the database. The server is a thin shell around the pure core; it ` +
      `is not unit-tested (it needs a live database), it is hand-verified at check-in #1.\n\n` +
      `SCOPE FENCE: you own \`backend/*.mjs\` and you are the ONLY trio member that edits \`package.json\` ` +
      `(to add the \`pg\` dependency). Do NOT touch \`frontend/*\`, the docker files, or \`db/*.sql\`.`,
    files: [
      '`backend/server.mjs` — the real server: the six contract endpoints, wiring the pure core to the `pg` data layer.',
      '`backend/db.mjs` — a thin `pg` data layer that runs the pure-core SQL-text builders against Postgres.',
      '`package.json` — add the `pg` dependency (you are the only trio member that edits this file).',
    ],
    tests:
      'None new here. The pure logic already has T01\'s stdlib tests; the `pg` shell is a thin data layer ' +
      'that needs a live database, so it is hand-verified at check-in #1, not unit-tested (the pure-core ' +
      'boundary — do not add a test that imports `pg`, it would break the install-free `npm test`).',
    doneWhen: [
      'All six `CONTRACT.md` endpoints work against Postgres, using T01\'s validator, CRUD-decision helper and SQL builders.',
      '`pg` is the only addition to `package.json`; `npm test` (pure core) stays green.',
      'No `frontend/*`, docker file, or `db/*.sql` was touched.',
    ],
  }),
  'T04-frontend.md': taskDoc({
    num: 'T04',
    title: 'Real frontend: page + vanilla JS on the API',
    goal:
      `Replace the stub page with the real front end: a single HTML page and vanilla JS that lists posts, ` +
      `and creates, edits and deletes them by calling the \`CONTRACT.md\` API. No framework, no build step, ` +
      `no new dependency. Any PURE render/format logic you factor out (say, turning a post into a list-item ` +
      `string, or formatting a timestamp) goes in a stdlib module under \`src/core/\` with its own ` +
      `\`node --test\` test; the DOM wiring itself is hand-verified at the check-ins, not unit-tested.\n\n` +
      `SCOPE FENCE: you own \`frontend/*\` (and any pure render helper under \`src/core/\`). Do NOT edit ` +
      `\`backend/*\`, the docker files, or \`package.json\` (add no dependency).`,
    files: [
      '`frontend/index.html` — the real page (list + create/edit/delete controls).',
      '`frontend/app.js` — vanilla JS calling the contract API; no framework, no build step.',
      '`src/core/render.mjs` + `src/core/render.test.mjs` — any pure render/format helper, stdlib only (optional but tested if present).',
    ],
    tests:
      'If you factor out any pure render/format logic, it gets a stdlib `node --test` test under ' +
      '`src/core/`. The DOM wiring and the live API calls are hand-verified at the check-ins (the pure-core ' +
      'boundary). `npm test` stays install-free and green.',
    doneWhen: [
      'The page lists posts and can create, edit and delete them against the contract API.',
      'No framework and no new dependency were added; `package.json` is untouched.',
      'Any pure render helper lives under `src/core/` with a stdlib test; `npm test` is green.',
      'No `backend/*` or docker file was touched.',
    ],
  }),
  'T05-checkin-1.md': taskDoc({
    num: 'T05',
    title: 'CHECK-IN #1 — the app works (you)',
    runs: 'you',
    goal:
      `The first hands-on check-in (DESIGN §2.6): a person brings the full stack up and confirms the ` +
      `behind-the-scenes half works — a post created in the browser is still there after a reload, which ` +
      `proves the backend is really persisting to Postgres and not just echoing. This is a \`you\` task: ` +
      `there is no code to write and no review. Present the "Needs a person" block, wait for the person to ` +
      `report, then record what they saw as a \`✅ verified by hand\` row in \`${FINDINGS_PATH}\` with the ` +
      `date.`,
    files: [`\`${FINDINGS_PATH}\` — append the \`✅ verified by hand\` row the person's report earns.`],
    tests: 'None — a you task has no code deliverable; the recorded observation is the evidence (§2.6).',
    doneWhen: [
      'A person brought the stack up and confirmed a created post survived a reload.',
      `A \`✅ verified by hand\` row recording that observation is in \`${FINDINGS_PATH}\`.`,
    ],
    needsPerson: {
      // The worker owns bring-up and teardown (DESIGN §2.6, T39); the person only judges.
      setup: 'docker compose up --build',
      teardown: 'docker compose down',
      command:
        `# Docker Desktop must be running — the worker brings the stack up and tears it down for you.\n` +
        `# Open ${APP_URL}, create a post (title + body), then RELOAD the page.`,
      expect: `the post you created is still listed after the reload — proof the backend persists to Postgres.`,
      tell: `whether the created post survived the reload (yes/no), and — if the page never loaded — say so.`,
    },
  }),
  'T06-e2e-test.md': taskDoc({
    num: 'T06',
    title: 'End-to-end browser test',
    goal:
      `Now the app is confirmed to work by hand (T05), add an end-to-end browser test that drives it the ` +
      `way a person just did: open the page, create a post, see it listed, edit it, delete it. Use a ` +
      `browser-driving test (e.g. \`@playwright/test\`) and expose it as \`npm run e2e\` — a SEPARATE script ` +
      `from \`npm test\`, because it needs the stack up and a browser installed, which \`npm test\` must ` +
      `never require. Do NOT wire the browser test into \`npm test\`; the install-free pure-core suite stays ` +
      `the only thing \`npm test\` runs. The browser driver is installed by the person at check-in #2, not ` +
      `by you under the clock.`,
    files: [
      '`e2e/blog.spec.mjs` — the browser test: create → list → edit → delete against the running stack.',
      '`package.json` — add an `e2e` script (`npm run e2e`) and the `@playwright/test` dev dependency; do NOT touch the `test` script.',
    ],
    tests:
      'The e2e test itself is the deliverable, run as `npm run e2e` against the live stack at check-in #2 — ' +
      'it is NOT part of `npm test`, which stays the install-free pure-core suite. Leave `npm test` green.',
    doneWhen: [
      '`npm run e2e` exists and drives create/list/edit/delete in a real browser against the running stack.',
      'The `test` script is unchanged and `npm test` stays install-free and green.',
    ],
  }),
  'T07-checkin-2.md': taskDoc({
    num: 'T07',
    title: 'CHECK-IN #2 — final click-through + run e2e (you)',
    runs: 'you',
    goal:
      `The final hands-on check-in (DESIGN §2.6): a person does the full click-through in the browser — ` +
      `create, edit and delete a post, each surviving a reload — and then runs the end-to-end test T06 ` +
      `built. This is a \`you\` task: no code, no review. Present the "Needs a person" block, wait for the ` +
      `report, and record the result as a \`✅ verified by hand\` row in \`${FINDINGS_PATH}\` with the date.`,
    files: [`\`${FINDINGS_PATH}\` — append the \`✅ verified by hand\` row the person's report earns.`],
    tests: 'None — a you task has no code deliverable; the recorded observation is the evidence (§2.6).',
    doneWhen: [
      'A person did the full create/edit/delete click-through and ran `npm run e2e`, and reported the result.',
      `A \`✅ verified by hand\` row recording that observation is in \`${FINDINGS_PATH}\`.`,
    ],
    needsPerson: {
      // The worker owns bring-up and teardown (DESIGN §2.6, T39); the person only judges. The e2e run
      // still sits in the person's steps here — moving the automated checks to the worker is T40's job.
      setup: 'docker compose up --build',
      teardown: 'docker compose down',
      command:
        `# Docker Desktop must be running — the worker brings the stack up and tears it down for you.\n` +
        `# 1. At ${APP_URL}: create a post, edit it, delete it — each change persists across a reload.\n` +
        `# 2. Install the browser driver ONCE, then run the e2e test:\n` +
        `npx playwright install\n` +
        `npm run e2e`,
      expect: `every browser action (create/edit/delete) persists across a reload, and \`npm run e2e\` passes.`,
      tell: `whether the click-through worked and whether \`npm run e2e\` passed, with any failure output.`,
    },
  }),
};

const scenario = defineScenario({
  id: slug,
  title: 'Blog-app — a real multi-component app built in parallel',
  fixture: slug,
  // Ceiling 3 so the whole T02/T03/T04 trio CAN run at once (reachedWidth needs the room the ceiling
  // grants). A 90-min wall-clock backstop: five auto builds and their reviews, the e2e task, and two
  // human-speed check-ins fit inside it, and it still auto-HALTs a hung run (§5.2).
  seatbelts: { ceiling: 3, timeoutMs: 90 * 60 * 1000 },
  facts: [
    reachedWidth(2),
    ceilingHeld(3),
    oneMergeToMain(),
    verifyWorkerSpawned('T05'),
    youNeverReviewed('T05'),
    verifyWorkerSpawned('T07'),
    youNeverReviewed('T07'),
    scribeWroteFinding({ file: FINDINGS_PATH, needle: '✅' }),
  ],
});

export default {
  id: slug,
  slug,
  title: 'Blog-app — a real multi-component app built in parallel',
  progress,
  tasks,
  // The runner captures this file's promoted content into the bundle (final-files.json) so
  // scribeWroteFinding can confirm the hand-verified row reached main offline.
  finalContent: { file: FINDINGS_PATH },
  scenario,
};
