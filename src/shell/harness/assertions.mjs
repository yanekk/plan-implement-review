// The assertion layer of the live-scenario harness (DESIGN §4.1, T15). A scenario declares the facts it
// must show; each FACT is a pure predicate over a captured bundle (T14) that reports pass/fail with the
// bundle lines that decided it. checkScenario runs a spec's facts into one report and one verdict, and
// formatReport renders it for a person. This is what makes the harness data-driven: the verdict is a
// list of facts and the evidence that proves or breaks each, not a person's recollection.
//
// PURITY (DESIGN §3.1). Every fact `check(bundle)` is a pure function of an already-loaded bundle — no
// clock, no filesystem, no live agent. The ONE I/O in this file is loadTranscripts(), a loader that
// reads the transcript files T14's manifest points at into memory BEFORE any predicate runs; a fact
// never touches disk. The layer lives in src/shell/ (not scanned by the core boundary test) precisely
// because it reads a bundle off disk to build the in-memory structure the pure predicates consume.
//
// WHAT A BUNDLE CARRIES (T14 loadBundle + loadTranscripts here):
//   flow      — [{ ts, type, rest }] parsed from the coordinator's control/log. Each line is
//               `${ISO} ${type} ${task-or-branch}` (loop.mjs record()): the type is the action
//               (open-feature, spawn, hello, await-idle, review, merge, close, halt-close, surface,
//               promote, teardown, ceiling), the rest is a task id (T05), a branch, or free text.
//               The line does NOT carry a surface's KIND (conflict/question/decision) — loop.mjs
//               writes only type+task — so the question/conflict facts key on the TASK id a scenario
//               names, not on a kind read from the log (see questionRoundTrip / mergeConflictParked).
//   timeline  — [{ ts, agents:[{ name, sessionId, cwd, status, state, isWorkerOf, isCoordinator }] }]
//               one sampled `agents --json` per tick. status is live-only, so a busy→idle transition
//               proves the idle-gated close (DESIGN §2.3); a session absent from a tick has ended.
//   final     — the resting-state `agents --json --all` snapshot.
//   manifest  — { <agent name>: { sessionId, cwd, role, copied, copiedTo } }, keyed by name; a name
//               that recurs (implementer then its fresh reviewer) is keyed `name (sessionId)` (T14).
//   gitLog    — `git log --oneline --graph --all` text of the scratch repo.
//   transcripts (added here) — [{ key, name, role, task, sessionId, events }] parsed from the copied
//               .jsonl files. A worker→coordinator SendMessage is an assistant tool_use carrying
//               { to, summary, message } (confirmed against the real T10 worker transcript 2026-09-10);
//               the coordinator's hello and its answers ride the coordinator agent's own transcript the
//               same way, because platform.send hands the string to the agent to actually send (T09
//               bridge), not a child process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordinatorName, workerName, parseAgentName } from '../../core/naming.mjs';

// --- Small pure helpers over a bundle ------------------------------------------------------------

// A messaging name may arrive with a trailing ` [ref]` disambiguator (SendMessage shows one when two
// listings collide, e.g. "pir-t10 · scratch [54afd5]"). It is not part of the addressable name, so it
// is stripped before any name comparison.
function stripRef(name) {
  return String(name ?? '').replace(/\s*\[[0-9a-fA-F]+\]\s*$/, '').trim();
}

function sameName(a, b) {
  return a != null && b != null && stripRef(a) === stripRef(b);
}

// Reconstruct a flow line for evidence, in the on-disk shape a person would grep.
function flowLine(e) {
  return [e.ts, e.type, e.rest].filter((s) => s != null && s !== '').join(' ');
}

const flowOf = (bundle, type) => (bundle.flow ?? []).filter((e) => e.type === type);

// runIdentity(bundle) → { repo, plan, coordName }. Read from the data the same way the coordinator
// identifies its own run — the coordinator's name (DESIGN §2.8) — so it cannot drift from bookkeeping.
// Prefer the timeline's coordinator-tagged agent, then the transcripts, then the manifest.
export function runIdentity(bundle) {
  for (const tick of bundle.timeline ?? []) {
    for (const a of tick.agents ?? []) {
      if (a.isCoordinator && a.name) {
        const p = parseAgentName(a.name);
        if (p.matches) return { repo: p.repo, plan: p.plan, coordName: stripRef(a.name) };
      }
    }
  }
  for (const t of bundle.transcripts ?? []) {
    if (t.role === 'coordinator' && t.name) {
      const p = parseAgentName(t.name);
      if (p.matches) return { repo: p.repo, plan: p.plan, coordName: stripRef(t.name) };
    }
  }
  for (const [key, e] of Object.entries(bundle.manifest ?? {})) {
    if (e && e.role === 'coordinator') {
      const name = manifestName(key, e.sessionId);
      const p = parseAgentName(name);
      if (p.matches) return { repo: p.repo, plan: p.plan, coordName: name };
    }
  }
  return { repo: null, plan: null, coordName: null };
}

// The manifest key is the agent name, or `name (sessionId)` when a name recurred across sessions (T14).
// Recover the bare name so it parses back to a task.
function manifestName(key, sessionId) {
  if (sessionId && key.endsWith(` (${sessionId})`)) return key.slice(0, -` (${sessionId})`.length);
  return key;
}

// --- Transcripts: the one loader (I/O), then pure accessors --------------------------------------

// loadTranscripts(bundle, { readFile }) → a new bundle with `transcripts` attached. The ONLY disk read
// in this file, done once up front so the predicates stay pure. readFile is injected so a test can load
// a canned bundle with no real files. A transcript that was not copied (manifest copied:false) or fails
// to read is included with events: [] rather than dropped, so a fact can say "no transcript" from data.
export function loadTranscripts(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  const transcripts = [];
  for (const [key, entry] of Object.entries(bundle.manifest ?? {})) {
    if (!entry) continue;
    const name = manifestName(key, entry.sessionId);
    const task = parseAgentName(name).task;
    let events = [];
    if (entry.copied && entry.copiedTo) {
      try {
        const text = readFile(join(bundle.dir, entry.copiedTo));
        events = parseTranscript(text);
      } catch {
        events = [];
      }
    }
    transcripts.push({ key, name, role: entry.role ?? null, task, sessionId: entry.sessionId ?? null, events });
  }
  return { ...bundle, transcripts };
}

// parseTranscript(text) → the JSONL lines parsed to objects, malformed lines skipped (never a throw).
export function parseTranscript(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// sendMessagesOf(transcript) → the SendMessage calls the session made: an assistant tool_use named
// SendMessage carrying { to, summary, message } (the real transcript shape, T10 2026-09-10). Pure.
export function sendMessagesOf(transcript) {
  const out = [];
  for (const ev of transcript?.events ?? []) {
    const content = ev?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'tool_use' && part?.name === 'SendMessage' && part.input) {
        out.push({ to: part.input.to ?? null, summary: part.input.summary ?? '', message: part.input.message ?? '' });
      }
    }
  }
  return out;
}

const transcriptsByRole = (bundle, role) => (bundle.transcripts ?? []).filter((t) => t.role === role);
const coordinatorTranscript = (bundle) => transcriptsByRole(bundle, 'coordinator')[0] ?? null;
const workerTranscripts = (bundle) => transcriptsByRole(bundle, 'worker');

// --- Fact construction ---------------------------------------------------------------------------
//
// A fact-builder returns { id, label, check(bundle) → { pass, evidence, detail } }. `check` is the pure
// predicate; `label` is for the printer. `evidence` is the bundle lines/events that decided the verdict
// (present on pass and fail alike, so a failure points at the data). `detail` is one human sentence.

function fact(id, label, check) {
  return { id, label, check };
}

// Every freshly-spawned session — an implementer/verify worker (flow `spawn`) and each fresh reviewer
// (flow `review`) — must get exactly one hello, and the coordinator's transcript must show a
// SendMessage addressed by that worker's name (DESIGN §2.2, T13 Problem A). The flow half matches each
// spawn/review to a hello for the same task (order-tolerant); the transcript half checks the coordinator
// actually addressed each spawned worker by name.
export function helloPerSpawn() {
  return fact('hello-per-spawn', 'A hello opens every worker channel at spawn', (bundle) => {
    const evidence = [];
    const spawns = (bundle.flow ?? []).filter((e) => e.type === 'spawn' || e.type === 'review');
    const hellos = flowOf(bundle, 'hello');

    // Flow half: one hello per spawn/review, matched by task. A queue so a task spawned then reviewed
    // (two sessions, two hellos) matches correctly.
    const pending = [];
    for (const e of bundle.flow ?? []) {
      if (e.type === 'spawn' || e.type === 'review') pending.push(e);
      else if (e.type === 'hello') {
        const i = pending.findIndex((p) => p.rest === e.rest);
        if (i !== -1) pending.splice(i, 1);
      }
    }
    const unmatchedSpawns = pending; // spawns/reviews with no hello
    const extraHellos = hellos.length - (spawns.length - unmatchedSpawns.length);

    for (const e of spawns) evidence.push(flowLine(e));
    for (const e of hellos) evidence.push(flowLine(e));

    if (spawns.length === 0) {
      return { pass: false, evidence, detail: 'no spawn/review actions in the flow — nothing to open a channel for' };
    }
    if (unmatchedSpawns.length > 0) {
      return {
        pass: false,
        evidence,
        detail: `spawn/review with no hello: ${unmatchedSpawns.map((e) => e.rest).join(', ')}`,
      };
    }
    if (extraHellos !== 0) {
      return { pass: false, evidence, detail: `hello count (${hellos.length}) does not match spawn+review (${spawns.length})` };
    }

    // Transcript half: the coordinator addressed each spawned worker by its name.
    const { repo, plan } = runIdentity(bundle);
    const coord = coordinatorTranscript(bundle);
    if (!coord) {
      return { pass: false, evidence, detail: 'no coordinator transcript captured — cannot confirm the hello was addressed by name' };
    }
    if (!repo || !plan) {
      return { pass: false, evidence, detail: 'could not resolve the run repo/plan from the bundle to check hello addressing' };
    }
    const sent = sendMessagesOf(coord);
    const tasksSpawned = [...new Set(spawns.map((e) => e.rest))];
    const missing = [];
    for (const task of tasksSpawned) {
      const wName = workerName({ repo, plan, task });
      const hit = sent.find((s) => sameName(s.to, wName));
      if (hit) evidence.push(`coordinator → ${wName}: ${hit.summary}`);
      else missing.push(wName);
    }
    if (missing.length > 0) {
      return { pass: false, evidence, detail: `coordinator transcript has no SendMessage to: ${missing.join(', ')}` };
    }
    return { pass: true, evidence, detail: `${spawns.length} spawn/review each got a hello addressed by name` };
  });
}

// For every finished worker that was seen working, no close precedes an idle observation of it (DESIGN
// §2.3, T13 Problem B — the idle-gated close). A worker never seen busy (a dead/crashed one) is exempt:
// §2.3 closes it at once. The kill switch (halt-close) is a different action and closes regardless, so
// it is not a `close` and is not covered here.
export function noCloseBeforeIdle() {
  return fact('no-close-before-idle', 'No finished worker is closed before it goes idle', (bundle) => {
    const evidence = [];
    const closes = flowOf(bundle, 'close').filter((e) => /^T\d+$/.test(e.rest));
    if (closes.length === 0) {
      return { pass: true, evidence, detail: 'no task-close actions to check' };
    }
    for (const close of closes) {
      const task = close.rest;
      const obs = [];
      for (const tick of bundle.timeline ?? []) {
        for (const a of tick.agents ?? []) {
          if (a.isWorkerOf && parseAgentName(a.name).task === task) obs.push({ ts: tick.ts, status: a.status });
        }
      }
      const wasBusy = obs.some((o) => o.status === 'busy');
      if (!wasBusy) continue; // never seen working → dead/crashed, exempt (§2.3)
      const idle = obs.find((o) => o.status === 'idle');
      evidence.push(flowLine(close));
      if (!idle) {
        return { pass: false, evidence, detail: `${task} was closed but never observed idle (closed mid-work)` };
      }
      if (idle.ts > close.ts) {
        evidence.push(`idle observed at ${idle.ts}`);
        return { pass: false, evidence, detail: `${task} closed at ${close.ts} before its idle observation at ${idle.ts}` };
      }
      evidence.push(`idle observed at ${idle.ts} (≤ close ${close.ts})`);
    }
    return { pass: true, evidence, detail: `${closes.length} close(s) each followed an idle observation` };
  });
}

// When a worker messages the coordinator, it addresses it by the convention name {repo} · {plan}
// (DESIGN §2.8), not only by a return-socket reply. So every worker whose transcript sends anything
// must send at least one message addressed to that name.
export function byNameAddressing() {
  return fact('by-name-addressing', 'Workers address the coordinator by its convention name', (bundle) => {
    const evidence = [];
    const { coordName } = runIdentity(bundle);
    if (!coordName) {
      return { pass: false, evidence, detail: 'could not resolve the coordinator name from the bundle' };
    }
    const workers = workerTranscripts(bundle);
    let checked = 0;
    for (const w of workers) {
      const sends = sendMessagesOf(w);
      if (sends.length === 0) continue; // a silent worker asks nothing; nothing to prove
      checked += 1;
      const hit = sends.find((s) => sameName(s.to, coordName));
      if (hit) {
        evidence.push(`${w.name || w.task} → ${stripRef(hit.to)}: ${hit.summary}`);
      } else {
        for (const s of sends) evidence.push(`${w.name || w.task} → ${s.to} (not the convention name)`);
        return { pass: false, evidence, detail: `${w.name || w.task} messaged the coordinator but never by "${coordName}"` };
      }
    }
    if (checked === 0) {
      return { pass: false, evidence, detail: 'no worker sent any message — nothing to prove by-name addressing' };
    }
    return { pass: true, evidence, detail: `${checked} worker(s) addressed the coordinator by name` };
  });
}

// A worker that raised a question was surfaced to the user and, after the answer, resumed to done and
// merged (DESIGN §2.5). Because the flow log does not carry a surface's kind, the scenario names the
// task it engineered to ask, and this fact checks that task: a `surface` for it, then a later `merge`
// of it (the worker resumed). The coordinator's answer SendMessage to the worker is supporting
// evidence when the coordinator transcript is present.
export function questionRoundTrip(task) {
  return fact(`question-round-trip:${task}`, `A question on ${task} was surfaced and answered`, (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'surface').filter((e) => e.rest === task);
    if (surfaces.length === 0) {
      return { pass: false, evidence, detail: `no surface for ${task} — the question was never put to the user` };
    }
    const surfaceTs = surfaces[0].ts;
    evidence.push(flowLine(surfaces[0]));
    const merge = flowOf(bundle, 'merge').find((e) => e.rest === task && e.ts >= surfaceTs);
    if (!merge) {
      return { pass: false, evidence, detail: `${task} was surfaced but never resumed to a merge — the decision had no way down` };
    }
    evidence.push(flowLine(merge));
    const { repo, plan } = runIdentity(bundle);
    const coord = coordinatorTranscript(bundle);
    if (coord && repo && plan) {
      const wName = workerName({ repo, plan, task });
      const answer = sendMessagesOf(coord).find((s) => sameName(s.to, wName));
      if (answer) evidence.push(`coordinator → ${wName} (answer): ${answer.summary}`);
    }
    return { pass: true, evidence, detail: `${task} was surfaced and then resumed to a merge` };
  });
}

// A merge conflict the worker could not resolve was surfaced and PARKED: no merge of that task landed,
// so nothing bad reached the feature branch (DESIGN §2.5). The scenario names the conflicting task
// (the flow log carries no surface kind). Checked from the flow (a surface, no merge of the task) and
// the git log (the task's merge commit is absent).
export function mergeConflictParked(task) {
  return fact(`merge-conflict-parked:${task}`, `A conflict on ${task} was parked, no bad merge landed`, (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'surface').filter((e) => e.rest === task);
    if (surfaces.length === 0) {
      return { pass: false, evidence, detail: `no surface for ${task} — a conflict was expected to be surfaced` };
    }
    evidence.push(flowLine(surfaces[0]));
    const merged = flowOf(bundle, 'merge').find((e) => e.rest === task);
    if (merged) {
      evidence.push(flowLine(merged));
      return { pass: false, evidence, detail: `${task} was merged despite the conflict — a dirty branch reached the feature branch` };
    }
    const { plan } = runIdentity(bundle);
    if (plan) {
      const branchMerge = `merge pir/${plan}-${task}`;
      if ((bundle.gitLog ?? '').includes(branchMerge)) {
        evidence.push(`git log contains "${branchMerge}"`);
        return { pass: false, evidence, detail: `git log shows ${task}'s branch merged despite the conflict` };
      }
    }
    evidence.push(`no merge of ${task} in the flow or git log`);
    return { pass: true, evidence, detail: `${task}'s conflict was surfaced and parked; no merge of it landed` };
  });
}

// main gained exactly one commit — the promotion — and no task branch reached main directly (DESIGN
// §2.9). The authoritative signal is the flow's single `promote` (the coordinator's only main-touching
// action); the git log corroborates with exactly one promotion merge `Merge branch 'pir/{plan}'`.
export function oneMergeToMain() {
  return fact('one-merge-to-main', 'main gained exactly one commit — the promotion', (bundle) => {
    const evidence = [];
    const promotes = flowOf(bundle, 'promote');
    for (const p of promotes) evidence.push(flowLine(p));
    if (promotes.length !== 1) {
      return { pass: false, evidence, detail: `expected exactly one promote in the flow, found ${promotes.length}` };
    }
    const { plan } = runIdentity(bundle);
    if (plan) {
      const needle = `Merge branch 'pir/${plan}'`;
      const count = (bundle.gitLog ?? '').split('\n').filter((l) => l.includes(needle)).length;
      evidence.push(`git log promotion merges: ${count}`);
      if (count !== 1) {
        return { pass: false, evidence, detail: `git log shows ${count} promotion merge(s) into main, expected 1` };
      }
    }
    return { pass: true, evidence, detail: 'exactly one promotion reached main' };
  });
}

// After the kill switch fires (flow `halt-close`), every this-run worker leaves the timeline and
// nothing is promoted (DESIGN §2.4). Checked from the flow (halt-close present, no promote) and the
// timeline (the last tick shows no live worker of this run).
export function killSwitchStoppedAll() {
  return fact('kill-switch-stopped-all', 'The kill switch stopped every worker and promoted nothing', (bundle) => {
    const evidence = [];
    const haltCloses = flowOf(bundle, 'halt-close');
    if (haltCloses.length === 0) {
      return { pass: false, evidence, detail: 'no halt-close in the flow — the kill switch was not seen to fire' };
    }
    for (const h of haltCloses) evidence.push(flowLine(h));
    const promotes = flowOf(bundle, 'promote');
    if (promotes.length > 0) {
      for (const p of promotes) evidence.push(flowLine(p));
      return { pass: false, evidence, detail: 'a promote happened despite the kill switch' };
    }
    const ticks = bundle.timeline ?? [];
    const last = ticks[ticks.length - 1];
    const survivors = (last?.agents ?? []).filter((a) => a.isWorkerOf);
    if (survivors.length > 0) {
      evidence.push(`last tick ${last.ts} still lists: ${survivors.map((a) => a.name).join(', ')}`);
      return { pass: false, evidence, detail: `${survivors.length} worker(s) still live after the kill switch` };
    }
    evidence.push('last tick lists no live worker of this run');
    return { pass: true, evidence, detail: 'every worker left the timeline and nothing was promoted' };
  });
}

// The timeline never shows more than n of this run's workers live at once (DESIGN §2.4, the ceiling).
// Caveat (T08 FINDINGS 2026-09-09): a review handoff can transiently list implementer+reviewer =
// ceiling+1 because `claude stop` is async, so a scenario that samples through a handoff passes
// ceilingHeld(ceiling+1) rather than the bare ceiling if it wants to tolerate that transient.
export function ceilingHeld(n) {
  return fact(`ceiling-held:${n}`, `At most ${n} workers live at once`, (bundle) => {
    const evidence = [];
    let max = 0;
    let worstTick = null;
    for (const tick of bundle.timeline ?? []) {
      const live = (tick.agents ?? []).filter((a) => a.isWorkerOf).length;
      if (live > max) {
        max = live;
        worstTick = tick;
      }
    }
    if (worstTick) {
      evidence.push(`peak ${max} live worker(s) at ${worstTick.ts}: ${worstTick.agents.filter((a) => a.isWorkerOf).map((a) => a.name).join(', ')}`);
    }
    if (max > n) {
      return { pass: false, evidence, detail: `peak of ${max} live workers exceeds the ceiling of ${n}` };
    }
    return { pass: true, evidence, detail: `peak of ${max} live worker(s), within the ceiling of ${n}` };
  });
}

// --- Running a scenario's facts and rendering the verdict ----------------------------------------

// checkScenario(spec, bundle) → { scenario, pass, facts:[{ id, label, pass, evidence, detail }] }. Runs
// every declared fact over the one bundle; the scenario passes only if every fact passes (one failing
// fact fails the scenario). A fact whose check throws is reported failed, never allowed to abort the
// run — a bad predicate must not hide the others' verdicts.
export function checkScenario(spec, bundle) {
  const facts = (spec.facts ?? []).map((f) => {
    let r;
    try {
      r = f.check(bundle);
    } catch (e) {
      r = { pass: false, evidence: [], detail: `fact threw: ${e?.message ?? e}` };
    }
    return { id: f.id, label: f.label, pass: !!r.pass, evidence: r.evidence ?? [], detail: r.detail ?? '' };
  });
  return { scenario: spec.id, pass: facts.every((f) => f.pass), facts };
}

// formatReport(report) → a plain multi-line string for a person: a PASS/FAIL header, then one line per
// fact with its verdict and detail, and the evidence indented under a failing fact so the reader can
// see the data that broke it. Pure — returns the string, prints nothing.
export function formatReport(report) {
  const lines = [];
  const mark = report.pass ? 'PASS' : 'FAIL';
  lines.push(`[${mark}] scenario: ${report.scenario}`);
  for (const f of report.facts) {
    lines.push(`  ${f.pass ? '✓' : '✗'} ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    if (!f.pass) {
      for (const e of f.evidence) lines.push(`      · ${e}`);
    }
  }
  return lines.join('\n');
}
