// The live-display model (DESIGN §2.3, §3.1, §3.3). Pure: it turns the run state a pass produces —
// the tasks, the phase each worker is in, the counts and the ceiling — into the rows, summary and
// footer the terminal renderer paints (src/shell/render.mjs). It holds no clock and no I/O: the
// current time and the spinner frame arrive as arguments, so the whole status vocabulary and the
// counts are checkable in milliseconds without a terminal (DESIGN §2.3's reason for the split).
//
// The shape it produces was confirmed with the person against prototype/cli-display.html (2026-09-19):
// one row per task styled after `docker compose up`, a summary line, a ceiling pill, an asking-you
// footer, and the git-merge hand-off. The renderer owns the glyph characters and the in-place painting;
// this model carries only `kind` (a rule a person can check) and the data each row needs.

// A task is done once its row on the feature branch is ✅ (DESIGN §2.4: the run folds a merged task
// to ✅ there). The model is handed `done` as a boolean, so this glyph never leaks into the pure side;
// it is only the documented meaning of that boolean.
const DONE_GLYPH = '✅';

// The phases a live worker can be in, in display terms (the shell maps the loop's own phase names onto
// these before handing them in). Each is one row `kind`; `asking` is the parked-on-the-person state
// (DESIGN §2.2, §2.5 — a hands-on check is a worker asking you, not a separate state). These are the
// "active" kinds: a task in any of them holds a slot under the ceiling. `preparing` is the plan's setup
// lines running in a fresh task worktree before its implementer is spawned (DESIGN §2.4): it holds the
// slot it is about to use, and shows as active so an `npm ci` does not read as a stalled screen.
const ACTIVE_PHASES = new Set(['preparing', 'building', 'reviewing', 'merging', 'asking']);

// The human label per active phase. `asking` reads "asking you" because the person is the one being
// asked (§2.2). The other kinds read as their phase.
const PHASE_LABEL = {
  preparing: 'preparing',
  building: 'building',
  reviewing: 'reviewing',
  merging: 'merging',
  asking: 'asking you',
};

// An end-of-run helper's row (pir-coordinator T11) in the active phases the loop gives it: its worker is
// `building` until it reports done, then `merging` while it is closed. Neither word fits a merge of main or
// a test fix.
const HELPER_LABEL = { building: 'working', merging: 'finishing' };

// A coordinator-side merge conflict is sent to the task's live worker (`conflictSent`, live-workers
// §2.10): that task is being fixed and asks nothing of the person. There is no unsent state to show — with
// no live worker the task is marked ⛔ and dropped (loop.mjs 3d) — so the old paste-in `conflict` row and
// footer are gone (2026-09-26).
function isFixingConflict(t) {
  return t.phase === 'asking' && !!t.conflictSent && !isRequest(t);
}

// What kind of answer an asking task wants (live-workers DESIGN §2.4). A live worker's pending permission
// request or question set rides in `t.asking` beside whatever phase the loop has it in, and wins over a
// report: the request says what the person must do now. A question/decision/conflict report alone is
// `question`, and so is an `asking` row from a snapshot written before this field existed.
const ASKING_LABEL = {
  question: 'asking you · a question',
  questions: 'asking you · a question',
  permission: 'asking you · allow a command?',
  command: 'asking you · run a command', // a command an agent handed the person (bang-commands DESIGN §2.7)
};
function isRequest(t) {
  return t.asking === 'permission' || t.asking === 'questions' || t.asking === 'command';
}
function askingKind(t) {
  if (isRequest(t)) return t.asking;
  if (t.phase === 'asking' && !isFixingConflict(t)) return 'question';
  return null;
}

// The coordinator agent holds a waiting item from its brief until it answers or passes it on
// (pir-coordinator DESIGN §2.5): the row then reads `asking coordinator` and asks nothing of the person.
// `holder` is buildRunState's; a snapshot without it (no agent, or written before it) is the person's.
const COORDINATOR_LABEL = {
  question: 'asking coordinator · a question',
  questions: 'asking coordinator · a question',
  permission: 'asking coordinator · allow a command?',
  // Never held in practice (a handed command is reserved for the person, asking.mjs holderOf); named so a
  // row could not read `undefined`.
  command: 'asking coordinator · run a command',
};
const heldByCoordinator = (t) => t.holder === 'coordinator';
// The task waits on the person: something is asking and the coordinator agent does not hold it.
const asksPerson = (t) => !!askingKind(t) && !heldByCoordinator(t);

// askingCount(runState) → how many unfinished tasks wait on the person. The summary's `asking` tally and
// the runs list's `asking you` state (dashboard.mjs) both read this, so the list row and the live view
// never disagree on whether a run needs the person. A task the coordinator agent holds is not counted:
// the run must not turn amber for a question the person is not being asked (pir-coordinator §2.5).
// An end-of-run helper (main-sync, tests-fix) waiting on the person counts too: the run needs them, and
// the list must say so, though the helper is no task of the plan (pir-coordinator T11).
export function askingCount(runState) {
  return rowEntries(runState).filter((t) => !t.separator && !t.agent && !t.done && (t.finisher ? finisherAsks(t) : asksPerson(t))).length;
}

// rowEntries(runState) → every row the live view draws, in order: the plan's tasks, then — once the run's
// coordinator agent has started — a separator and the agent's pinned row (pir-coordinator T12), then the
// end-of-run helpers (T11). The watch view's ↑↓ walks the same list (dashboard.mjs openTasks), stepping
// over the separator; → on the agent's entry opens its `worker`, the conversation `c` opens.
// Once the finisher is the run's session (finisher DESIGN §2.11) its row takes the agent's pinned place;
// the agent is closed by then, and a snapshot carrying both still shows the finisher alone.
export function rowEntries(runState) {
  const f = runState?.finisher;
  const c = runState?.coordinator;
  const pinned = f ? finisherEntry(f) : c ? agentEntry(c) : null;
  const agent = pinned ? [{ id: SEPARATOR_ID, separator: true }, pinned] : [];
  return [...(runState?.tasks ?? []), ...agent, ...(runState?.helpers ?? [])];
}

// The separator's, the agent's and the finisher's entry ids. None can collide with a task (`T01`) or a
// helper's label.
export const SEPARATOR_ID = '──';
export const AGENT_ID = 'coordinator';
export const FINISHER_ID = 'finisher';

// The finisher's entry from runState.finisher (finisher-agent.mjs view()). `state` is its phase, or
// `restarting` / `given-up`; `request` is a request parked for the person (its view's `asking`), named
// apart from a task's `asking`, which says what kind of answer is wanted.
function finisherEntry(f) {
  const state = f.state ?? f.phase ?? 'preparing';
  const live = state !== 'restarting' && state !== 'given-up';
  return {
    id: FINISHER_ID,
    finisher: true,
    state,
    request: !!f.asking,
    worker: f.id ? { id: f.id, live, logPath: f.logPath ?? null } : null,
  };
}

// The finisher's words per state (finisher DESIGN §2.11), with whether it waits on the person. The go
// question is itself a parked request, so `awaiting-go` and `stuck` name the row whatever `request` says;
// a request reads `asking you` in the other phases (a reserved action after the go). No clock: its phases
// are the run's end, not work to time.
const FINISHER_WORDS = {
  preparing: 'preparing',
  'awaiting-go': 'waiting for your go',
  finishing: 'finishing',
  stuck: 'stuck · needs you',
  done: 'done',
  restarting: 'restarting',
  'given-up': 'given up',
};
function finisherLabel(t) {
  if (t.state === 'awaiting-go' || t.state === 'stuck') return { label: FINISHER_WORDS[t.state], asks: true };
  if (t.request && (t.state === 'preparing' || t.state === 'finishing')) return { label: 'asking you', asks: true };
  return { label: FINISHER_WORDS[t.state] ?? String(t.state), asks: false };
}
const finisherAsks = (t) => finisherLabel(t).asks;

// The finisher's row: amber (`finisher-asking`) while it waits on the person and counted in the asking
// tally; `finisher-done` once done; idle while down; else the active colour.
function finisherRow(t) {
  const { label, asks } = finisherLabel(t);
  const kind = asks ? 'finisher-asking' : t.state === 'done' ? 'finisher-done' : t.state === 'restarting' || t.state === 'given-up' ? 'finisher-idle' : 'finisher';
  return { id: t.id, slug: 'finisher', finisher: true, kind, label, elapsedMs: null };
}

// The footer while the finisher is on (finisher DESIGN §2.11; the other phases' lines decided by the user
// 2026-09-29, T07): one line per phase, each pointing at `c`.
const FINISHER_FOOTER = {
  preparing: 'preparing · c to watch',
  'awaiting-go': 'ready · c to review and say go',
  finishing: 'finishing · c to watch',
  stuck: 'stuck · c to review and say go',
  done: 'done',
  restarting: 'restarting',
  'given-up': 'given up',
};
function finisherFooter(f) {
  const t = finisherEntry(f);
  const { asks } = finisherLabel(t);
  const asking = asks && t.state !== 'awaiting-go' && t.state !== 'stuck';
  const text = asking ? 'asking you · c to answer' : FINISHER_FOOTER[t.state] ?? String(t.state);
  return { kind: 'finisher', state: t.state, asks, text: `◆ finisher ${text}` };
}

// The agent's entry from runState.coordinator. A snapshot written before T12 has no `state`: its `live`
// says up or restarting.
function agentEntry(c) {
  return {
    id: AGENT_ID,
    agent: true,
    state: c.state ?? (c.live ? 'up' : 'restarting'),
    holding: Number.isInteger(c.holding) ? c.holding : 0,
    worker: c.id ? { id: c.id, live: !!c.live, logPath: c.logPath ?? null } : null,
  };
}

// The agent's row (pir-coordinator T12): what it is doing and how many waiting items it holds. No clock.
// It is not a task: the summary, the asking tally and the footer never read it, and it never turns amber.
function agentRow(t) {
  const base = { id: t.id, slug: 'coordinator agent', agent: true, elapsedMs: null };
  if (t.state === 'given-up') return { ...base, kind: 'agent-given-up', label: 'given up · questions come to you' };
  if (t.state === 'restarting') return { ...base, kind: 'agent', label: 'restarting' };
  const n = t.holding ?? 0;
  return { ...base, kind: 'agent', label: n > 0 ? `holding ${n} question${n === 1 ? '' : 's'}` : 'on duty' };
}

// buildDisplay(runState, { now, spinnerFrame }) → { summary, rows, footer } (DESIGN §2.3).
//
// runState (a pass's output, assembled by the shell):
//   { branch, ceiling, complete?, readyToMerge?, testsReason?, testing?, interrupted?, tasks: [task…] }
//   testsReason: { reason, logPath } from the red end gate, or null (green, unfinished, an old snapshot).
//   handoff: null | { state:'preparing'|'ready'|'red', reportPath, baseSha, base, hold, lastWatch,
//            lastWatchFailure } — the end of a run with the coordinator agent (pir-coordinator §2.9, §2.10);
//            null with the agent off, where the footer is today's hand-off or red line. `hold` is null or
//            { reason, text, since, nextTry }: the base could not be prepared (base-branch DESIGN §2.8), and
//            the preparing footer carries it so the live view shows why.
//   base:    the run's base branch (base-branch DESIGN §2.9), carried on the hand-off and interrupted
//            footers for the merge line; absent in an old snapshot, where the renderer reads `main`.
//   coordinator: null | { id, live, logPath, state?, holding? } — the run's agent (pir-coordinator T12):
//            once set, the rows gain a separator (kind `separator`) and the agent's pinned row (kind `agent`,
//            or `agent-given-up`), after the tasks and before the helpers. state: 'up'|'restarting'|'given-up';
//            holding: the waiting items it holds. Neither row is counted in the summary or the asking tally.
//   finisher: absent | { id, logPath, state, phase, goGiven, summary, steps, rulesSource, asking } — the
//            finisher's view() once it replaces the agent (finisher DESIGN §2.11): its pinned row (kinds
//            `finisher`, `finisher-asking`, `finisher-done`, `finisher-idle`) takes the agent's place, and it
//            owns the footer (kind `finisher`) unless a task asks. Waiting for the go, stuck, or holding a
//            request, it counts in the asking tally; never in done/total/running/waiting.
//   helpers: absent | [task…] — the end-of-run helper workers (main-sync, tests-fix) while they run, each
//            shaped like a task with `helper: true` (pir-coordinator T11). Each is a row below the tasks,
//            reading `working` or asking like a task's; the summary's done/total/running/waiting count the
//            plan's tasks only, and the asking tally and the asking footer take a helper too.
//   testing: { since:ms } while the end gate runs the plan's setup and test lines on the finished feature
//            branch, else null. Every task is merged by then, so without it the screen reads as done for
//            the minutes the suite takes (user 2026-09-25).
//   task: { id, slug, deps:[id…], done:bool, phase:null|'preparing'|'building'|'reviewing'|'merging'|'asking',
//           since:ms|null, stoppedAt:ms|null, doneMs:ms|null, question:string|null, conflictSent?:bool }
//     phase   — set when a live worker holds the task; null when no worker does.
//     since   — when the current phase began, for the elapsed clock (now − since).
//     stoppedAt— when an `asking` task began waiting on the person, or null. The clock stops there
//               (stoppedAt − since) so time spent waiting on the person does not count as work
//               (user 2026-09-26). Carried in the state, not derived from `now`, so a detached `pir`
//               viewer freezes at the same value the coordinator does.
//     doneMs  — the final duration to show on a ✅ row, or null if the run never timed it.
//     question— the parked worker's rendered question, shown on the asking row's footer.
//     conflictSent — a merge-conflict fix went to the task's live worker (live-workers §2.10): row kind
//               `fixing-conflict` in the active style, counted as running, no footer.
//     asking  — null | 'question' | 'permission' | 'questions' | 'command' (live-workers §2.4): the kind of answer the
//               task's worker wants. A pending request makes the row `asking` whatever its phase.
//     holder  — null | 'coordinator' | 'person' (pir-coordinator §2.5): who holds the waiting items. A
//               coordinator-held task reads `asking coordinator` (row kind `asking-coordinator`) and is
//               left out of the asking tally and footer; absent or 'person' is today's `asking you`.
//     helper  — true on an end-of-run helper's entry (runState.helpers, below); absent on a plan task.
//     worker  — null | { id, live, logPath }: the worker `pir` opens for this task, the live one else the
//               latest (§2.11). workers — [{ id, role, n, logPath }], all of the task's in spawn order.
//               Both ride through to status.json for the screen; this model does not read them.
//
// opts.now is the current time in ms (the clock, injected — never read here, §3.1). opts.spinnerFrame
// is accepted for signature symmetry with the renderer but not used by the model: the spinner glyph is
// the renderer's, the model carries `kind` (DESIGN §2.3).
export function buildDisplay(runState, { now, spinnerFrame } = {}) {
  const { branch, ceiling, complete = false, readyToMerge = false, testsReason = null, testing = null, interrupted = false, handoff = null, tasks = [] } =
    runState ?? {};
  const base = runState?.base ?? handoff?.base ?? null;

  const doneIds = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const running = tasks.filter((t) => !t.done && (ACTIVE_PHASES.has(t.phase) || isRequest(t))).length;
  const ceilingFull = ceiling != null && running >= ceiling;

  const helpers = runState?.helpers ?? [];
  const rows = rowEntries(runState).map((t) =>
    t.separator ? { id: t.id, kind: 'separator', label: '', elapsedMs: null } : t.agent ? agentRow(t) : t.finisher ? finisherRow(t) : rowFor(t, { now, doneIds, ceilingFull }),
  );

  const done = doneIds.size;
  const total = tasks.length;
  const asking = askingCount(runState);
  // A run whose tasks are all merged is not finished while its end gate is still running.
  const finished = complete || (!testing && total > 0 && done === total);
  const summary = {
    done,
    total,
    running,
    asking,
    waiting: total - done - running,
    ceiling: ceiling ?? null,
    ceilingFull,
    finished,
  };

  // `branch` rides at the top level beside summary/rows/footer: the renderer shows the run's branch in
  // its header line on every paint, but the footer only carries a branch in some states (handoff, red),
  // so the summary line cannot source it from there. It is the one field added to the interface sketch.
  return { branch: branch ?? null, summary, rows, footer: footerFor({ tasks: [...tasks, ...helpers], complete, readyToMerge, testsReason, testing, interrupted, handoff, finisher: runState?.finisher ?? null, branch, base, now }) };
}

// One row for one task. The order of the checks is the priority: a ✅ task is done however it got there;
// otherwise a live worker's phase names the row; otherwise the task is idle and the reason (an unmet
// dependency, or a full ceiling) is what the row shows.
function rowFor(t, { now, doneIds, ceilingFull }) {
  const base = { id: t.id, slug: t.slug };

  if (t.done) {
    return { ...base, kind: 'done', label: 'merged', elapsedMs: t.doneMs ?? null };
  }

  if (ACTIVE_PHASES.has(t.phase) || isRequest(t)) {
    const until = t.stoppedAt ?? now;
    const elapsedMs = t.since != null && until != null ? until - t.since : null;
    // The worker was sent the fix and is working on it: nothing for the person to do (§2.10).
    if (isFixingConflict(t)) return { ...base, kind: 'fixing-conflict', label: 'fixing conflict', elapsedMs };
    const asking = askingKind(t);
    if (asking && heldByCoordinator(t)) return { ...base, kind: 'asking-coordinator', label: COORDINATOR_LABEL[asking], elapsedMs };
    if (asking) return { ...base, kind: 'asking', label: ASKING_LABEL[asking], elapsedMs };
    // A helper builds nothing and merges nothing: it is working until it reports, then closing.
    if (t.helper) return { ...base, kind: t.phase, label: HELPER_LABEL[t.phase] ?? PHASE_LABEL[t.phase], elapsedMs };
    return { ...base, kind: t.phase, label: PHASE_LABEL[t.phase], elapsedMs };
  }

  // Idle: not started and no worker holds it. Name the unmet dependencies if any, else it is ready and
  // simply queued behind the ceiling (DESIGN §2.3: `waiting` names which dep, `queued` means ready-but-full).
  const unmet = (t.deps ?? []).filter((d) => !doneIds.has(d));
  if (unmet.length > 0) {
    return { ...base, kind: 'waiting', label: `needs ${unmet.join(', ')}`, elapsedMs: null };
  }
  return {
    ...base,
    kind: 'queued',
    label: ceilingFull ? 'queued · ceiling full' : 'queued',
    elapsedMs: null,
  };
}

// The footer, in priority order (DESIGN §2.3, §2.4, §2.8): an interrupted run first (Ctrl-C), then a
// parked worker the person must answer, then the end-of-run hand-off (green) or failure (red), then the
// end gate still running (`testing`), else the plain running line. `asking` beats `handoff`/`red` because a complete run has nothing asking, so the
// two never contend; the order only makes the intent explicit.
function footerFor({ tasks, complete, readyToMerge, testsReason, testing, interrupted, handoff, finisher, branch, base, now }) {
  const named = base ? { base } : {};
  if (interrupted) return { kind: 'interrupted', ...named };

  // A worker fixing a conflict it was sent asks nothing, so it never takes the footer (§2.10); nor does a
  // question the coordinator agent holds (pir-coordinator §2.5).
  const asking = tasks.find((t) => !t.done && asksPerson(t));
  if (asking) {
    return { kind: 'asking', task: asking.id, slug: asking.slug, question: asking.question ?? '' };
  }

  // The finisher, once it is the run's session (finisher DESIGN §2.11): it does the merge, so the hand-off's
  // merge line must not show beside it.
  if (finisher) return finisherFooter(finisher);

  // The end of a run with the coordinator agent (pir-coordinator §2.9, §2.10): preparing (the base synced into
  // the branch, the report being written), then ready to merge or red, each naming the committed report.
  // The branch rides along for the merge line. Absent with the agent off, where today's footers follow.
  if (handoff?.state === 'preparing' || handoff?.state === 'ready' || handoff?.state === 'red') {
    const f = { kind: 'handoff', branch, ...named, state: handoff.state, reportPath: handoff.reportPath ?? null };
    // A held sync names its reason in the preparing line (base-branch DESIGN §2.8).
    if (handoff.state === 'preparing' && handoff.hold) return { ...f, hold: { reason: handoff.hold.reason, text: handoff.hold.text } };
    // Red says why, as today's red footer does (DESIGN §2.8), when the gate carried it.
    if (handoff.state === 'red') return { ...f, reason: testsReason?.reason ?? null, logPath: testsReason?.logPath ?? null };
    return f;
  }

  if (complete) {
    if (readyToMerge) return { kind: 'handoff', branch, ...named };
    // The red footer says why and where the output is (DESIGN §2.8); both null for a snapshot written
    // before the gate carried them.
    return { kind: 'red', branch, reason: testsReason?.reason ?? null, logPath: testsReason?.logPath ?? null };
  }
  if (testing) {
    const elapsedMs = testing.since != null && now != null ? now - testing.since : null;
    return { kind: 'testing', branch, elapsedMs };
  }
  return { kind: 'running' };
}
