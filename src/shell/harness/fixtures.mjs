// The fixture loader/installer of the live-scenario harness (DESIGN §4.1, T16). The fixtures are scratch
// plans engineered so a REAL claude worker reliably hits one coordinator path (PM decision: all-real
// workers). This module is the registry over them and the installer the T17 live runner uses to lay one
// down as a self-contained scratch repo and seed its git state. The set covers the coordinator paths:
// a single task, a concurrent pair, a review queue, a clean merge, a merge conflict, a worker that parks
// on the person, a crash-and-restart, a stop-and-restart mid-review and mid-implement, and a worker
// introducing a task the coordinator adopts and dispatches, and the real asking state (a report dropped
// mid-work, a wake-up while parked), and the coordinator agent answering, passing on and handing over
// (pir-coordinator), and several of its briefs at once with the hold limit firing (pir-coordinator-concurrent), and real phone alerts for a passed question and the end of the run (notify-live), and the finisher taking a green run over and finishing on the person's go from the phone (finisher-live), and a repo with only
// `dev` whose remote is ahead (dev-base). The old `hands-on` and `blog-app` fixtures
// exercised the `you`/hands-on model, which was removed with the down-channel (DESIGN §2.5, T05); they
// went with it.
//
// A fixture is a JS descriptor (fixtures/<name>.mjs), not an on-disk plan tree: its plan text and task
// docs are inline strings and its scenario spec is a defineScenario(...) value (T15), the same
// SCRATCH_FILES idiom spawn-one-scratch.mjs already uses. This keeps each fixture self-contained and
// unit-testable, and means the loader's only job is to WRITE those strings and run git — the one place
// I/O lives (this module is shell, DESIGN §3.1; the descriptors and common.mjs are pure string work).
//
// What install lays down (all committed on the fixture's base, `main` unless it names `base`, so a task-branch worktree cut from the feature
// branch carries them — DESIGN §2.9):
//   - the runnable scaffold (package.json + a green smoke test + .gitignore), from common.repoScaffold;
//   - the plan tree plans/{slug}/ (PROGRESS.md marked reviewed, DESIGN/PLAN/FINDINGS, tasks/);
//   - any seedFiles the tasks edit (e.g. greeting.txt for the merge-conflict fixture);
//   - the parallel skills under .claude/skills/, CARRIED from the repo's skills/ because they are NOT
//     installed in ~/.claude/skills — a spawned worker there falls back to pir-implement otherwise
//     (FINDINGS 2026-09-09). .gitignore keeps .claude/worktrees/ and plans/*/.parallel/ out of git,
//     but .claude/skills/ is tracked on purpose so it reaches every worktree.
//
// Determinism (DESIGN §4.1 acceptance: "installs and seeds deterministically"): the same fixture
// installed twice produces byte-identical committed state — fixed git identity, a fixed author/committer
// date, and gpgsign forced off — so two installs share a commit SHA and a run is reproducible.

import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  cpSync,
  symlinkSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { REMOTE_DIR, commonPlanFiles, repoScaffold } from './fixtures/common.mjs';
import single from './fixtures/single.mjs';
import parallel from './fixtures/parallel.mjs';
import reviewQueue from './fixtures/review-queue.mjs';
import cleanMerge from './fixtures/clean-merge.mjs';
import mergeConflict from './fixtures/merge-conflict.mjs';
import humanDecision from './fixtures/human-decision.mjs';
import restart from './fixtures/restart.mjs';
import restartReview from './fixtures/restart-review.mjs';
import restartImplement from './fixtures/restart-implement.mjs';
import dynamicTask from './fixtures/dynamic-task.mjs';
import liveWorkersDemo from './fixtures/live-workers-demo.mjs';
import planCommand from './fixtures/plan-command.mjs';
import realAsking from './fixtures/real-asking.mjs';
import stoppedAsking from './fixtures/stopped-asking.mjs';
import pirCoordinator from './fixtures/pir-coordinator.mjs';
import pirCoordinatorConcurrent from './fixtures/pir-coordinator-concurrent.mjs';
import notifyLive from './fixtures/notify-live.mjs';
import finisherLive from './fixtures/finisher-live.mjs';
import devBase from './fixtures/dev-base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The repo's own skills/ dir (src/shell/harness → src/shell → src → repo root → skills). The parallel
// skills a worker needs (pir-worker, pir-implement, pir-review) live here and nowhere in ~/.claude/skills,
// so a fixture must carry them (FINDINGS 2026-09-09).
export const DEFAULT_SKILLS_DIR = join(HERE, '..', '..', '..', 'skills');

// The repo's own src/ tree (src/shell/harness → src/shell → src). Carried into every scratch repo so the
// coordinator skill's `node src/shell/coordinate.mjs` resolves: the skill runs the framework code from the
// repo it lives in, and a scratch repo that carries only the skills but not the code they invoke stalls
// with the coordinator unable to find its bin (T17 live run 2026-09-11).
export const DEFAULT_SRC_DIR = join(HERE, '..', '..');

// A fixed seed date keeps the git state deterministic (see the header).
const FIXED_DATE = '2026-01-01T00:00:00Z';

// The registry, keyed by fixture id. Order is the natural reading order of DESIGN §4.1's list.
const FIXTURES = Object.freeze({
  [single.id]: single,
  [parallel.id]: parallel,
  [reviewQueue.id]: reviewQueue,
  [cleanMerge.id]: cleanMerge,
  [mergeConflict.id]: mergeConflict,
  [humanDecision.id]: humanDecision,
  [restart.id]: restart,
  [restartReview.id]: restartReview,
  [restartImplement.id]: restartImplement,
  [dynamicTask.id]: dynamicTask,
  [liveWorkersDemo.id]: liveWorkersDemo,
  [planCommand.id]: planCommand,
  [realAsking.id]: realAsking,
  [stoppedAsking.id]: stoppedAsking,
  [pirCoordinator.id]: pirCoordinator,
  [pirCoordinatorConcurrent.id]: pirCoordinatorConcurrent,
  [notifyLive.id]: notifyLive,
  [finisherLive.id]: finisherLive,
  [devBase.id]: devBase,
});

// listFixtures() → the fixture ids, in registry order.
export function listFixtures() {
  return Object.keys(FIXTURES);
}

// getFixture(id) → the descriptor, or throw naming the known ids (a scenario's `fixture` field resolves
// through here, so a typo fails loudly rather than installing nothing).
export function getFixture(id) {
  const f = FIXTURES[id];
  if (!f) throw new Error(`unknown fixture "${id}"; known: ${listFixtures().join(', ')}`);
  return f;
}

// fixtureFiles(fixture) → the full repo-relative path → content map the installer writes: the runnable
// scaffold, the common plan files, the fixture's own PROGRESS.md and task docs, and any seedFiles. Pure
// (no I/O), so a test can inspect exactly what a fixture lays down without touching the disk.
//
// A fixture that seeds no plan (plan-command, pir-plan-command T17) declares its whole tree as `files`
// instead, and gets exactly that: no scaffold, no plan tree.
export function fixtureFiles(fixture) {
  if (fixture.files) return { ...fixture.files };
  const { slug, title } = fixture;
  const taskFiles = Object.fromEntries(
    Object.entries(fixture.tasks).map(([name, body]) => [`plans/${slug}/tasks/${name}`, body]),
  );
  return {
    ...repoScaffold(),
    ...commonPlanFiles(slug, { title }),
    [`plans/${slug}/PROGRESS.md`]: fixture.progress,
    ...taskFiles,
    ...(fixture.seedFiles ?? {}),
  };
}

// --- The one place I/O happens: writing files, carrying skills, seeding git -----------------------

function defaultRunGit(args, { cwd, env } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// carrySkills(srcDir, destDir) → the skill names copied. Every subdirectory of the repo's skills/ is
// copied whole into the scratch repo's .claude/skills/ so both the coordinator skill and the worker
// skills are present locally (FINDINGS 2026-09-09). A missing source dir copies nothing rather than
// throwing, so a caller can point at a stub for a hermetic test.
function carrySkills(srcDir, destDir) {
  if (!srcDir || !existsSync(srcDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const name of names) {
    cpSync(join(srcDir, name), join(destDir, name), { recursive: true });
  }
  return names;
}

// carrySource(srcDir, destDir) → true if the framework code was copied. The coordinator runs as
// `node src/shell/coordinate.mjs`, so the scratch repo must carry the src/ tree, exactly as it carries the
// skills — without it the coordinator cannot find its bin and the run stalls with an empty flow log (T17
// live run 2026-09-11). Two things are deliberately left out: every `*.test.mjs` (else the scratch's
// `npm test` would run the framework's own suite instead of the fixture's task test) and the harness/
// subtree (the coordinator needs core + shell, not the live-scenario harness — nothing under shell imports
// it). cpSync's filter rejects a directory whole, so rejecting harness/ skips its entire subtree. A
// missing source dir copies nothing rather than throwing, so a test can point at a stub.
function carrySource(srcDir, destDir) {
  if (!srcDir || !existsSync(srcDir)) return false;
  const harness = join(srcDir, 'shell', 'harness');
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (from) => !from.endsWith('.test.mjs') && from !== harness && !from.startsWith(harness + sep),
  });
  return true;
}

// carryModules(srcDir, into) → true if the scratch repo's node_modules now links to the source repo's.
// The carried src/shell imports npm packages (the Agent SDK from worker-proc.mjs, pi-tui from pir-tui.mjs,
// live-workers T04, T10), and Node resolves them by walking up from the importing file, so a scratch repo
// with no node_modules fails every live run at import. A symlink, not a copy or an `npm ci`: the scratch
// runs the exact packages the source repo tested, costs no network and no disk, and the scratch's
// .gitignore (`node_modules`, no trailing slash, so it matches a symlink) keeps it out of the seed commit.
// A source with no node_modules (a stub srcDir) links nothing.
function carryModules(srcDir, into) {
  if (!srcDir) return false;
  const modules = join(srcDir, '..', 'node_modules');
  const link = join(into, 'node_modules');
  if (!existsSync(modules) || existsSync(link)) return false;
  symlinkSync(modules, link, 'dir');
  return true;
}

// seedGit(dir, runGit, date, base) → init on the fixture's base branch (`main` unless it names another),
// stage everything, one commit. Deterministic: fixed identity, fixed author/committer date, gpgsign forced
// off (an automated seed has no one to sign or type a passphrase, and a global commit.gpgsign=true would
// otherwise hang it). `-c` overrides are per-invocation, so the user's own git config is untouched.
const SEED_IDENT = ['-c', 'user.name=PIR Fixture', '-c', 'user.email=fixture@pir.local', '-c', 'commit.gpgsign=false'];

function seedGit(dir, runGit, date, base = 'main') {
  const init = runGit(['init', '-b', base], { cwd: dir });
  if (!init.ok) throw new Error(`fixture seed: git init failed: ${init.stderr}`);
  // The seeded repo names its base, as pir requires (base-branch DESIGN §2.1, §5).
  mkdirSync(join(dir, '.pir'), { recursive: true });
  writeFileSync(join(dir, '.pir', 'settings.json'), JSON.stringify({ baseBranch: base }) + '\n');
  runGit(['add', '-A'], { cwd: dir });
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const commit = runGit([...SEED_IDENT, 'commit', '-m', 'fixture: scratch plan seed', '--no-edit'], { cwd: dir, env });
  if (!commit.ok) throw new Error(`fixture seed: git commit failed: ${commit.stderr}`);
}

// REMOTE_DIR (common.mjs, where a fixture can import it without a cycle): the folder a fixture's bare
// remote is made in, inside the scratch repo so it goes with it; the fixture's .gitignore must name it.
export { REMOTE_DIR };

// seedRemote(dir, runGit, date, base, remote) → { path, seeded, ahead }. A local bare repository as the
// scratch repo's `origin` (base-branch DESIGN §4: a file-path remote exercises the same fetch, ancestry and
// fast-forward code as a network one, with no network). The seed is pushed to it, then `remote.ahead`'s
// files are committed on the remote's base only, through a throwaway clone, so the remote's base is one
// commit ahead of the local one: the stale clone pir must start from the newest copy of (§2.3). No upstream
// is set on the local base, so the remote is picked as `origin` (§2.4).
function seedRemote(dir, runGit, date, base, remote) {
  const path = join(dir, REMOTE_DIR);
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const must = (r, what) => {
    if (!r.ok) throw new Error(`fixture remote: ${what} failed: ${r.stderr}`);
    return r;
  };
  must(runGit(['init', '--bare', '-q', '-b', base, path], { cwd: dir }), 'git init --bare');
  must(runGit(['remote', 'add', 'origin', path], { cwd: dir }), 'git remote add');
  must(runGit(['push', '-q', 'origin', `refs/heads/${base}:refs/heads/${base}`], { cwd: dir }), 'the seed push');
  const seeded = must(runGit(['rev-parse', `refs/heads/${base}`], { cwd: dir }), 'rev-parse').stdout.trim();
  let ahead = null;
  if (remote.ahead) {
    const clone = mkdtempSync(join(tmpdir(), 'pir-fixture-remote-'));
    try {
      must(runGit(['clone', '-q', '--branch', base, path, clone], { cwd: dir }), 'the remote clone');
      for (const [rel, content] of Object.entries(remote.ahead.files)) {
        mkdirSync(dirname(join(clone, rel)), { recursive: true });
        writeFileSync(join(clone, rel), content);
      }
      must(runGit(['add', '-A'], { cwd: clone }), 'git add');
      must(runGit([...SEED_IDENT, 'commit', '-q', '-m', remote.ahead.message ?? `${base}: moved on the remote`], { cwd: clone, env }), 'the remote commit');
      must(runGit(['push', '-q', 'origin', base], { cwd: clone }), 'the remote push');
      ahead = must(runGit(['rev-parse', 'HEAD'], { cwd: clone }), 'rev-parse').stdout.trim();
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  }
  return { path, seeded, ahead };
}

// installFixture(id, opts) → { id, slug, dir, base, files, skills, source, modules, remote }. Lay the fixture down as a
// self-contained scratch repo at `into` and seed its git state. The T17 live runner calls this, then opens
// the feature branch off the seeded base and drives real workers; a test calls it against a temp dir
// with real git.
//
//   into       — the scratch repo root to create (required). Must not be the real project (a T17
//                seatbelt, enforced there, not here — this installer will lay a fixture anywhere).
//   skillsDir  — where to carry the parallel skills from (default: the repo's skills/).
//   srcDir     — where to carry the framework code from (default: the repo's src/); the coordinator skill
//                runs `node src/shell/coordinate.mjs` inside the scratch repo, so it must be present. The
//                node_modules beside it is linked in, so the carried code resolves its packages.
//   runGit     — injected git runner, so a test can drive real git or a fake.
//   date       — the fixed commit date, for a reproducible seed.
export function installFixture(
  id,
  { into, skillsDir = DEFAULT_SKILLS_DIR, srcDir = DEFAULT_SRC_DIR, runGit = defaultRunGit, date = FIXED_DATE } = {},
) {
  if (!into) throw new Error('installFixture: no target dir (into)');
  const fixture = getFixture(id);
  const files = fixtureFiles(fixture);

  mkdirSync(into, { recursive: true });
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(into, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written.push(rel);
  }

  const skills = carrySkills(skillsDir, join(into, '.claude', 'skills'));
  // A fixture whose programs run from the engine checkout (plan-command) opts out of the src/ copy.
  const source = fixture.carrySource === false ? false : carrySource(srcDir, join(into, 'src'));
  const modules = source ? carryModules(srcDir, into) : false;
  const base = fixture.base ?? 'main';
  seedGit(into, runGit, date, base);
  const remote = fixture.remote ? seedRemote(into, runGit, date, base, fixture.remote) : null;

  return { id, slug: fixture.slug, dir: into, base, files: written, skills, source, modules, remote };
}
