// The fixture loader/installer of the live-scenario harness (DESIGN §4.1, T16). The six fixtures are
// scratch plans engineered so a REAL claude worker reliably hits one coordinator path (PM decision:
// all-real workers). This module is the registry over them and the installer the T17 live runner uses
// to lay one down as a self-contained scratch repo and seed its git state.
//
// A fixture is a JS descriptor (fixtures/<name>.mjs), not an on-disk plan tree: its plan text and task
// docs are inline strings and its scenario spec is a defineScenario(...) value (T15), the same
// SCRATCH_FILES idiom spawn-one-scratch.mjs already uses. This keeps each fixture self-contained and
// unit-testable, and means the loader's only job is to WRITE those strings and run git — the one place
// I/O lives (this module is shell, DESIGN §3.1; the descriptors and common.mjs are pure string work).
//
// What install lays down (all committed on `main`, so a task-branch worktree cut from the feature
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
} from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { commonPlanFiles, repoScaffold } from './fixtures/common.mjs';
import single from './fixtures/single.mjs';
import parallel from './fixtures/parallel.mjs';
import reviewQueue from './fixtures/review-queue.mjs';
import cleanMerge from './fixtures/clean-merge.mjs';
import mergeConflict from './fixtures/merge-conflict.mjs';
import humanDecision from './fixtures/human-decision.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The repo's own skills/ dir (src/shell/harness → src/shell → src → repo root → skills). The parallel
// skills a worker needs (pir-worker, pir-implement, pir-review, pir-verify) and the coordinator skill
// live here and nowhere in ~/.claude/skills, so a fixture must carry them (FINDINGS 2026-09-09).
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
export function fixtureFiles(fixture) {
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

// carrySource(srcDir, destDir) → true if the framework code was copied. `pir-coordinate` shells out to
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

// seedGit(dir, runGit, date) → init on `main`, stage everything, one commit. Deterministic: fixed
// identity, fixed author/committer date, gpgsign forced off (an automated seed has no one to sign or
// type a passphrase, and a global commit.gpgsign=true would otherwise hang it). `-c` overrides are
// per-invocation, so the user's own git config is untouched.
function seedGit(dir, runGit, date) {
  const ident = [
    '-c',
    'user.name=PIR Fixture',
    '-c',
    'user.email=fixture@pir.local',
    '-c',
    'commit.gpgsign=false',
  ];
  const init = runGit(['init', '-b', 'main'], { cwd: dir });
  if (!init.ok) throw new Error(`fixture seed: git init failed: ${init.stderr}`);
  runGit(['add', '-A'], { cwd: dir });
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const commit = runGit([...ident, 'commit', '-m', 'fixture: scratch plan seed', '--no-edit'], { cwd: dir, env });
  if (!commit.ok) throw new Error(`fixture seed: git commit failed: ${commit.stderr}`);
}

// installFixture(id, opts) → { id, slug, dir, files, skills, source }. Lay the fixture down as a
// self-contained scratch repo at `into` and seed its git state. The T17 live runner calls this, then opens
// the feature branch off the seeded `main` and drives real workers; a test calls it against a temp dir
// with real git.
//
//   into       — the scratch repo root to create (required). Must not be the real project (a T17
//                seatbelt, enforced there, not here — this installer will lay a fixture anywhere).
//   skillsDir  — where to carry the parallel skills from (default: the repo's skills/).
//   srcDir     — where to carry the framework code from (default: the repo's src/); the coordinator skill
//                runs `node src/shell/coordinate.mjs` inside the scratch repo, so it must be present.
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
  const source = carrySource(srcDir, join(into, 'src'));
  seedGit(into, runGit, date);

  return { id, slug: fixture.slug, dir: into, files: written, skills, source };
}
