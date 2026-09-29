// The planning rig (pir-plan-command T10, DESIGN §4, §5 End to end, §5.2): the real `pir` screen in a
// scratch repo, with every Claude session any program of the run starts being the fake
// (fake/claude-stream.mjs behind the T05 shim, first on PATH). It is how each screen task of the plan
// proves itself end to end in `npm test`: startPlanRig() stands the world up, and the returned
// openScreen/driveScreen run the real pir.mjs under a pty in it.
//
// It extends conversation-rig.mjs rather than adding a second screen driver: openScreen/driveScreen are
// that file's, bound here to the scratch repo and the rig's environment.
//
// The environment is the whole seatbelt, so it is built from scratch rather than inherited:
//   - PATH starts with the shim folder, so `resolveClaudePath` (`command -v claude`) finds the fake in
//     pir and in any detached program pir spawns; no real `claude` is ever reached.
//   - PIR_HOME and HOME both point at a scratch folder, so the index (indexDir) and anything else that
//     reads the home folder never touch the person's real `~/.pir` or `~/.claude`. That home has a
//     .gitconfig with an identity, because a scratch HOME has none and git refuses a commit without one.
//   - PIR_REPOS is the rig's root, so the dashboard's new-plan box lists the scratch `repo` (its `home` and
//     `bin` siblings are not git repos) and its scan never reads the person's real folders
//     (dashboard-plan-box DESIGN §4, §5.2).
//   - The shim folder also holds a `pbcopy` that writes what it is given to {root}/bin/clipboard.txt, so
//     pir's copy-on-select (defaultCopy runs `pbcopy` by PATH on macOS, mouse-navigation §2.5) never
//     reaches the person's real clipboard; a drag or a double click in a pty test did (T08 drill).
//   - The fake's single-script variables are dropped, so an outer test's setting cannot leak in. A stale
//     PARALLEL_ALLOW_HERE is dropped too, harmlessly: its guard is gone (dashboard-plan-box DESIGN §2.8).

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openScreen as openScreenRaw, driveScreen as driveScreenRaw } from './conversation-rig.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { COORDINATOR_MATCH, DRILL_SLUG, HELPER_DRILL_SLUG, PLANNER_MATCH, REVIEWER_MATCH, coordinatorScript, drillPlanFiles, drillScripts, helperDrillPlanFiles, helperDrillScripts, noPlanScript, plannerScript, reviewerScript, workerScripts } from './fake/sessions.mjs';
import { assistantText, canUseTool, initEvent, resultEvent, toolUse } from './fake/claude-stream.mjs';

const SESSIONS = fileURLToPath(new URL('./fake/sessions.mjs', import.meta.url));

// The slug the fake planner names in every script set. 'taken-slug' makes it taken and has the planner
// move to PLAN_RIG_SLUG_2 once pir says so.
export const PLAN_RIG_SLUG = 'rig-plan';
export const PLAN_RIG_SLUG_2 = 'rig-plan-two';
export const PLAN_RIG_QUESTION = 'Which way should the plan go?';
export const PLAN_RIG_REVIEW_ASK = 'Is the name rig-plan fine before I mark it reviewed?';
export const PLAN_RIG_REVIEW_COMMAND = 'git log --oneline -3';
export const SCRIPT_SETS = ['happy', 'no-plan', 'taken-slug', 'crash-planner', 'reviewer-asks']; // planning sets; 'coordinator-drill' and 'end-helper' plan nothing

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const GIT_ID = ['-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid'];
const GIT_SH = "git -c user.name='pir fake' -c user.email=fake@pir.invalid";

// The index of the step in a plannerScript that drops the `planned` report: the crash and the rename
// are placed relative to it, so a change to plannerScript's shape moves them with it.
function reportStep(steps) {
  const i = steps.findIndex((s) => typeof s.sh === 'string' && s.sh.includes('kind=planned'));
  if (i < 0) throw new Error('plannerScript has no `planned` report step');
  return i;
}

// scriptSet(name) → the [{ match, script }] entries of a PIR_FAKE_CLAUDE_SCRIPTS file:
//   happy          the planner asks one question and plans PLAN_RIG_SLUG; the reviewer reviews; workers build
//   no-plan        the planner drops `no-plan` straight away
//   taken-slug     as happy, but PLAN_RIG_SLUG is taken (startPlanRig makes the branch): after its first
//                  `planned` the planner waits for pir's message, renames its folder to PLAN_RIG_SLUG_2,
//                  commits and reports again; the reviewer reviews PLAN_RIG_SLUG_2
//   crash-planner  as happy, but the planner exits 1 after committing and before reporting; a resume
//                  continues past the crash (claude-stream.mjs records an `exit` step as completed) and
//                  drops `planned`
//   reviewer-asks  as happy, but the reviewer first asks permission to run PLAN_RIG_REVIEW_COMMAND, then
//                  asks PLAN_RIG_REVIEW_ASK in plain words and waits for the person's reply before it
//                  reviews (T14): a live reviewer to answer, and to stop and resume mid-review
//   coordinator-drill  no planning: startPlanRig commits the reviewed three-task plan DRILL_SLUG on `main`,
//                  whose implementers each ask one thing and whose coordinator agent reacts to whatever
//                  it is sent (pir-coordinator T07; fake/sessions.mjs drillScripts)
//   end-helper     no planning: startPlanRig commits the reviewed one-task plan HELPER_DRILL_SLUG, whose
//                  tests are red at the end until its tests-fix helper, after asking the person one
//                  question the agent passes on, commits the fix (pir-coordinator T11; helperDrillScripts)
export function scriptSet(name = 'happy') {
  if (name === 'coordinator-drill') return drillScripts();
  if (name === 'end-helper') return helperDrillScripts();
  const planner = plannerScript({ slug: PLAN_RIG_SLUG, question: PLAN_RIG_QUESTION });
  let reviewed = PLAN_RIG_SLUG;
  let plannerSteps;
  if (name === 'happy') plannerSteps = planner;
  else if (name === 'no-plan') plannerSteps = noPlanScript();
  else if (name === 'crash-planner') {
    const i = reportStep(planner);
    plannerSteps = [...planner.slice(0, i), { exit: 1 }, ...planner.slice(i)];
  } else if (name === 'taken-slug') {
    reviewed = PLAN_RIG_SLUG_2;
    const report = `[pir:v1 kind=planned plan=${PLAN_RIG_SLUG_2}]\nRenamed; the plan is committed.`;
    plannerSteps = [
      ...planner,
      { await: 'user' },
      { sh: `${GIT_SH} mv ${q(`plans/${PLAN_RIG_SLUG}`)} ${q(`plans/${PLAN_RIG_SLUG_2}`)} && ${GIT_SH} commit -q -m ${q(`plan(${PLAN_RIG_SLUG_2}): rename`)}` },
      { sh: [process.execPath, SESSIONS, 'report', '{{reportsDir}}', 'plan', report].map(q).join(' ') },
      ...planner.slice(-2).map((s) => JSON.parse(JSON.stringify(s).replaceAll(PLAN_RIG_SLUG, PLAN_RIG_SLUG_2))),
    ];
  } else if (name === 'reviewer-asks') plannerSteps = planner;
  else throw new Error(`unknown script set "${name}" (${SCRIPT_SETS.join(', ')})`);
  let reviewerSteps = reviewerScript({ slug: reviewed });
  if (name === 'reviewer-asks') {
    // reviewerScript is: await, init, a line, then the work; the asks go between the line and the work.
    const input = { command: PLAN_RIG_REVIEW_COMMAND, description: 'Read the plan commits' };
    reviewerSteps = [
      ...reviewerSteps.slice(0, 3),
      { emit: toolUse('toolu_rev-ask-1', 'Bash', input) },
      { emit: canUseTool('rev-ask-1', 'Bash', input) },
      { await: 'control_response' },
      { resultFor: 'rev-ask-1', allowed: `abc1234 plan(${reviewed}): fake plan` },
      { emit: assistantText(PLAN_RIG_REVIEW_ASK) },
      { emit: resultEvent('success', PLAN_RIG_REVIEW_ASK) },
      { await: 'user' },
      { emit: initEvent() },
      ...reviewerSteps.slice(3),
    ];
  }
  return [
    { match: PLANNER_MATCH, script: plannerSteps },
    { match: REVIEWER_MATCH, script: reviewerSteps },
    ...workerScripts(),
    { match: COORDINATOR_MATCH, script: coordinatorScript() },
  ];
}

// The environment every program under the rig gets; see the header.
function rigEnv({ root, home, shimDir, base }) {
  const env = { ...base };
  for (const k of ['PARALLEL_ALLOW_HERE', 'PIR_FAKE_CLAUDE_SCRIPT', 'PIR_FAKE_CLAUDE_SCRIPTS', 'PIR_FAKE_CLAUDE_RECEIVED']) delete env[k];
  return {
    ...env,
    PATH: [shimDir, base.PATH ?? ''].filter(Boolean).join(':'),
    PIR_HOME: home,
    HOME: home,
    PIR_REPOS: root,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
}

function git(cwd, ...args) {
  return execFileSync('git', [...GIT_ID, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// withReportHold(entries, ms) → entries whose coordinator agent waits `ms` before it writes the delivery
// report, so the live view's `preparing: syncing {base}, writing the report` stays on screen long enough to
// be read (base-branch T09); the fake would otherwise write it between two frames.
function withReportHold(entries, ms) {
  return entries.map((e) => {
    if (e.match !== COORDINATOR_MATCH) return e;
    const at = e.script.findIndex((st) => typeof st.sh === 'string' && st.sh.includes('coordinator-report'));
    return at < 0 ? e : { ...e, script: [...e.script.slice(0, at), { sleep: ms }, ...e.script.slice(at)] };
  });
}

// seedRemote(root, repoDir, base) → { path, ahead }: a local bare repository at {root}/origin.git as the
// repo's `origin`, holding the repo's base, then one commit (CHANGELOG.md) pushed to the remote's base
// through a throwaway clone, so the remote is ahead of the local copy (base-branch DESIGN §2.3, §4: a
// file-path remote exercises the same fetch code as a network one, with no network). No upstream is set:
// the remote is picked as `origin` (§2.4).
function seedRemote(root, repoDir, base) {
  const path = join(root, 'origin.git');
  const clone = join(root, 'origin-clone');
  git(root, 'init', '-q', '--bare', '-b', base, path);
  git(repoDir, 'remote', 'add', 'origin', path);
  git(repoDir, 'push', '-q', 'origin', `refs/heads/${base}:refs/heads/${base}`);
  git(root, 'clone', '-q', '--branch', base, path, clone);
  writeFileSync(join(clone, 'CHANGELOG.md'), `# Changelog\n\n- ${base} moved on the remote\n`);
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', `${base}: moved on the remote`);
  git(clone, 'push', '-q', 'origin', base);
  const ahead = git(clone, 'rev-parse', 'HEAD');
  rmSync(clone, { recursive: true, force: true });
  return { path, ahead };
}

// startPlanRig({ into, scripts, keep, base, remoteAhead, settings, holdReportMs }) → { root, repoDir, home,
//   env, shimDir, scriptsFile, received, clipboard, slug, base, remote, cleanup(), openScreen(opts),
//   driveScreen(opts) }
//
// `base` (default `main`) is the only branch the repo has and the one its settings name; `remoteAhead`
// gives it an `origin` whose base is one commit ahead (`remote` is then { path, ahead }, else null);
// `settings: false` leaves .pir/settings.json out, for the no-base-setting refusal; `holdReportMs` has the
// coordinator agent wait that long before its report (withReportHold). All four are base-branch T09's.
//
// `into` is an empty or new folder to build in (else a fresh temp folder); the rig lays out
//   {root}/repo   a git repo on the base branch: README.md, package.json (test `node -e 0`) and
//                 .pir/settings.json naming the base, one commit
//   {root}/origin.git  the bare remote, with `remoteAhead` only
//   {root}/home   PIR_HOME and HOME
//   {root}/bin    the `claude` shim, its scripts file and the fake's received log / resume progress, and
//                 the `pbcopy` shim with `clipboard.txt`, the last text it was given (absent until a copy)
// Worktrees a run adds sit under repo/.claude/worktrees, so removing the root removes them too.
// cleanup() deletes the root unless `keep`; idempotent. It does not stop programs a test started: a test
// that launches a run stops it first, as pir's own stop would.
export function startPlanRig({ into = null, scripts = 'happy', keep = false, baseEnv = process.env, base = 'main', remoteAhead = false, settings = true, holdReportMs = 0 } = {}) {
  const entries = holdReportMs > 0 ? withReportHold(scriptSet(scripts), holdReportMs) : scriptSet(scripts);
  let root;
  if (into) {
    root = resolve(into);
    if (existsSync(root) && readdirSync(root).length) throw new Error(`into ${root}: not empty; the rig deletes what it made, so it wants an empty or new folder`);
    mkdirSync(root, { recursive: true });
  } else {
    root = mkdtempSync(join(tmpdir(), 'pir-plan-rig-'));
  }
  const repoDir = join(root, 'repo');
  const home = join(root, 'home');
  const shimDir = join(root, 'bin');
  mkdirSync(repoDir);
  mkdirSync(home);
  mkdirSync(shimDir);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir rig\n\temail = rig@pir.invalid\n');

  git(repoDir, 'init', '-q', '-b', base);
  writeFileSync(join(repoDir, 'README.md'), '# rig\n\nA scratch repo for the planning rig.\n');
  // pir refuses a repo that names no base branch (base-branch DESIGN §2.1, §5).
  if (settings) {
    mkdirSync(join(repoDir, '.pir'));
    writeFileSync(join(repoDir, '.pir', 'settings.json'), JSON.stringify({ baseBranch: base }) + '\n');
  }
  writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ name: 'pir-plan-rig', private: true, scripts: { test: 'node -e 0' } }, null, 2) + '\n');
  // Worktrees live inside the repo; ignoring them keeps the base's checkout clean (FINDINGS 2026-09-26).
  writeFileSync(join(repoDir, '.git', 'info', 'exclude'), '.claude/worktrees/\n');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'rig: scratch repo');
  const committedPlan = { 'coordinator-drill': [DRILL_SLUG, drillPlanFiles, 'coordinator'], 'end-helper': [HELPER_DRILL_SLUG, helperDrillPlanFiles, 'end-helper'] }[scripts];
  if (committedPlan) {
    const [planSlug, files, drill] = committedPlan;
    for (const [path, content] of Object.entries(files(planSlug))) {
      mkdirSync(join(repoDir, path, '..'), { recursive: true });
      writeFileSync(join(repoDir, path), content);
    }
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', `plan(${planSlug}): the ${drill} drill's plan`);
  }
  // A taken slug by its branch (DESIGN §2.5), which leaves `main` at its one commit.
  if (scripts === 'taken-slug') git(repoDir, 'branch', `pir/${PLAN_RIG_SLUG}`);
  const remote = remoteAhead ? seedRemote(root, repoDir, base) : null;

  const scriptsFile = join(shimDir, 'fake-scripts.json');
  writeFileSync(scriptsFile, JSON.stringify(entries));
  const received = join(shimDir, 'fake-received.ndjson');
  writeClaudeShim(shimDir, { scriptsFile, received });
  const clipboard = join(shimDir, 'clipboard.txt');
  writeFileSync(join(shimDir, 'pbcopy'), `#!/bin/sh\ncat > ${q(clipboard)}\n`);
  chmodSync(join(shimDir, 'pbcopy'), 0o755);
  const env = rigEnv({ root, home, shimDir, base: baseEnv });

  let cleaned = false;
  function cleanup() {
    if (cleaned || keep) return;
    cleaned = true;
    rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    repoDir,
    home,
    env,
    shimDir,
    scriptsFile,
    received,
    clipboard,
    slug: scripts === 'taken-slug' ? PLAN_RIG_SLUG_2 : committedPlan ? committedPlan[0] : PLAN_RIG_SLUG,
    base,
    remote,
    cleanup,
    openScreen: (opts = {}) => openScreenRaw({ cwd: repoDir, env, ...opts }),
    driveScreen: (opts = {}) => driveScreenRaw({ cwd: repoDir, env, ...opts }),
  };
}
