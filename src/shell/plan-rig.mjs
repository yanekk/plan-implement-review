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

import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openScreen as openScreenRaw, driveScreen as driveScreenRaw } from './conversation-rig.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { BANG_HAND_SLUG, BUILDER_MATCH, COORDINATOR_MATCH, DRILL_SLUG, HELPER_DRILL_SLUG, PLANNER_MATCH, REVIEWER_MATCH, SINGLE_FINISHER_MATCH, SINGLE_RED_FILE, SINGLE_REVIEWER_MATCH, bangBuildPlanFiles, bangBuildScripts, bangBuilderScript, bangPlannerScript, coordinatorScript, drillPlanFiles, drillScripts, helperDrillPlanFiles, helperDrillScripts, noPlanScript, plannerScript, reviewerScript, singleBuilderScript, singleFinisherScript, singleReviewerScript, workerScripts } from './fake/sessions.mjs';
import { startSingleRun } from './launch.mjs';
import { assistantText, canUseTool, initEvent, resultEvent, toolUse } from './fake/claude-stream.mjs';

const SESSIONS = fileURLToPath(new URL('./fake/sessions.mjs', import.meta.url));

// The slug the fake planner names in every script set. 'taken-slug' makes it taken and has the planner
// move to PLAN_RIG_SLUG_2 once pir says so.
export const PLAN_RIG_SLUG = 'rig-plan';
export const PLAN_RIG_SLUG_2 = 'rig-plan-two';
export const PLAN_RIG_QUESTION = 'Which way should the plan go?';
export const PLAN_RIG_REVIEW_ASK = 'Is the name rig-plan fine before I mark it reviewed?';
export const PLAN_RIG_REVIEW_COMMAND = 'git log --oneline -3';
export const SCRIPT_SETS = ['happy', 'no-plan', 'taken-slug', 'crash-planner', 'reviewer-asks', 'usage']; // planning sets; 'coordinator-drill' and 'end-helper' plan nothing
// The bang drill's sets (bang-commands T08): a planner, a single run's builder and a build, each waiting on the person.
export const BANG_SCRIPT_SETS = ['bang-plan', 'bang-single', 'bang-build'];

// Single runs (single-runs T08). The fake builder names its branch SINGLE_RIG_NAME in every single set;
// 'single-taken' has it name SINGLE_RIG_TAKEN first, which startPlanRig takes by its branch.
export const SINGLE_RIG_NAME = 'rig-fix';
export const SINGLE_RIG_TAKEN = 'rig-taken';
export const SINGLE_RIG_QUESTION = 'Should the fix also cover the second file?';
export const SINGLE_RIG_DROP_ASK = 'This is too big for a single run. Shall I drop it, so you can plan it with /plan?';
export const SINGLE_SCRIPT_SETS = ['single-happy', 'single-red', 'single-asks', 'single-dropped', 'single-taken'];
// The scratch repo's one test line, which a script turns red by committing SINGLE_RED_FILE.
export const SINGLE_RIG_TEST_LINE = `test ! -f ${SINGLE_RED_FILE}`;

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

// usageEvent({ fiveHour, sevenDay, uuid }) → the `rate_limit_event` a session on a claude.ai subscription
// receives (api-service DESIGN §2.3), for a script's `emit` step. The five-hour `resetsAt` is fixed and
// was already in the past when this was written, so no real session can ever produce this reading: a test
// tells the fake's numbers from the person's by it (api-usage-e2e.test.mjs).
export const USAGE_RESETS = Object.freeze({ fiveHour: 1790334600, sevenDay: 1790830800 });
export function usageEvent({ fiveHour = 0.2, sevenDay = 0.11, uuid = '00000000-0000-4000-8000-0000000000aa' } = {}) {
  return {
    type: 'rate_limit_event', session_id: '{{session}}', uuid,
    rate_limit_info: {
      status: 'allowed', rateLimitType: 'five_hour', resetsAt: USAGE_RESETS.fiveHour,
      unifiedWindows: {
        five_hour: { utilization: fiveHour, resetsAt: USAGE_RESETS.fiveHour },
        seven_day: { utilization: sevenDay, resetsAt: USAGE_RESETS.sevenDay },
      },
    },
  };
}

// withUsageEvent(entries, match, event) → entries whose `match` session emits the usage event right after
// its first init, which is where a real session's first reading arrives: before it has done anything. So a
// test sees the reading as soon as the session starts, without playing the run to its end (api-service T08).
export function withUsageEvent(entries, match, event = usageEvent()) {
  if (!entries.some((e) => e.match === match)) throw new Error(`withUsageEvent: no entry matches "${match}"`);
  return entries.map((e) => {
    if (e.match !== match) return e;
    const at = e.script.findIndex((st) => st.emit?.type === 'system' && st.emit.subtype === 'init');
    if (at < 0) throw new Error(`withUsageEvent: the "${match}" script emits no init`);
    return { ...e, script: [...e.script.slice(0, at + 1), { emit: event }, ...e.script.slice(at + 1)] };
  });
}

// scriptSet(name, { repoDir }) → the [{ match, script }] entries of a PIR_FAKE_CLAUDE_SCRIPTS file (a single
// set scripts its finisher only when given the scratch repo, repoDir, which names its status folder):
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
//   usage          as happy, but the planner receives one usage event as it starts (usageEvent), so the
//                  planning run writes the rig home's .pir/usage.json (api-service T08)
//   coordinator-drill  no planning: startPlanRig commits the reviewed three-task plan DRILL_SLUG on `main`,
//                  whose implementers each ask one thing and whose coordinator agent reacts to whatever
//                  it is sent (pir-coordinator T07; fake/sessions.mjs drillScripts)
//   end-helper     no planning: startPlanRig commits the reviewed one-task plan HELPER_DRILL_SLUG, whose
//                  tests are red at the end until its tests-fix helper, after asking the person one
//                  question the agent passes on, commits the fix (pir-coordinator T11; helperDrillScripts)
//   bang-plan      the planner waits for the person's `!`, answers it, then hands the person a command
//                  (bangPlannerScript); it never plans
//   bang-single    a single run whose builder answers every message and never builds (bangBuilderScript)
//   bang-build     no planning: startPlanRig commits the reviewed one-task plan BANG_HAND_SLUG, whose
//                  implementer hands the person a command before it builds (bang-commands T08)
//
// The single-run sets (single-runs T08) script the builder and reviewer of `@repo/single`, and carry the
// `happy` planning entries after them, so one rig can also plan:
//   single-happy    the builder commits and reports built SINGLE_RIG_NAME; the reviewer commits a fix and
//                   reports reviewed
//   single-red      the builder's first commit turns the repo's test line red; on pir's red message its
//                   second commit turns it green
//   single-asks     the builder asks SINGLE_RIG_QUESTION (a question set) before it builds
//   single-dropped  the builder asks SINGLE_RIG_DROP_ASK in plain words and reports dropped once the
//                   person replies
//   single-taken    the builder first names SINGLE_RIG_TAKEN, which is taken, then SINGLE_RIG_NAME
export function scriptSet(name = 'happy', { repoDir = null } = {}) {
  if (name === 'coordinator-drill') return drillScripts();
  if (name === 'end-helper') return helperDrillScripts();
  if (name === 'bang-build') return bangBuildScripts();
  if (name === 'bang-plan') return [{ match: PLANNER_MATCH, script: bangPlannerScript() }, ...scriptSet('happy').filter((e) => e.match !== PLANNER_MATCH)];
  if (name === 'bang-single') return [{ match: BUILDER_MATCH, script: bangBuilderScript() }, ...scriptSet('single-happy', { repoDir }).filter((e) => e.match !== BUILDER_MATCH)];
  if (SINGLE_SCRIPT_SETS.includes(name)) {
    const builder = {
      'single-happy': {},
      'single-red': { red: true },
      'single-asks': { question: SINGLE_RIG_QUESTION },
      'single-dropped': { dropAsk: SINGLE_RIG_DROP_ASK },
      'single-taken': { takenName: SINGLE_RIG_TAKEN },
    }[name];
    // The finisher (single-finisher T07): its status folder is under the run's renamed control folder, so
    // it is scripted only where the scratch repo is known (startPlanRig).
    const finisher = repoDir
      ? [{ match: SINGLE_FINISHER_MATCH, script: singleFinisherScript({ name: SINGLE_RIG_NAME, statusDir: join(repoDir, 'plans', SINGLE_RIG_NAME, '.parallel', 'single', 'finisher', 'status'), repoRoot: repoDir }) }]
      : [];
    return [
      { match: BUILDER_MATCH, script: singleBuilderScript({ name: SINGLE_RIG_NAME, ...builder }) },
      { match: SINGLE_REVIEWER_MATCH, script: singleReviewerScript({ name: SINGLE_RIG_NAME }) },
      ...finisher,
      ...scriptSet('happy'),
    ];
  }
  if (name === 'usage') return withUsageEvent(scriptSet('happy'), PLANNER_MATCH);
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
  else throw new Error(`unknown script set "${name}" (${[...SCRIPT_SETS, ...SINGLE_SCRIPT_SETS].join(', ')})`);
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

// pidsWorkingIn(dir) → the pids (not this process) whose working folder is `dir` or inside it, read from
// lsof; [] when lsof cannot be run. lsof exits 1 when it could not read some process, with what it read on stdout.
function pidsWorkingIn(dir) {
  return new Promise((res) => {
    execFile('lsof', ['-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 }, (_err, stdout) => {
      const pids = [];
      let pid = null;
      for (const line of (stdout ?? '').split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1));
        else if (line.startsWith('n') && pid !== process.pid && (line.slice(1) === dir || line.startsWith(`n${dir}/`))) pids.push(pid);
      }
      res([...new Set(pids)]);
    });
  });
}

// How long settle() waits for the rig's programs to leave before it ends them. A stopped run's stragglers
// (a reaped worker's fake and the git it ran, the coordinator's own git) are children of programs the stop
// signalled without waiting for them, and on a machine busy with the other test files they take seconds to go.
const SETTLE_MS = 30000;

// startPlanRig({ into, scripts, keep, base, remoteAhead, settings, holdReportMs }) → { root, repoDir, home,
//   env, shimDir, scriptsFile, received, clipboard, slug, base, remote, cleanup(), settle(), openScreen(opts),
//   driveScreen(opts) }
//
// `base` (default `main`) is the only branch the repo has and the one its settings name; `remoteAhead`
// gives it an `origin` whose base is one commit ahead (`remote` is then { path, ahead }, else null);
// `settings: false` leaves .pir/settings.json out, for the no-base-setting refusal; `holdReportMs` has the
// coordinator agent wait that long before its report (withReportHold). All four are base-branch T09's.
//
// `into` is an empty or new folder to build in (else a fresh temp folder); the rig lays out
//   {root}/repo   a git repo on the base branch: README.md, package.json (test `node -e 0`) and
//                 .pir/settings.json naming the base, no setup and the test line SINGLE_RIG_TEST_LINE,
//                 one commit
//   {root}/origin.git  the bare remote, with `remoteAhead` only
//   {root}/home   PIR_HOME and HOME
//   {root}/bin    the `claude` shim, its scripts file and the fake's received log / resume progress, and
//                 the `pbcopy` shim with `clipboard.txt`, the last text it was given (absent until a copy)
// Worktrees a run adds sit under repo/.claude/worktrees, so removing the root removes them too.
// cleanup() deletes the root unless `keep`; idempotent. It does not stop programs a test started: a test
// that launches a run stops it first, as pir's own stop would, then awaits settle() for the stragglers.
export function startPlanRig({ into = null, scripts = 'happy', keep = false, baseEnv = process.env, base = 'main', remoteAhead = false, settings = true, holdReportMs = 0 } = {}) {
  let root;
  if (into) {
    root = resolve(into);
    if (existsSync(root) && readdirSync(root).length) throw new Error(`into ${root}: not empty; the rig deletes what it made, so it wants an empty or new folder`);
    mkdirSync(root, { recursive: true });
  } else {
    root = mkdtempSync(join(tmpdir(), 'pir-plan-rig-'));
  }
  const repoDir = join(root, 'repo');
  const entries = holdReportMs > 0 ? withReportHold(scriptSet(scripts, { repoDir }), holdReportMs) : scriptSet(scripts, { repoDir });
  const home = join(root, 'home');
  const shimDir = join(root, 'bin');
  mkdirSync(repoDir);
  mkdirSync(home);
  mkdirSync(shimDir);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir rig\n\temail = rig@pir.invalid\n');

  git(repoDir, 'init', '-q', '-b', base);
  writeFileSync(join(repoDir, 'README.md'), '# rig\n\nA scratch repo for the planning rig.\n');
  // pir refuses a repo that names no base branch (base-branch DESIGN §2.1, §5), and a single run in one
  // that names no setup/test commands (single-runs DESIGN §2.2): no setup, and a test line that passes
  // until a script commits SINGLE_RED_FILE.
  if (settings) {
    mkdirSync(join(repoDir, '.pir'));
    writeFileSync(join(repoDir, '.pir', 'settings.json'), JSON.stringify({ baseBranch: base, setup: [], test: [SINGLE_RIG_TEST_LINE] }) + '\n');
  }
  writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ name: 'pir-plan-rig', private: true, scripts: { test: 'node -e 0' } }, null, 2) + '\n');
  // Worktrees live inside the repo; ignoring them keeps the base's checkout clean (FINDINGS 2026-09-26).
  writeFileSync(join(repoDir, '.git', 'info', 'exclude'), '.claude/worktrees/\n');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'rig: scratch repo');
  const committedPlan = { 'coordinator-drill': [DRILL_SLUG, drillPlanFiles, 'coordinator'], 'end-helper': [HELPER_DRILL_SLUG, helperDrillPlanFiles, 'end-helper'], 'bang-build': [BANG_HAND_SLUG, bangBuildPlanFiles, 'bang'] }[scripts];
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
  if (scripts === 'single-taken') git(repoDir, 'branch', `pir/${SINGLE_RIG_TAKEN}`);
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
    // A stopped run's last children (a reaped worker's fake, the git it ran) can still be writing into the
    // scratch repo for a moment after stopRun returns, and a recursive rm racing a new file fails with
    // ENOTEMPTY (seen under load: plan-rig-mouse's drill teardown). rmSync's own retry covers that gap.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  // settle() → resolves once no program is working inside the rig any more, so cleanup() does not remove the
  // scratch repo under a git or a fake that is still writing into it (ENOTEMPTY on repo/.git, seen under load in
  // the bang drill's build). A program still there after SETTLE_MS is sent SIGKILL: the rig is going away, and a
  // straggler left running would only load the machine for the tests after it. Call it after stopping the runs.
  async function settle() {
    if (cleaned || keep || !existsSync(root)) return;
    const real = realpathSync(root);
    const deadline = Date.now() + SETTLE_MS;
    for (;;) {
      const pids = await pidsWorkingIn(real);
      if (pids.length === 0) return;
      if (Date.now() > deadline) {
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
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
    settle,
    openScreen: (opts = {}) => patientFirstFrame(openScreenRaw({ cwd: repoDir, env, ...opts })),
    driveScreen: (opts = {}) => driveScreenRaw({ cwd: repoDir, env, ...opts }),
  };
}

// The least a screen's first waitFor allows. That first wait is on pir itself starting (node, its imports, the
// repo scan) under a pty, which alone takes a second but on a machine busy with the other test files was seen to
// draw nothing for over 15 s, the default ceiling. Later waits are on a running pir and keep their own ceiling.
const FIRST_FRAME_MS = 60000;

// patientFirstFrame(screen) → the same screen, whose first waitFor allows at least FIRST_FRAME_MS.
function patientFirstFrame(screen) {
  let first = true;
  const waitFor = screen.waitFor;
  return {
    ...screen,
    waitFor(until = null, limit = 15000) {
      const ms = first ? Math.max(limit, FIRST_FRAME_MS) : limit;
      first = false;
      return waitFor(until, ms);
    },
  };
}

// startSingle(rig, prompt, opts) → startSingleRun's result: a single run started in the rig's scratch repo
// with the rig's environment, as the dashboard box starts one (single-runs DESIGN §2.3), for a test that
// does not go through the box. The program it spawns is detached; the test stops it, as for a planning run.
export function startSingle(rig, prompt, opts = {}) {
  return startSingleRun(prompt, { cwd: rig.repoDir, env: rig.env, ...opts });
}
