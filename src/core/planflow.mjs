// planflow — the pure rulebook of a planning run (pir-plan-command DESIGN §2.3–§2.7, §2.14, §3.3, §3.5).
//
// A planning run hosts two Claude sessions one after the other — the planner, then a fresh reviewer —
// on a temporary branch that is renamed to the plan's slug in between. This module decides every step
// of that from the saved state (`state.json`) and what the shell just observed, and returns the effects
// as a list of actions for the shell (src/shell/plan-run.mjs) to execute in order. It reads no clock, no
// file and no process (boundary.test.mjs), so every transition and every crash point is a
// millisecond test.
//
// The action vocabulary (DESIGN §3.3):
//   { type: 'spawn', step }                    start a fresh session for `step` ('plan' | 'review'); the
//                                              shell sends it its opening instruction (plannerInstruction /
//                                              reviewerInstruction), which needs the brief and the reports
//                                              folder only the shell holds.
//   { type: 'spawn', step, resumeSessionId }   resume that session instead (SDK `resume`); no opening
//                                              instruction. Always followed by a `send` of resumeInstruction().
//   { type: 'send', text }                     a user message to the live session.
//   { type: 'close' }                          close the live session.
//   { type: 'rename', substep }                one rename sub-step of §2.6, in order.
//   { type: 'finish', outcome }                the run ends: 'no-plan' | 'reviewed' | 'not-reviewed'.
//   { type: 'exitCrashed' }                    exit with no final status, so the run shows crashed (§2.5).

// The run id of a planning run before it has a slug: `plan-` and four hex characters (§2.2).
export const RUN_ID_RE = /^plan-[0-9a-f]{4}$/;

// Kebab-case, the rule §2.5 checks a proposed slug against.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The rename sub-steps of §2.6, in the order they must run.
export const RENAME_SUBSTEPS = ['branch', 'worktree', 'control', 'index'];

// The report kinds each step acts on (§2.4). A kind belonging to the other step is ignored, never
// guessed into a transition: a `reviewed` during planning is a confused session, not a finished review.
const STEP_KINDS = {
  plan: ['planned', 'no-plan'],
  review: ['reviewed', 'not-reviewed'],
};

// isValidSlug(slug) → true for a kebab-case name that cannot be mistaken for a run id. A slug of the
// form plan-{hex4} is refused because the dashboard and the index tell a pre-rename run from a named
// plan by exactly that shape (§2.2, §2.5).
export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug) && !RUN_ID_RE.test(slug);
}

// runIdFrom(hex4) → 'plan-' + hex4. The four hex characters come from the shell (the core draws no
// random number); anything else is a caller bug and throws.
export function runIdFrom(hex4) {
  if (typeof hex4 !== 'string' || !/^[0-9a-f]{4}$/.test(hex4)) {
    throw new Error(`runIdFrom: expected four lowercase hex characters, got ${JSON.stringify(hex4)}`);
  }
  return `plan-${hex4}`;
}

// planSessionName({ repo, plan, step }) → '{repo} / {plan} / plan / planner|reviewer' (§2.3). `plan` is
// the run id before the rename and the slug after it. The name has no T{nn} segment, so it fails
// parseAgentName on purpose: no coordinator will ever count or close a planning session.
export function planSessionName({ repo, plan, step }) {
  const role = { plan: 'planner', review: 'reviewer' }[step];
  if (!role) throw new Error(`planSessionName: step must be 'plan' or 'review', got ${JSON.stringify(step)}`);
  return `${repo} / ${plan} / plan / ${role}`;
}

// The opening instructions, exactly as DESIGN §2.3 gives them. The reports folder is named in the
// message because a planning session cannot derive it: it moves at the rename (§2.6). The design's
// block is laid out in a labelled column, so its line wraps inside a sentence are layout, not text;
// the real line breaks are the ones before `Brief:` and the blank line before the brief.
export function plannerInstruction({ reportsDir, brief }) {
  return (
    `Load the pir-plan skill and run it. You are run by \`pir plan\`: follow its "Run by pir plan" section. ` +
    `Reports folder: ${reportsDir}\nBrief:\n\n${brief}`
  );
}

export function reviewerInstruction({ reportsDir, slug }) {
  return (
    `Load the pir-review-plan skill and run it on plan ${slug}. You are run by \`pir plan\`: follow its ` +
    `"Run by pir plan" section. Reports folder: ${reportsDir}`
  );
}

// The one message a resumed session is sent (§2.14). A resumed session takes no turn until spoken to,
// misremembers a killed command as never started, and has lost any question it had open (measured by
// plans/resume-dead-worker), so this tells it all three. The words are the design's block; its line
// wraps are layout, as in the opening instructions above, so it is one paragraph: kept verbatim it showed
// mid-sentence breaks in the person's conversation view (user, T14 drill, 2026-09-26).
export function resumeInstruction() {
  return (
    'You were stopped and have been resumed in the same worktree. Whatever you were doing when you stopped ' +
    'may not have finished: check `git status` and the plan files, tell the person where things stand, and ' +
    'carry on. Any question you had open was lost, so ask it again.'
  );
}

// The report header of §2.4. Only the header form counts: a planning session has no reason to write
// `kind=` in prose, so unlike the worker parser there is no prose fallback, and a body without the
// header is null rather than a guess.
const REPORT_HEADER = /^\[pir:v1 kind=(planned|no-plan|reviewed|not-reviewed) plan=(\S+)\]$/;

// parsePlanReport(text) → { kind, plan } | null. `plan=-` reads as plan null. A `planned`, `reviewed`
// or `not-reviewed` claim with no plan names nothing to check, so it is null too.
export function parsePlanReport(text) {
  if (typeof text !== 'string') return null;
  const nl = text.indexOf('\n');
  const head = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '').trim();
  const m = head.match(REPORT_HEADER);
  if (!m) return null;
  const kind = m[1];
  const plan = m[2] === '-' ? null : m[2];
  if (plan === null && kind !== 'no-plan') return null;
  return { kind, plan };
}

// initialPlanState({ id }) → the state.json of a fresh run (§3.5). Beyond the §3.5 fields it carries
// three the decision needs to remember between calls, because the shell hands each report over once:
//   live      a session for the current step is open in this program (false after a close or a crash)
//   accepted  { kind, plan } of a report whose checks passed, waiting for the session to go idle
//   rejected  the key of the last failed report, so the same failure is sent to the session once
export function initialPlanState({ id }) {
  return {
    version: 1,
    id,
    slug: null,
    step: 'plan',
    sessions: { plan: [], review: [] },
    outcome: null,
    renamed: { branch: false, worktree: false, control: false, index: false },
    live: false,
    accepted: null,
    rejected: null,
  };
}

// The message a session gets when its report failed a check (§2.5, §2.7). The shell's reason names the
// failed check and what to do about it, ending with the report to drop again; this only says which report
// it answers. A closing line of its own repeated the reason's last sentence on the person's screen (T14).
function rejectionText(report, reason) {
  return `pir did not accept your \`${report.kind}\` report for plan ${report.plan}: ${reason}`;
}

function clone(state) {
  return {
    ...state,
    sessions: { plan: [...(state.sessions?.plan ?? [])], review: [...(state.sessions?.review ?? [])] },
    renamed: { branch: false, worktree: false, control: false, index: false, ...(state.renamed ?? {}) },
    live: state.live ?? false,
    accepted: state.accepted ?? null,
    rejected: state.rejected ?? null,
  };
}

// decidePlanStep(state, facts) → { state, actions }. `state` is not mutated.
//
// facts = {
//   resume:    true on the first call of a `--resume` start (§2.14)
//   reports:   parsed reports (parsePlanReport) drained since the last call
//   activity:  the live session's activity: 'starting'|'busy'|'idle'|'permission'|'questions'|'command'|'exited'|'none'
//   checks:    { ok, reason } — the §2.5/§2.7 git checks the shell ran for the last actionable report, or null
//   renamed:   { branch, worktree, control, index } — the §2.6 sub-steps already done on disk
//   sessionId: the id of the live session, once the shell knows it (recorded in state.sessions[step])
// }
//
// A session is closed only when `idle` (or already `exited`): that is the coordinator's idle gate, and
// it is what stops a final commit being cut off. `permission`, `questions` and `command` (a command the
// session handed the person, bang-commands DESIGN §2.7) are the session asking the
// person, so they are not idle either.
export function decidePlanStep(state, facts = {}) {
  const s = clone(state);
  const actions = [];
  const renamedOnDisk = { branch: false, worktree: false, control: false, index: false, ...(facts.renamed ?? {}) };
  let spawnedNow = false;

  // Open a session for `step`: resume its last one when resuming and there is one, else a fresh spawn.
  const openSession = (step, resuming) => {
    const last = s.sessions[step].at(-1);
    if (resuming && last) {
      actions.push({ type: 'spawn', step, resumeSessionId: last });
      actions.push({ type: 'send', text: resumeInstruction() });
    } else {
      actions.push({ type: 'spawn', step });
    }
    s.live = true;
    spawnedNow = true;
  };

  // Every §2.6 sub-step not yet on disk, in order, then the reviewer's fresh session.
  const renameThenReview = () => {
    for (const substep of RENAME_SUBSTEPS) {
      if (!renamedOnDisk[substep]) actions.push({ type: 'rename', substep });
    }
    s.renamed = { branch: true, worktree: true, control: true, index: true };
    s.step = 'review';
    openSession('review', false);
  };

  const finish = (outcome) => {
    s.step = 'done';
    s.outcome = outcome;
    s.live = false;
    s.accepted = null;
    s.rejected = null;
    actions.push({ type: 'finish', outcome });
  };

  const close = () => {
    actions.push({ type: 'close' });
    s.live = false;
    s.accepted = null;
    s.rejected = null;
  };

  // A finished run. Only a `not-reviewed` one is resumable (§2.14): the person usually stopped to think,
  // so the reviewer's own conversation is reopened. `reviewed` and `no-plan` are final.
  if (s.step === 'done') {
    if (!(facts.resume && s.outcome === 'not-reviewed')) return { state: s, actions };
    s.step = 'review';
    s.outcome = null;
    s.live = false;
    openSession('review', true);
  } else if (facts.resume) {
    // Whatever this program held before it stopped is gone: the session, and any report it was
    // waiting to act on. The resumed session is told to check where things stand and report again.
    s.live = false;
    s.accepted = null;
    s.rejected = null;
    if (s.step === 'rename') {
      renameThenReview();
    } else if (s.step === 'review' && RENAME_SUBSTEPS.some((k) => !renamedOnDisk[k])) {
      // The state may have been written as `review` before every rename sub-step reached the disk.
      // The reviewer must not start in a worktree that is still moving, so finish the rename first.
      for (const substep of RENAME_SUBSTEPS) {
        if (!renamedOnDisk[substep]) actions.push({ type: 'rename', substep });
      }
      openSession('review', true);
    } else {
      openSession(s.step, true);
    }
  } else if (s.step === 'rename') {
    renameThenReview();
  } else if (!s.live) {
    openSession(s.step, false);
  }

  // The shell learns a fresh session's id after the spawn; a resumed session keeps its id, so it is
  // recorded once.
  if (facts.sessionId && (s.step === 'plan' || s.step === 'review') && s.live) {
    if (s.sessions[s.step].at(-1) !== facts.sessionId) s.sessions[s.step].push(facts.sessionId);
  }

  if (s.step !== 'plan' && s.step !== 'review') return { state: s, actions };
  const step = s.step;

  // The last report this step acts on. During review a report naming another plan is ignored: it is
  // not a claim about the branch this run holds.
  const relevant = (facts.reports ?? []).filter(
    (r) => r && STEP_KINDS[step].includes(r.kind) && (step !== 'review' || r.plan === s.slug),
  );
  const report = relevant.at(-1);

  if (report) {
    if (report.kind === 'no-plan' || report.kind === 'not-reviewed') {
      close();
      finish(report.kind);
      return { state: s, actions };
    }
    if (!facts.checks) {
      throw new Error(`decidePlanStep: a '${report.kind}' report needs facts.checks (§2.5, §2.7)`);
    }
    if (facts.checks.ok) {
      s.accepted = { kind: report.kind, plan: report.plan };
      s.rejected = null;
    } else {
      // A failed report supersedes an earlier accepted one: the session has changed the plan since
      // (a new name, a new commit), and closing on idle would rename to a claim it has withdrawn.
      s.accepted = null;
      // The same report failing the same way is sent once: a re-delivered report must not repeat the
      // message, and a session that tried again and failed differently hears the new reason.
      const key = `${report.kind} ${report.plan} ${facts.checks.reason ?? ''}`;
      if (s.rejected !== key) {
        actions.push({ type: 'send', text: rejectionText(report, facts.checks.reason ?? 'a check failed') });
        s.rejected = key;
      }
    }
  }

  // Activity is about the session that was live before this call; a session spawned just now has none.
  if (spawnedNow) return { state: s, actions };

  const activity = facts.activity ?? 'none';
  if (s.accepted && (activity === 'idle' || activity === 'exited')) {
    const accepted = s.accepted;
    close();
    if (step === 'plan') {
      s.slug = accepted.plan;
      s.step = 'rename';
      renameThenReview();
    } else {
      finish('reviewed');
    }
    return { state: s, actions };
  }

  // A session that exited without a report this step can act on leaves no way forward: exit without a
  // final status so the run shows crashed and can be resumed (§2.5).
  if (activity === 'exited') {
    s.live = false;
    actions.push({ type: 'exitCrashed' });
  }
  return { state: s, actions };
}
