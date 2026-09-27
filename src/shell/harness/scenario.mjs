// The scenario spec (DESIGN §4.1, T15): a scenario's expected behaviour turned into checkable data.
// A spec names the scenario, the fixture it runs (a scratch plan the T16 fixtures produce), the
// seatbelts the live runner (T17) must apply (§5.2), and the FACTS the run must show — pure predicates
// over a captured bundle (assertions.mjs). checkScenario(spec, bundle) runs those facts and returns a
// verdict; the runner never decides pass/fail itself, it declares facts here and the data answers.
//
// This module is pure spec plumbing (no clock, no I/O, no live agent — DESIGN §3.1): it only shapes
// and validates a spec object. Running the facts is assertions.checkScenario; producing the bundle is
// the T17 live runner; building the fixture a spec points at is T16.

// The seatbelt defaults every live scenario inherits unless it overrides them (§5.2). Kept low on
// purpose: a scenario spawns real paid agents, so the ceiling is the smallest the scenario needs and a
// wall-clock timeout auto-touches HALT so a hung real worker cannot run — or cost — unboundedly. The
// kill switch is always wired. The T17 runner reads these; nothing here acts on them.
export const DEFAULT_SEATBELTS = Object.freeze({
  ceiling: 1, // the smallest ceiling; a parallel scenario raises it deliberately
  timeoutMs: 10 * 60 * 1000, // 10 min wall-clock cap → auto-HALT
  killSwitch: true, // the HALT control flag is always available
});

// The terminals a scenario may declare as its correct end (T11). `completed` — the default — is a clean
// hand-off; a run that hit the wall-clock timeout instead is a runaway and fails. `parked` is for a
// fixture whose designed correct end is a worker parking on the person and never being answered (the
// non-agentic model routes nothing down, §2.2): the park never resolves, so the wall-clock MUST fire and
// HALT it — that is success, carried by the fixture's own facts, not a timeout-failure. run.mjs reads this.
const EXPECTED_TERMINALS = Object.freeze(['completed', 'parked']);

// How a scenario is driven (pir-plan-command T17). `build` — the default — seeds a reviewed plan and
// launches the coordinator on it. `plan` starts from a repo with no plan: the runner starts a planning
// run (`pir plan`'s startPlanRun), plays the person through planning and review with the canned `reply`
// (at most `replyCap` times, DESIGN §5.2), gives the go (`startRun`) and waits for the build.
const KINDS = Object.freeze(['build', 'plan']);

// defineScenario(spec) → a normalized, validated scenario spec. Throws on the mistakes that would make
// a scenario meaningless: no id, no fixture, or no facts (a scenario that asserts nothing proves
// nothing). facts are Fact objects from assertions.mjs — each `{ id, label, check }`; this module does
// not run them, so it only checks they are shaped like a fact (a callable `check`).
//
// Two declarative drill flags the T17 runner reads (T11), kept here so a scenario stays a pure data
// declaration of how it is driven and judged: `killSwitchDrill` — touch HALT once mid-run (after the
// first spawn) so the kill switch is actually exercised on a fast run that would otherwise hand off
// before it fired; `expectedTerminal` — the run's correct end (see EXPECTED_TERMINALS). A third,
// `answerPending` (live-workers T18), has the runner stand in for the person and answer every pending
// permission request and question set through the inbox (answerer.mjs), so a fixture that forces them can
// still run to a hand-off unattended. A fourth, `holdMerges`, launches the coordinator with
// PARALLEL_HOLD_MERGES=1 (dispatch.mjs) so a same-line clash is hit at the coordinator's own merge. A
// fifth, `statusSnapshots` (real-asking-state T05), launches it as `pir` does (PIR_RUN=1, a scratch
// PIR_HOME) so it writes control/status.json every pass and the capture can keep the row history. A
// sixth, `coordinator` (pir-coordinator T04), runs the coordinator agent; without it the run is started
// with PARALLEL_COORDINATOR=0, so a drill written before the agent existed is unchanged. With the agent on,
// `answerPending` answers only what the run shows held by the person, so the scenario must also take
// `statusSnapshots` (the status.json it reads); `answerPending.permissions` ({ <task>: 'deny' }) types a
// deny on that task's permission requests instead of the default allow.
//
// Two steps for the live check of the agent (pir-coordinator T09): `mainCommit` ({ after, files, message })
// commits `files` to the scratch repo's main once the flow log shows task `after` merged, once, so the end
// sync meets a main that moved mid-run; `mergeWhenReady` merges the feature branch into the scratch main
// once the run waits in `ready to merge`, the person's merge that ends the run (DESIGN §2.10).
export function defineScenario(spec = {}) {
  const {
    id,
    title,
    fixture,
    seatbelts = {},
    facts = [],
    killSwitchDrill = false,
    expectedTerminal = 'completed',
    answerPending = false,
    holdMerges = false,
    statusSnapshots = false,
    coordinator = false,
    kind = 'build',
    reply = null,
    replyCap = null,
    mainCommit = null,
    mergeWhenReady = false,
  } = spec;

  if (!id || typeof id !== 'string') {
    throw new Error('defineScenario: a scenario needs a string id');
  }
  if (!fixture) {
    throw new Error(`defineScenario(${id}): a scenario needs a fixture reference`);
  }
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error(`defineScenario(${id}): a scenario must declare at least one fact`);
  }
  for (const f of facts) {
    if (!f || typeof f.check !== 'function') {
      throw new Error(`defineScenario(${id}): every fact must be a { id, label, check } from assertions.mjs`);
    }
  }
  if (!KINDS.includes(kind)) {
    throw new Error(`defineScenario(${id}): kind must be one of ${KINDS.join(', ')}`);
  }
  if (kind === 'plan' && (typeof reply !== 'string' || !reply.trim() || !Number.isInteger(replyCap) || replyCap < 1)) {
    throw new Error(`defineScenario(${id}): a plan scenario needs a reply text and a positive whole replyCap`);
  }
  if (coordinator && answerPending && !statusSnapshots) {
    throw new Error(`defineScenario(${id}): with the coordinator agent, answerPending needs statusSnapshots (it reads who holds an item)`);
  }
  if (mainCommit && (!/^T\d+$/.test(mainCommit.after ?? '') || !mainCommit.files || Object.keys(mainCommit.files).length === 0)) {
    throw new Error(`defineScenario(${id}): mainCommit needs a task id \`after\` and at least one file`);
  }
  if (!EXPECTED_TERMINALS.includes(expectedTerminal)) {
    throw new Error(`defineScenario(${id}): expectedTerminal must be one of ${EXPECTED_TERMINALS.join(', ')}`);
  }

  return {
    id,
    title: title ?? id,
    fixture,
    // Explicit override wins per field; the rest fall back to the low defaults.
    seatbelts: { ...DEFAULT_SEATBELTS, ...seatbelts },
    facts,
    killSwitchDrill: !!killSwitchDrill,
    expectedTerminal,
    holdMerges: !!holdMerges,
    kind,
    reply: kind === 'plan' ? reply : null,
    replyCap: kind === 'plan' ? replyCap : null,
    answerPending: answerPending
      ? {
          typed: { ...(answerPending.typed ?? {}) },
          say: { ...(answerPending.say ?? {}) },
          afterWake: { ...(answerPending.afterWake ?? {}) },
          permissions: { ...(answerPending.permissions ?? {}) },
        }
      : false,
    statusSnapshots: !!statusSnapshots,
    coordinator: !!coordinator,
    mainCommit: mainCommit
      ? { after: mainCommit.after, files: { ...mainCommit.files }, message: mainCommit.message ?? `main: moved after ${mainCommit.after} merged` }
      : null,
    mergeWhenReady: !!mergeWhenReady,
  };
}
