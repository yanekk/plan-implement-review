// singleflow — the pure rulebook of a single run (single-runs DESIGN §2.4–§2.8, §2.11, §3.3, §3.5).
//
// A single run makes one small change without a plan: pir runs the project's setup, holds a builder
// session that commits the change, runs the tests itself, renames the run to the builder's name, holds a
// fresh reviewer, runs the tests again and ends `ready`. This module decides every step of that from the
// saved state (`state.json`) and what the shell just observed, and returns the effects as a list of
// actions for the shell (src/shell/single-run.mjs) to execute in order. It reads no clock, no file and
// no process (boundary.test.mjs), so a whole run, red rounds and baseline included, is a millisecond test.
//
// The action vocabulary (DESIGN §3.3):
//   { type: 'runSetup' }                         run the setup lines in the run's worktree
//   { type: 'spawn', step, note? }               open a fresh session for `step` ('build' | 'review') with its
//                                                opening instruction. `note` is the failed setup run
//                                                ({ reason, tail, logPath }) for the shell to word.
//   { type: 'resumeSession', step, sessionId }   reopen that session by id and send resumeInstruction()
//   { type: 'check', kind, name }                run singleChecks for a report; the answer comes back as
//                                                facts.checks with facts.head on the next call
//   { type: 'send', text }                       a message from pir to the live session
//   { type: 'runTests', head }                   setup then test lines in the worktree, `head` under test
//   { type: 'runBaseline' }                      the same at the starting commit, in a throwaway worktree
//   { type: 'closeWhenIdle' }                    close the live session at the idle gate
//   { type: 'rename', substep }                  one of RENAME_SUBSTEPS, in order
//   { type: 'finish', outcome }                  the run ends 'ready' | 'dropped'. A command still in
//                                                flight (a `dropped` during a test run) is the shell's to kill.
//   { type: 'exitCrashed' }                      exit with no final status, so the run shows crashed
//
// A finished run keeps the `step` it ended in and carries `outcome`; there is no `done` step. That is
// how the PROGRESS cell tells a run dropped in build from one dropped in review (§2.8).

import { RENAME_SUBSTEPS, isValidSlug } from './planflow.mjs';

// The run id of a single run before the builder has named it: `single-` and four hex characters (§2.3).
export const SINGLE_ID_RE = /^single-[0-9a-f]{4}$/;

// How many red rounds a step gets before the session is told to stop and ask the person (§2.5).
export const RED_LIMIT = 3;

// The report kinds each step acts on (§2.7). A kind belonging to the other step is ignored.
const STEP_KINDS = {
  build: ['built', 'dropped'],
  review: ['reviewed', 'dropped'],
};

const ROLES = { build: 'builder', review: 'reviewer' };

// singleIdFrom(hex4) → 'single-' + hex4. The hex comes from the shell (the core draws no random
// number); anything else is a caller bug and throws.
export function singleIdFrom(hex4) {
  if (typeof hex4 !== 'string' || !/^[0-9a-f]{4}$/.test(hex4)) {
    throw new Error(`singleIdFrom: expected four lowercase hex characters, got ${JSON.stringify(hex4)}`);
  }
  return `single-${hex4}`;
}

// isValidSingleName(name) → true for a kebab-case name that cannot be mistaken for a run id of either
// kind: the dashboard and the index tell an unnamed run from a named one by exactly those shapes (§2.7).
export function isValidSingleName(name) {
  return isValidSlug(name) && !SINGLE_ID_RE.test(name);
}

// singleSessionName({ repo, run, step }) → '{repo} / {run} / single / builder|reviewer' (§2.6). `run` is
// the run id before the rename and the name after. No T{nn} segment, so no coordinator counts it.
export function singleSessionName({ repo, run, step }) {
  const role = ROLES[step];
  if (!role) throw new Error(`singleSessionName: step must be 'build' or 'review', got ${JSON.stringify(step)}`);
  return `${repo} / ${run} / single / ${role}`;
}

// The opening instructions of §2.6. The design's blocks are wrapped to the page, so a break inside a
// sentence is layout; the real breaks are the one before `The change…:` and the blank line before the
// prompt. The reports folder is named because a session cannot derive it: it moves at the rename. A
// setup note stands as its own paragraph between the starting point and the change.
export function builderInstruction({ reportsDir, base, baseSha, prompt, setupNote = null }) {
  return (
    'Load the pir-single skill and run it as the builder. You are run by `pir single`. ' +
    `Reports folder: ${reportsDir}. Starting point: ${base} at ${baseSha}.` +
    (setupNote ? `\n\n${setupNote}\n\n` : '\n') +
    `The change:\n\n${prompt}`
  );
}

export function reviewerInstruction({ reportsDir, name, base, baseSha, prompt }) {
  return (
    `Load the pir-single skill and run it as the reviewer of pir/${name}. You are run by \`pir single\`. ` +
    `Reports folder: ${reportsDir}. Starting point: ${base} at ${baseSha}.\n` +
    `The change that was asked for:\n\n${prompt}`
  );
}

// The report header of §2.7. Only the header form counts, and only on the first line: a session has
// no reason to write `kind=` in prose, so a body without the header is null rather than a guess.
const REPORT_HEADER = /^\[pir:v1 kind=(built|reviewed|dropped) single=(\S+)\]$/;

// parseSingleReport(text) → { kind, name, body } | null. `single=-` reads as name null and is allowed
// only for `dropped`: a `built` or `reviewed` claim with no name names nothing to check.
export function parseSingleReport(text) {
  if (typeof text !== 'string') return null;
  const nl = text.indexOf('\n');
  const head = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '').trim();
  const m = head.match(REPORT_HEADER);
  if (!m) return null;
  const kind = m[1];
  const name = m[2] === '-' ? null : m[2];
  if (name === null && kind !== 'dropped') return null;
  return { kind, name, body: nl === -1 ? '' : text.slice(nl + 1).trim() };
}

const sha7 = (sha) => String(sha ?? '').slice(0, 7);

// redMessage(...) → the message a session gets after a red test run (§2.5). `baseline` is the stored
// baseline result { ok, half, reason }: green, red in its test half, or not testable at all (its setup
// failed or its worktree could not be made). Past RED_LIMIT the last line tells the session to stop and
// ask the person. An empty tail drops its line rather than leaving a blank one.
export function redMessage({ sha, reason, round, logPath, tail, baseline, base, baseSha }) {
  const start = `(${base} ${sha7(baseSha)})`;
  let baselineLine;
  if (baseline?.ok) {
    baselineLine = `They pass on the untouched starting point ${start}, so this change broke them.`;
  } else if (baseline?.half === 'test') {
    baselineLine = `They also fail on the untouched starting point ${start}, so the failure may be older than this change.`;
  } else {
    baselineLine = `The untouched starting point could not be tested: ${baseline?.reason ?? 'no result'}.`;
  }
  const lines = [
    `pir ran the tests on your commit ${sha7(sha)} and they failed: ${reason}. Round ${round} of ${RED_LIMIT}.`,
    baselineLine,
    `Log: ${logPath}`,
  ];
  const last = String(tail ?? '').replace(/\n+$/, '');
  if (last.trim()) lines.push(last);
  lines.push(
    round > RED_LIMIT
      ? `This is round ${round}, past the limit of ${RED_LIMIT}: stop, tell the person what fails and what you ` +
          'tried, and ask how to go on. Report again only after they answer.'
      : 'Fix it, commit, and report again.',
  );
  return lines.join('\n');
}

// leftoverMessage({ sha, dirty }) → the message a session gets when the tests passed on its commit but
// the worktree is not clean afterwards (§2.4 step 3). `dirty` is the `git status --porcelain` listing;
// an empty one drops its lines.
export function leftoverMessage({ sha, dirty }) {
  const lines = [`pir ran the tests on your commit ${sha7(sha)} and they passed, but the worktree is not clean afterwards:`];
  const listing = String(dirty ?? '').replace(/\n+$/, '');
  if (listing.trim()) lines.push(listing);
  lines.push(
    'If these are your edits, commit them. If the tests made them, make git ignore them (.gitignore) and ' +
      'commit that. Then report again.',
  );
  return lines.join('\n');
}

// initialSingleState({ id, prompt, base, baseSha, commands }) → the state.json of a fresh run (§3.5).
// The prompt is not stored: `prompt.md` beside the state holds it. Beyond the §3.5 fields the state
// carries two the decision must remember between calls:
//   pending  { kind, name } of a report whose checks the shell has been asked to run
//   red      the red test run whose message waits for the baseline (§2.5)
// The §3.5 fields the decision owns:
//   step      'setup' | 'build' | 'rename' | 'review'
//   live      a session for the current step is open in this program
//   accepted  { kind, name, head } of a report whose checks passed (`head` is the branch head then), or
//             { kind: 'dropped', name, body } — kept after the finish so the screen can quote the body
//   rejected  the key of the last failed report, so the same failure is sent once
//   tested    { head, ok } of the last test run; ok is null while it runs
//   running   the command run in flight: 'setup' | 'tests' | 'baseline' | null
export function initialSingleState({ id, base, baseSha, commands }) {
  if (!SINGLE_ID_RE.test(String(id))) {
    throw new Error(`initialSingleState: expected an id of the form single-{hex4}, got ${JSON.stringify(id)}`);
  }
  return {
    version: 1,
    id,
    name: null,
    step: 'setup',
    sessions: { build: [], review: [] },
    commands: { setup: [...(commands?.setup ?? [])], test: [...(commands?.test ?? [])] },
    base,
    baseSha,
    rounds: { build: 0, review: 0 },
    tested: null,
    baseline: null,
    outcome: null,
    renamed: { branch: false, worktree: false, control: false, index: false },
    live: false,
    accepted: null,
    rejected: null,
    running: null,
    pending: null,
    red: null,
  };
}

function clone(state) {
  return {
    ...state,
    sessions: { build: [...(state.sessions?.build ?? [])], review: [...(state.sessions?.review ?? [])] },
    commands: { setup: [...(state.commands?.setup ?? [])], test: [...(state.commands?.test ?? [])] },
    rounds: { build: 0, review: 0, ...(state.rounds ?? {}) },
    renamed: { branch: false, worktree: false, control: false, index: false, ...(state.renamed ?? {}) },
    tested: state.tested ? { ...state.tested } : null,
    baseline: state.baseline ? { ...state.baseline } : null,
    accepted: state.accepted ? { ...state.accepted } : null,
    pending: state.pending ? { ...state.pending } : null,
    red: state.red ? { ...state.red } : null,
    outcome: state.outcome ?? null,
    live: state.live ?? false,
    rejected: state.rejected ?? null,
    running: state.running ?? null,
  };
}

// The message a session gets when its report failed its checks (§2.7). The shell's failures each name
// what failed and what to do; this only says which report they answer.
function rejectionText(report, failures) {
  const lines = failures.length ? failures : ['a check failed'];
  const head = `pir did not accept your \`${report.kind}\` report for pir/${report.name}:`;
  return lines.length === 1 ? `${head} ${lines[0]}` : `${head}\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

// decideSingleStep(state, facts) → { state, actions }. `state` is not mutated.
//
// facts = {
//   resume:      true on the first call of a `--resume` start (§2.11)
//   reports:     parsed reports (parseSingleReport) drained since the last call
//   checks:      { ok, failures: [text] } — singleChecks' answer to the last `check` action, or null
//   head:        the branch head the shell read when it ran those checks (required with a passed check)
//   idle:        the live session has ended its turn with nothing pending of its own
//   live:        false when the shell holds no session
//   exited:      the live session's process has exited
//   sessionId:   the id of the live session, once the shell knows it (recorded in state.sessions[step])
//   commandDone: { kind: 'setup'|'tests'|'baseline', ok, half, reason, logPath, tail, head, clean, dirty }
//                for a command run that finished; head, clean and dirty (the `git status --porcelain`
//                listing) are the worktree's at the end of a test run
//   renamed:     { branch, worktree, control, index } — the rename sub-steps already done on disk
// }
//
// A step's session is closed only once it is idle (or gone): that is the idle gate, and it is what stops
// a final commit being cut off. While tests run the session stays open, because a red run goes back to it.
export function decideSingleStep(state, facts = {}) {
  const s = clone(state);
  const actions = [];
  // A finished run is final: neither `ready` nor `dropped` is resumable (§2.11).
  if (s.outcome !== null) return { state: s, actions };

  const onDisk = { branch: false, worktree: false, control: false, index: false, ...(facts.renamed ?? {}) };
  const done = facts.commandDone ?? null;

  // Open a session for `step`: its last one by id when there is one to reopen, else a fresh spawn.
  const open = (step, { reopen = false, note = null } = {}) => {
    const last = s.sessions[step].at(-1);
    if (reopen && last) actions.push({ type: 'resumeSession', step, sessionId: last });
    else actions.push(note ? { type: 'spawn', step, note } : { type: 'spawn', step });
    s.live = true;
  };

  // A message to the step's session. The session may be gone while pir's tests ran (a resume restarts
  // the tests without one, §2.11), so it is reopened first.
  const say = (text) => {
    if (!s.live) open(s.step, { reopen: true });
    actions.push({ type: 'send', text });
  };

  const renameRemaining = () => {
    for (const substep of RENAME_SUBSTEPS) {
      if (!onDisk[substep]) actions.push({ type: 'rename', substep });
    }
    s.renamed = { branch: true, worktree: true, control: true, index: true };
  };

  const finish = (outcome) => {
    s.outcome = outcome;
    s.live = false;
    s.running = null;
    s.pending = null;
    s.rejected = null;
    s.red = null;
    if (outcome !== 'dropped') s.accepted = null;
    actions.push({ type: 'finish', outcome });
  };

  const startTests = (head) => {
    s.running = 'tests';
    s.tested = { head, ok: null };
    actions.push({ type: 'runTests', head });
  };

  if (facts.resume) {
    // Whatever this program held before it stopped is gone: the session, the command it was running,
    // and any report it was waiting on checks for.
    s.live = false;
    s.pending = null;
    s.rejected = null;
    if (s.running === 'tests') {
      // The child died with the program. Forget the run; the accepted report below starts it again.
      s.running = null;
      s.tested = null;
    } else if (s.running === 'baseline' && !s.red) {
      s.running = null;
    } else if (s.running === 'setup') {
      s.running = null;
    }
    // The state may say `review` before every rename sub-step reached the disk. The reviewer must not
    // be reopened in a worktree that is still moving, so the rename is finished first.
    if (s.step === 'review' && RENAME_SUBSTEPS.some((k) => !onDisk[k])) renameRemaining();
  }

  // --- setup (§2.4 step 1) ----------------------------------------------------------------------
  if (s.step === 'setup') {
    if (s.commands.setup.length === 0) {
      s.step = 'build';
      open('build');
    } else if (s.running === 'setup' && done?.kind === 'setup') {
      // A failed setup does not stop the run: the builder starts anyway and is told.
      s.running = null;
      s.step = 'build';
      const note = done.ok ? null : { reason: done.reason, tail: done.tail ?? '', logPath: done.logPath };
      open('build', { note });
    } else if (s.running !== 'setup') {
      s.running = 'setup';
      actions.push({ type: 'runSetup' });
    }
    return { state: s, actions };
  }

  // --- rename (§2.4 step 4) ---------------------------------------------------------------------
  // Only a state saved mid-transition reads `rename`; the sub-steps left are done, then the reviewer.
  if (s.step === 'rename') {
    renameRemaining();
    s.step = 'review';
    open('review');
    return { state: s, actions };
  }

  // --- build and review -------------------------------------------------------------------------
  const step = s.step;
  const wasLive = s.live;

  if (facts.sessionId && s.live && s.sessions[step].at(-1) !== facts.sessionId) {
    s.sessions[step].push(facts.sessionId);
  }

  const gone = wasLive && (facts.exited === true || facts.live === false);
  if (gone) s.live = false;

  const dropping = () => s.accepted?.kind === 'dropped';

  // The report this step acts on: a `dropped` if one was drained, else the last of the step's kinds.
  // A drop ends the run, so it outranks a `built` or `reviewed` drained with it whatever their order,
  // and it is taken before the command result below: a red that lands in the same call must not count
  // a round, start the baseline or reopen a session only to tell it of tests nobody will fix.
  const relevant = (facts.reports ?? []).filter((r) => r && STEP_KINDS[step].includes(r.kind));
  const report = relevant.findLast((r) => r.kind === 'dropped') ?? relevant.at(-1);
  if (report?.kind === 'dropped') {
    s.accepted = { kind: 'dropped', name: report.name ?? null, body: report.body ?? '' };
    s.pending = null;
  }

  // A finished command run. One that is not the run in flight is stale and ignored.
  if (done && done.kind === s.running) {
    if (done.kind === 'tests') {
      const head = s.tested?.head ?? null;
      s.running = null;
      if (dropping()) {
        s.tested = null;
      } else if (s.accepted && s.accepted.head !== head) {
        // A newer report passed its checks while this ran: the result is about a commit the session
        // has moved past, so it counts for nothing and the tests run on the new head.
        s.tested = null;
      } else if (done.ok) {
        if (done.head === head && done.clean) {
          s.tested = { head, ok: true };
        } else if (done.head !== head) {
          // Green, but the session went on committing: the result is not about what is there now.
          s.tested = null;
          if (s.accepted) s.accepted = { ...s.accepted, head: done.head };
        } else {
          // Green on this commit, but the tree is dirty: the session edited without committing, or the
          // tests left files git does not ignore. A rerun would end the same way for ever, so the session
          // is told and the step waits for a new report (user, 2026-09-30).
          s.tested = null;
          s.accepted = null;
          say(leftoverMessage({ sha: head, dirty: done.dirty ?? '' }));
        }
      } else {
        s.rounds[step] += 1;
        s.tested = { head, ok: false };
        s.accepted = null;
        const red = { sha: head, reason: done.reason, logPath: done.logPath, tail: done.tail ?? '', round: s.rounds[step] };
        if (s.baseline === null) {
          // The first red of the run: the message waits for the baseline (§2.5).
          s.red = red;
          s.running = 'baseline';
          actions.push({ type: 'runBaseline' });
        } else {
          say(redMessage({ ...red, baseline: s.baseline, base: s.base, baseSha: s.baseSha }));
        }
      }
    } else if (done.kind === 'baseline') {
      s.running = null;
      s.baseline = { ok: done.ok === true, half: done.half ?? null, reason: done.reason ?? null, logPath: done.logPath ?? null };
      if (s.red && !dropping()) {
        say(redMessage({ ...s.red, baseline: s.baseline, base: s.base, baseSha: s.baseSha }));
      }
      s.red = null;
    }
  } else if (facts.resume && s.running === 'baseline') {
    actions.push({ type: 'runBaseline' });
  }

  if (report) {
    if (!dropping()) {
      s.pending = { kind: report.kind, name: report.name };
      actions.push({ type: 'check', kind: report.kind, name: report.name });
    }
  } else if (facts.checks && s.pending) {
    const claim = s.pending;
    s.pending = null;
    if (facts.checks.ok) {
      if (typeof facts.head !== 'string' || facts.head === '') {
        throw new Error(`decideSingleStep: a passed '${claim.kind}' check needs facts.head (§2.4 step 3)`);
      }
      s.accepted = { kind: claim.kind, name: claim.name, head: facts.head };
      s.rejected = null;
    } else {
      // A failed report supersedes an earlier accepted one: the session has changed something since,
      // and closing on that earlier claim would act on one it has withdrawn.
      s.accepted = null;
      const failures = facts.checks.failures ?? [];
      // The same report failing the same way is sent once; a different failure is a new message.
      const key = `${claim.kind} ${claim.name} ${failures.join('\n')}`;
      if (s.rejected !== key) {
        say(rejectionText(claim, failures));
        s.rejected = key;
      }
    }
  }

  // The session can be closed when it is idle, or when there is none to close.
  const canClose = !s.live || facts.idle === true;
  const closeLive = () => {
    if (s.live) actions.push({ type: 'closeWhenIdle' });
    s.live = false;
  };

  if (dropping()) {
    if (canClose) {
      closeLive();
      finish('dropped');
    }
    return { state: s, actions };
  }

  if (s.accepted && !s.pending && !s.running) {
    // The same commit already tested green with a clean tree needs no second run (§2.4 step 5): the
    // passed check vouches for the clean tree, the recorded head for the commit.
    if (s.tested?.ok === true && s.tested.head === s.accepted.head) {
      if (canClose) {
        closeLive();
        if (step === 'build') {
          s.name = s.accepted.name;
          s.accepted = null;
          s.rejected = null;
          renameRemaining();
          s.step = 'review';
          open('review');
        } else {
          finish('ready');
        }
      }
      return { state: s, actions };
    }
    startTests(s.accepted.head);
    return { state: s, actions };
  }

  // Nothing is in hand and only the session can move the step on.
  if (!s.live && !s.accepted && !s.pending && !s.running) {
    // It exited without a report this step can act on: exit with no final status, so the run shows
    // crashed and can be resumed (§2.7). Otherwise pir let it go itself (a resume), so it is reopened.
    if (gone) actions.push({ type: 'exitCrashed' });
    else open(step, { reopen: true });
  }
  return { state: s, actions };
}

// singleProgress(runState) → the dashboard's PROGRESS cell (§2.8). `runState` is the snapshot's
// { step, phase: 'working'|'testing', outcome, rounds }. A red round shows after the step's `tests`.
export function singleProgress(runState) {
  const { step, phase, outcome, rounds } = runState ?? {};
  const inReview = step === 'review' || step === 'rename';
  if (outcome === 'ready') return 'build ✓ review ✓';
  if (outcome === 'dropped') return inReview ? 'build ✓ review ✗' : 'build ✗';
  const n = rounds?.[inReview ? 'review' : 'build'] ?? 0;
  const tail = phase === 'testing' ? ` · tests${n > 0 ? ` (red ${n})` : ''} …` : ' …';
  return `${inReview ? 'build ✓ review' : 'build'}${tail}`;
}
