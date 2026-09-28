// plan-scan.mjs — the plans in a repo that `pir start` would build or resume, with their progress, for the
// box's slug pop-up and its exact-slug check (box-commands DESIGN §2.3, T02).
//
// Candidates are every folder under <repo>/plans/ holding a PROGRESS.md in the working tree, and every
// local branch pir/{slug}. Each is then read through planHome, the resolver `pir start` itself uses, so the
// list and startRun never disagree on where a plan is (the working tree wins for a slug in both). A
// planning branch not yet renamed (pir/plan-a1b2) holds no plans/plan-a1b2/ and drops out on its own.
// Which plan counts is the pure rule in core/buildable.mjs.

import * as nodeFs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { buildablePlan } from '../core/buildable.mjs';
import { planHome, validSlug } from './plan-home.mjs';

// Same contract as plan-home's exec: git args, { cwd } → stdout; throws on a non-zero exit.
function defaultExec(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

function workingTreeSlugs(repoPath, fs) {
  const plansDir = join(repoPath, 'plans');
  let entries;
  try {
    entries = fs.readdirSync(plansDir, { withFileTypes: true });
  } catch {
    return []; // no plans/ folder, or not readable
  }
  return entries
    .filter((e) => e.isDirectory() && validSlug(e.name) && fs.existsSync(join(plansDir, e.name, 'PROGRESS.md')))
    .map((e) => e.name);
}

// strip=3 turns refs/heads/pir/x into x. A nested ref (pir/a/b) comes out as a/b and fails validSlug.
function branchSlugs(repoPath, exec) {
  let out;
  try {
    out = exec(['for-each-ref', '--format=%(refname:strip=3)', 'refs/heads/pir/'], { cwd: repoPath });
  } catch {
    return []; // not a git repo, or git missing
  }
  return String(out ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(validSlug);
}

// scanPlans(repoPath, { exec, fs }) → [{ slug, done, total }] sorted by slug; never throws.
export function scanPlans(repoPath, { exec = defaultExec, fs = nodeFs } = {}) {
  try {
    const slugs = new Set([...workingTreeSlugs(repoPath, fs), ...branchSlugs(repoPath, exec)]);
    const plans = [];
    for (const slug of slugs) {
      const home = planHome(slug, { root: repoPath, exec, fs });
      if (home.where === 'none') continue;
      const counts = buildablePlan({ progress: home.read('PROGRESS.md'), design: home.read('DESIGN.md') });
      if (counts) plans.push({ slug, ...counts });
    }
    return plans.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  } catch {
    return [];
  }
}
