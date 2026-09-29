// The finisher held as a live session (finisher DESIGN §2.3–§2.7, §2.10, §2.12, §3.3, §3.5). The shell
// counterpart of coordinator-agent.mjs and sharing its start/resume pattern: one object the run talks to,
// which starts the session fenced, drains its status files into its phase, recognises the person's go,
// keeps the ledger and `state.json`, and resumes it after an exit or a pir restart.
//
// pir holds the phase, never the session: every tool call is judged by `finisherVerdict` against the
// phase in `state.json`. The fence is two layers (DESIGN §3.3, T00):
//   - a PreToolUse hook that answers `ask` for every call, so the settings' allow rules (this machine
//     allows `Bash(git merge:*)`) cannot answer before `canUseTool` does. It reads nothing the finisher
//     wrote; it only sends every call on to the gate;
//   - the gate behind `canUseTool`, `decide` below: allow, deny with a message naming what the phase
//     allows, or park for the person (the go question, and a reserved request after the go).

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PHASES, finisherVerdict, readStatus, checkStatus, isGoAnswer, afterRestart,
} from '../core/finisher-policy.mjs';
import {
  finisherOpening, finisherResumed, finisherRefusal, finisherResynced, finisherGateRefusal, finisherStaleGo,
} from '../core/finisher-brief.mjs';
import { readEntry } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import {
  gateFor, lastLogN, readJson, loadSession, countExit, overBudget, appendJsonLine, readJsonLines,
} from './coordinator-agent.mjs';

// Every tool the finisher needs in either phase (DESIGN §3.3). The hook sees every tool, so none is left
// out for the fence's sake; the list is least privilege: no web, no sub-agents, no worktree or cron tools.
export const FINISHER_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'Skill', 'AskUserQuestion'];

// The hook (DESIGN §3.3): `ask` for every call, in every phase. `{}` would fall through to the settings'
// rules and let an allow-ruled command run unseen, so it never returns that.
export const ASK_EVERY_CALL = async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } });
export const FINISHER_HOOKS = { PreToolUse: [{ hooks: [ASK_EVERY_CALL] }] };

const FILE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Write', 'Skill']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The question's header is `Go`: the fixed go question, whatever was answered (DESIGN §2.7).
const isGoQuestion = (input) =>
  isObj(input) && Array.isArray(input.questions) && input.questions.length === 1 && input.questions[0]?.header === 'Go';

// `"question"="answer"` pairs from an AskUserQuestion's tool result, the only trace a phone answer leaves
// (worker-proc `answered-remotely`; coordinator-agent `remoteAnswer`, measured 2026-09-26).
function answersFromResult(text) {
  const out = {};
  for (const m of String(text ?? '').matchAll(/"([^"]*)"="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// startFinisher(...) → Finisher. See plans/finisher/tasks/T04-finisher-session.md for the interface.
// `rules` is chooseRules' { path, source }. `pirHome` (default ~/.pir) and `skillsDir`/`engineDir` are
// read roots before the go (DESIGN §2.4); all are injectable for tests, as are `uuid` and `now`.
export function startFinisher({
  controlDir,
  featurePath,
  repoRoot,
  slug,
  mainCheckout = repoRoot,
  rules,
  reportPath,
  askRules = [],
  platform = null,
  startWorker,
  claudePath,
  now = Date.now,
  remote = true,
  skillsDir = join(homedir(), '.claude', 'skills'),
  engineDir = join(homedir(), '.claude', 'pir-engine'),
  pirHome = join(homedir(), '.pir'),
  uuid = randomUUID,
  env = null,
}) {
  void platform; // the finisher answers nothing for workers; kept for the shared start signature
  const finDir = join(controlDir, 'finisher');
  const statusDir = join(finDir, 'status');
  const statePath = join(finDir, 'state.json');
  const sessionPath = join(finDir, 'session.json');
  const ledgerPath = join(finDir, 'ledger.jsonl');
  const convDir = join(controlDir, 'conversations');
  mkdirSync(statusDir, { recursive: true });
  // Cleared at startup (DESIGN §3.5): a status left from before a restart describes a moment that has
  // passed; the resumed brief tells the finisher what to write now.
  for (const f of readdirSync(statusDir)) drop(join(statusDir, f));

  const name = `${basename(repoRoot)} / ${slug} / finisher`;
  const fileGate = gateFor({
    cwd: featurePath,
    readRoots: [repoRoot, join(repoRoot, '.claude', 'worktrees'), featurePath, mainCheckout, skillsDir, pirHome, engineDir],
    decisionsDir: statusDir,
    skill: 'pir-finisher',
  });

  // ---- state.json (DESIGN §3.5) ----
  // Present at start means pir restarted over a finisher that was already running: its phase is kept per
  // afterRestart (`finishing` drops to `stuck`). Unreadable reads as `preparing`, the safest phase.
  const existed = existsSync(statePath);
  const stored = readJson(statePath);
  const state = {
    phase: PHASES.includes(stored?.phase) ? stored.phase : 'preparing',
    goGiven: stored?.goGiven === true,
    rules: rules?.path ?? stored?.rules ?? null,
    rulesSource: rules?.source ?? stored?.rulesSource ?? null,
    lastReady: isObj(stored?.lastReady) ? stored.lastReady : null,
    summary: typeof stored?.summary === 'string' ? stored.summary : null,
    steps: Array.isArray(stored?.steps) ? stored.steps : [],
    proposal: typeof stored?.proposal === 'string' ? stored.proposal : null,
  };
  const saveState = () => writeJsonAtomic(statePath, state);
  const appendLedger = (line) => appendJsonLine(ledgerPath, { t: new Date(now()).toISOString(), ...line });

  // A go counts only for a question first seen in the current generation (DESIGN §2.7, §2.8): every
  // accepted ready or stuck, every re-sync and every go starts a new one, so a Go to a question asked
  // before the steps it approves (or before main moved) opens nothing. In memory: a go question does not
  // outlive its process, so a pir restart starts afresh.
  let generation = 0;
  const setPhase = (next) => {
    state.phase = next;
    generation++;
  };
  // True from the pass pir sees main move until its re-sync is done (resyncing → resynced): the branch is
  // being changed under the finisher, so no go counts, whatever question it answers (DESIGN §2.8).
  let held = false;

  let pendingResume = null; // { phase, stuckSummary } for the next resumed brief
  if (existed) {
    const r = afterRestart(state.phase);
    if (r.phase !== state.phase) {
      appendLedger({ kind: 'restart', from: state.phase, to: r.phase, summary: r.stuckSummary });
      state.phase = r.phase;
      state.summary = r.stuckSummary ?? state.summary;
    }
    pendingResume = { phase: state.phase, stuckSummary: r.stuckSummary };
  }
  saveState();

  // ---- The gate ----
  function decide(toolName, input, opts = {}) {
    // The finisher acts on a Go the moment its question returns, while pir's next drain may be a pass
    // (up to POLL_MS, and a phone answer wakes nothing) away; judged on the stale phase, its first step
    // would be denied (review T04). So a drain runs here first, statuses before the log as in drain(), so a
    // question is never filed under steps a waiting `ready` replaces; what it finds is carried to drain().
    if ((state.phase === 'awaiting-go' || state.phase === 'stuck') && toolName !== 'AskUserQuestion') {
      drainStatuses(carry, { pass: false });
      scanLog(carry);
    }
    const phase = state.phase;
    const fileVerdict = FILE_TOOLS.has(toolName) ? fileGate(toolName, input) : undefined;
    const verdict = finisherVerdict({ phase, toolName, input, askRules, fileVerdict });
    // An `ask` rule the CLI matched but `reservedFor` did not know (FINDINGS 2026-09-29, T01): the CLI's
    // own flag parks it too, so an ask-bin action never runs on the go alone.
    if (verdict === 'allow' && phase === 'finishing' && opts.defaultToNo === true) return 'person';
    return verdict;
  }
  const denyMessage = (toolName) => finisherGateRefusal(toolName, state.phase);

  // ---- The session (the coordinator agent's start/resume pattern) ----
  const session = loadSession(sessionPath);
  const saveSession = () => writeJsonAtomic(sessionPath, session);
  let worker = null;
  let logPath = null;
  let up = false;
  let givenUp = false;
  let closing = false;

  function launch() {
    const resume = session.sessionId !== null;
    if (!resume) {
      session.sessionId = uuid();
      saveSession();
    }
    const n = lastLogN(convDir, 'finisher');
    logPath = join(convDir, `finisher-${resume ? Math.max(n, 1) : n + 1}.ndjson`);
    const extra = env?.() ?? null;
    worker = startWorker({
      ...(extra ? { env: { ...process.env, ...extra } } : {}),
      cwd: featurePath,
      ...(resume ? { resume: session.sessionId } : { sessionId: session.sessionId }),
      name,
      logPath,
      claudePath,
      permissionMode: 'default',
      tools: FINISHER_TOOLS,
      hooks: FINISHER_HOOKS,
      decide,
      denyMessage,
    });
    up = true;
    const w = worker;
    w.onExit((info) => onExit(w, info));
    if (resume) {
      const r = pendingResume ?? { phase: state.phase, stuckSummary: null };
      pendingResume = null;
      w.send(finisherResumed(r), { from: 'pir' });
    } else {
      w.send(
        finisherOpening({
          slug, branch: `pir/${slug}`, rulesPath: state.rules, rulesSource: state.rulesSource,
          statusDir, reportPath, mainCheckout,
        }),
        { from: 'pir' },
      );
    }
    if (remote) w.remoteControl(true).catch(() => {});
  }

  function onExit(w, info) {
    if (w !== worker) return;
    up = false;
    if (closing) return;
    const t = now();
    session.restarts = countExit(session, t);
    saveSession();
    if (overBudget(session.restarts, t)) {
      givenUp = true;
      w.note('finisher-given-up', { exits: session.restarts.length, code: info?.code ?? null });
      appendLedger({ kind: 'given-up', phase: state.phase, exits: session.restarts.length });
      return;
    }
    w.note('finisher-resuming', { exits: session.restarts.length, code: info?.code ?? null });
    // The go never carries over unseen work (DESIGN §2.12): `finishing` drops to `stuck`.
    const r = afterRestart(state.phase);
    if (r.phase !== state.phase) {
      appendLedger({ kind: 'restart', from: state.phase, to: r.phase, summary: r.stuckSummary });
      setPhase(r.phase);
      state.summary = r.stuckSummary ?? state.summary;
      saveState();
    } else generation++; // an open go question died with the process
    pendingResume = { phase: state.phase, stuckSummary: r.stuckSummary };
    try {
      launch();
    } catch (err) {
      givenUp = true;
      w.note('finisher-given-up', { message: String(err?.message ?? err) });
    }
  }

  const alive = () => up && !givenUp && !closing;
  const tell = (text) => (alive() ? worker.send(text, { from: 'pir' }) : false);

  // ---- The drain ----
  const unparsed = new Set();
  // Log scanning is per Worker object, in memory: after a pir restart nothing already answered is
  // replayed, and a resume within this pir finishes the old Worker's tail before the new one's.
  let scanned = { worker: null, n: 0 };
  const questions = new Map(); // requestId → { input, generation, toolUseId }
  const awaitingResult = new Map(); // toolUseId → requestId, answered on the phone, result not yet seen
  const lastToolUse = new Map(); // tool name → the latest tool_use id seen for it

  function applyStatus(status, next) {
    const from = state.phase;
    const line = { kind: 'status', status: status.kind, from, to: next };
    if (status.kind === 'ready') {
      state.lastReady = { rules: status.rules, summary: status.summary, steps: status.steps };
      state.summary = status.summary;
      state.steps = status.steps;
      state.proposal = null;
      Object.assign(line, { summary: status.summary, steps: status.steps });
    } else if (status.kind === 'stuck') {
      state.summary = status.summary;
      state.steps = status.steps;
      state.proposal = status.proposal;
      Object.assign(line, { summary: status.summary, proposal: status.proposal, steps: status.steps });
    } else if (status.kind === 'done') {
      state.summary = status.summary;
      line.summary = status.summary;
    } else if (status.kind === 'close') {
      line.reason = status.reason;
    }
    if (status.kind === 'close') state.phase = next;
    else setPhase(next);
    saveState();
    appendLedger(line);
  }

  // `pass: false` (from decide) leaves a file that does not parse alone: only pir's passes count its retry.
  function drainStatuses(out, { pass = true } = {}) {
    let files = [];
    try {
      files = readdirSync(statusDir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return;
    }
    for (const file of files) {
      const path = join(statusDir, file);
      let raw;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        // The Write tool has no rename, so the file may still be landing: left one more pass (DESIGN §2.6).
        if (!pass) continue;
        if (!unparsed.has(file)) {
          unparsed.add(file);
          continue;
        }
        unparsed.delete(file);
        drop(path);
        refuse(out, file, 'it is not valid JSON');
        continue;
      }
      unparsed.delete(file);
      drop(path);
      const read = readStatus(obj);
      if (!read.ok) {
        refuse(out, file, read.why);
        continue;
      }
      const checked = checkStatus(read.status, state.phase);
      if (!checked.ok) {
        refuse(out, file, checked.why);
        continue;
      }
      applyStatus(read.status, checked.next);
      out.accepted.push(read.status);
    }
  }

  function refuse(out, file, why) {
    out.refused.push({ file, why });
    appendLedger({ kind: 'refused', file, why, phase: state.phase });
    tell(finisherRefusal(why, file));
  }

  // One answer to a go question: the go, a `Not yet`, or a Go that does not count.
  function answered(out, requestId, answers, by) {
    const q = questions.get(requestId);
    questions.delete(requestId);
    if (!q || out.go) return;
    const phase = state.phase;
    const fresh = q.generation === generation && !held;
    if (fresh && isGoAnswer({ phase, toolName: 'AskUserQuestion', input: q.input, answers })) {
      setPhase('finishing');
      state.goGiven = true;
      saveState();
      appendLedger({ kind: 'go', by, from: phase, to: 'finishing' });
      out.go = { by };
      return;
    }
    const said = isObj(answers) ? Object.values(answers)[0] : undefined;
    if (said === 'Go') {
      appendLedger({ kind: 'stale-go', by, phase });
      tell(finisherStaleGo(phase));
    } else {
      appendLedger({ kind: 'not-yet', by, phase, answer: typeof said === 'string' ? said : null });
    }
  }

  function scanEntry(out, e) {
    if (!isObj(e)) return;
    for (const ev of readEntry(e)) {
      if (ev.kind === 'tool-use') lastToolUse.set(ev.name, ev.toolUseId);
      if (ev.kind === 'tool-result' && awaitingResult.has(ev.toolUseId)) {
        const requestId = awaitingResult.get(ev.toolUseId);
        awaitingResult.delete(ev.toolUseId);
        answered(out, requestId, ev.isError ? {} : answersFromResult(ev.text), 'phone');
      }
    }
    if (e.dir === 'request' && e.toolName === 'AskUserQuestion' && isGoQuestion(e.input)) {
      questions.set(e.requestId, { input: e.input, generation, toolUseId: lastToolUse.get('AskUserQuestion') ?? `toolu_${e.requestId}` });
    } else if (e.dir === 'out' && e.kind === 'reply' && questions.has(e.requestId)) {
      // Only pir's own reply on the person's behalf is the person's answer; a gate reply (`from: 'pir'`)
      // or anything else is not (DESIGN §2.7).
      if (e.from !== 'person') {
        questions.delete(e.requestId);
        return;
      }
      const r = isObj(e.result) ? e.result : {};
      answered(out, e.requestId, r.behavior === 'allow' && isObj(r.updatedInput?.answers) ? r.updatedInput.answers : {}, 'person');
    } else if (e.dir === 'note' && e.kind === 'answered-remotely' && questions.has(e.requestId)) {
      awaitingResult.set(questions.get(e.requestId).toolUseId, e.requestId);
    }
  }

  function scanLog(out) {
    const step = (w) => {
      const list = w.entries();
      for (let i = scanned.n; i < list.length; i++) scanEntry(out, list[i]);
      scanned.n = list.length;
    };
    if (scanned.worker && scanned.worker !== worker) step(scanned.worker);
    if (scanned.worker !== worker) scanned = { worker, n: 0 };
    if (worker) step(worker);
  }

  // What a scan from `decide` found between drains; the next drain reports it.
  let carry = { accepted: [], refused: [], go: null };
  function drain() {
    const out = carry;
    carry = { accepted: [], refused: [], go: null };
    drainStatuses(out);
    scanLog(out);
    return out;
  }

  // ---- Start ----
  const t0 = now();
  if (overBudget(session.restarts, t0)) {
    givenUp = true;
    const n = lastLogN(convDir, 'finisher');
    if (n > 0) logPath = join(convDir, `finisher-${n}.ndjson`);
  } else launch();

  function drop(path) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }

  return {
    get id() {
      return session.sessionId;
    },
    get session() {
      return worker;
    },
    get logPath() {
      return logPath;
    },
    alive,
    givenUp: () => givenUp,
    remoteUrl() {
      return worker?.remoteUrl ?? null;
    },
    drain,
    phase: () => state.phase,
    goGiven: () => state.goGiven,
    // view() → the row's facts (T07): `state` is the phase, or `restarting` while it is down and not given
    // up, or `given-up`. `asking` is true while any request is parked for the person.
    view() {
      const st = givenUp ? 'given-up' : alive() || closing ? state.phase : 'restarting';
      let asking = false;
      try {
        asking = alive() && worker.pending().length > 0;
      } catch {
        asking = false;
      }
      return {
        id: session.sessionId, logPath, state: st, phase: state.phase, goGiven: state.goGiven,
        summary: state.summary, steps: state.steps.slice(), rulesSource: state.rulesSource, asking,
      };
    },
    tell,
    // resynced(mainSha) → main moved before any go (DESIGN §2.8): back to preparing, the old steps and any
    // go for them void, the finisher told. → false (nothing done) once a go was given, or in `finishing`/`done`.
    // resyncing() → main moved and pir starts re-syncing the branch (review T05): the phase drops to
    // preparing at once, voiding any open go question, and no go counts until resynced() — a Go tapped on
    // the old question while the re-sync runs would otherwise start the merge on a branch still changing.
    // Silent: the finisher is told once, by resynced(), when the branch is settled.
    resyncing() {
      const p = state.phase;
      const takes = p === 'preparing' || p === 'awaiting-go' || (p === 'stuck' && !state.goGiven);
      if (!takes) return false;
      held = true;
      setPhase('preparing');
      saveState();
      appendLedger({ kind: 'resyncing', from: p, to: 'preparing' });
      return true;
    },
    resynced(mainSha) {
      // What the finisher did while held is judged while still held, so a go asked and answered during the
      // re-sync is stale rather than counted by the next drain; its statuses are voided just below.
      if (held) {
        drainStatuses(carry, { pass: false });
        scanLog(carry);
        held = false;
      }
      const p = state.phase;
      const takes = p === 'preparing' || p === 'awaiting-go' || (p === 'stuck' && !state.goGiven);
      if (!takes) return false;
      setPhase('preparing');
      saveState();
      appendLedger({ kind: 'resync', from: p, to: 'preparing', mainSha: mainSha ?? null });
      tell(finisherResynced({ mainSha }));
      return true;
    },
    ledger: () => readJsonLines(ledgerPath),
    async close(opts) {
      closing = true;
      if (worker) await worker.close(opts);
    },
  };
}
