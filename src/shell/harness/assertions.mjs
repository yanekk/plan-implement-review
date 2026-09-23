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
//               (open-feature, spawn, await-idle, review, merge, close, halt-close, surface, rebuild,
//               cleanup, restart), the rest is a task id (T05), a branch, or free text. The down-channel
//               types (answer, send-failed) and the promote type went with the relay and the promotion
//               (DESIGN §2.2, §2.4, T05). The spawn `hello` was retired in T30. The line does NOT carry a
//               surface's KIND (conflict/question/decision) — loop.mjs writes only type+task — so the
//               parked/conflict facts key on the TASK id a scenario names (see parkedWorkerHoldsSlot /
//               mergeConflictResolved).
//   timeline  — [{ ts, agents:[{ name, sessionId, cwd, status, state, isWorkerOf, isCoordinator }] }]
//               one sampled `agents --json` per tick. status is live-only, so a busy→idle transition
//               proves the idle-gated close (DESIGN §2.3); a session absent from a tick has ended.
//               isCoordinator is always false: the coordinator is a plain process, never in the list (§2.9).
//   final     — the resting-state `agents --json --all` snapshot.
//   manifest  — { <agent name>: { sessionId, cwd, role, copied, copiedTo } }, keyed by name; a name
//               that recurs (implementer then its fresh reviewer) is keyed `name (sessionId)` (T14).
//   gitLog    — `git log --oneline --graph --all` text of the scratch repo.
//   transcripts (added here) — [{ key, name, role, task, sessionId, events }] parsed from the copied
//               .jsonl files. A worker's SendMessage is an assistant tool_use carrying { to, summary,
//               message } (confirmed against the real T10 worker transcript 2026-09-10). No fact reads a
//               coordinator transcript any more — mergeConflictResolved's supporting read of one went with
//               the down-channel it described (§2.2, T05); the facts key on the flow log and the timeline.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentName } from '../../core/naming.mjs';

// --- Small pure helpers over a bundle ------------------------------------------------------------

// A messaging name may arrive with a trailing ` [ref]` disambiguator (SendMessage shows one when two
// listings collide, e.g. "pir-t10 · scratch [54afd5]"). It is not part of the addressable name, so it
// is stripped before any name comparison.
function stripRef(name) {
  return String(name ?? '').replace(/\s*\[[0-9a-fA-F]+\]\s*$/, '').trim();
}

// Reconstruct a flow line for evidence, in the on-disk shape a person would grep.
function flowLine(e) {
  return [e.ts, e.type, e.rest].filter((s) => s != null && s !== '').join(' ');
}

const flowOf = (bundle, type) => (bundle.flow ?? []).filter((e) => e.type === type);

// runIdentity(bundle) → { repo, plan, coordName }. The repo and plan the run belongs to, read from the
// agent names (DESIGN §2.9) so they cannot drift from bookkeeping. There is no coordinator session any
// more (§2.1, §2.9), so the identity is read from a WORKER's name — every worker of the run carries the
// repo and plan. coordName is kept in the shape (as null when no coordinator is present) for the older
// canned-bundle facts that still look for one; a legacy bundle that tagged a coordinator is still read
// first, so those facts keep working. A live bundle (workers only) falls through to the worker read.
export function runIdentity(bundle) {
  // Legacy: a bundle that still carries a tagged coordinator (canned test data) — read it first.
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
  // The live path: derive repo/plan from any worker of the run. There is no coordinator name to resolve.
  for (const tick of bundle.timeline ?? []) {
    for (const a of tick.agents ?? []) {
      if (a.isWorkerOf && a.name) {
        const p = parseAgentName(a.name);
        if (p.matches) return { repo: p.repo, plan: p.plan, coordName: null };
      }
    }
  }
  for (const t of bundle.transcripts ?? []) {
    if (t.role === 'worker' && t.name) {
      const p = parseAgentName(t.name);
      if (p.matches) return { repo: p.repo, plan: p.plan, coordName: null };
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

// loadFinalFiles(bundle, { readFile }) → a new bundle with `finalFiles` attached, read from the bundle's
// `final-files.json` (a { path: content } map the runner writes at seal by reading `git show main:path`
// on the scratch repo). Like loadTranscripts, it is a one-shot loader done before the predicates run, so
// a fact stays pure. A missing or malformed file yields {} rather than throwing — a fact then reports
// "no captured final content" from data. Used by mergeConflictResolved to prove the decided side shipped.
export function loadFinalFiles(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let finalFiles = {};
  try {
    const parsed = JSON.parse(readFile(join(bundle.dir, 'final-files.json')));
    if (parsed && typeof parsed === 'object') finalFiles = parsed;
  } catch {
    finalFiles = {};
  }
  return { ...bundle, finalFiles };
}

// loadControlFeeds(bundle, { readFile }) → a new bundle with `controlFeeds` attached, read from the
// bundle's `control-feeds.json` (written by the restart runner, T06). It records a stale sentinel the
// runner seeded into every transient control feed in the gap between the SIGKILL and the relaunch — the
// exact leftover a dead run would strand — and the feeds' contents AFTER the resumed run, so feedsCleared
// can prove the restart hygiene (DESIGN §2.7) truncated them. Shape:
//   { seeded: bool, sentinel: string, feeds: { answers, outbox, surfaced: string, reports: [names] } }
// Like the other loaders it is one-shot, done before the pure predicates run; a missing or malformed file
// yields { seeded:false } so feedsCleared reports "clearing unproven" from data rather than throwing. Only
// the restart scenario writes this file; every other scenario simply has no controlFeeds.
export function loadControlFeeds(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let controlFeeds = { seeded: false };
  try {
    const parsed = JSON.parse(readFile(join(bundle.dir, 'control-feeds.json')));
    if (parsed && typeof parsed === 'object') controlFeeds = parsed;
  } catch {
    controlFeeds = { seeded: false };
  }
  return { ...bundle, controlFeeds };
}

// loadRestartPoint(bundle, { readFile }) → a new bundle with `restartPoint` attached, read from the
// bundle's `restart-point.json` (written by the restart runner between the two runs): the crash-point
// task's branch head and committed glyph as the restart found them, and the signal that ended the first
// run. `{ task, head, glyph, signal }`, or null when the run never reached its crash point.
export function loadRestartPoint(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let restartPoint = null;
  try {
    const parsed = JSON.parse(readFile(join(bundle.dir, 'restart-point.json')));
    if (parsed && typeof parsed === 'object') restartPoint = parsed;
  } catch {
    restartPoint = null;
  }
  return { ...bundle, restartPoint };
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

// --- Fact construction ---------------------------------------------------------------------------
//
// A fact-builder returns { id, label, check(bundle) → { pass, evidence, detail } }. `check` is the pure
// predicate; `label` is for the printer. `evidence` is the bundle lines/events that decided the verdict
// (present on pass and fail alike, so a failure points at the data). `detail` is one human sentence.

function fact(id, label, check) {
  return { id, label, check };
}

// The run opened no spawn hello at all (DESIGN §2.2, T30). The spawn ping was retired — it was proven
// non-load-bearing (T23: both hellos failed to send yet both workers built from the spawn prompt) and
// its down-channel-open rationale was already gone after T25 — so a correct run's flow log contains ZERO
// `hello` lines. This asserts the retirement POSITIVELY (rather than dropping the old check): a `hello`
// line present is a regression. It also requires the run to have actually done something (a spawn or a
// review), so the pass is never vacuous — "no hello" over an empty flow proves nothing.
export function noHelloEver() {
  return fact('no-hello-ever', 'The flow log contains no hello line (the spawn hello is retired)', (bundle) => {
    const evidence = [];
    const spawns = (bundle.flow ?? []).filter((e) => e.type === 'spawn' || e.type === 'review');
    const hellos = flowOf(bundle, 'hello');
    for (const e of spawns) evidence.push(flowLine(e));
    for (const h of hellos) evidence.push(flowLine(h));

    if (spawns.length === 0) {
      return { pass: false, evidence, detail: 'no spawn/review actions in the flow — nothing ran, so "no hello" is vacuous' };
    }
    if (hellos.length > 0) {
      return { pass: false, evidence, detail: `${hellos.length} hello line(s) in the flow — the spawn hello was not retired` };
    }
    return { pass: true, evidence, detail: `${spawns.length} spawn/review action(s) and zero hello lines — the spawn hello is retired` };
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


// A worker that asked the person PARKED and held its slot, and the program routed nothing down while
// every independent task kept moving (DESIGN §2.2, §2.8). This REPLACES the old questionRoundTrip fact,
// which asserted the coordinator relayed an answer DOWN to the worker (surface → answer → resume). That
// down-channel is gone: the person answers a blocked worker directly in its own session, and the program
// routes nothing (§2.2). So the load-bearing property is no longer "the answer came back" but "the park
// costs only that one task": it reads off the bundle
//   - a `surface {task}` line (the worker asked — a question or a decision, the loop records both);
//   - the parked worker of `task` still sampled LIVE in the timeline at/after it surfaced (it held its
//     slot — a parked worker is alive, not closed, DESIGN §2.8);
//   - NO `answer` flow line anywhere (the program delivered no decision down — the whole down-channel is
//     removed, §2.2; an `answer` line would be the old relay resurfacing);
//   - at least one OTHER task reaching `merge` while this one is parked (the park throttles only its own
//     decision, every independent task keeps moving, §2.8).
// A run where the parked worker was closed, or an answer was routed, or the park stalled the others,
// reddens it — which is what makes the fact distinguish the non-agentic park from the old relay.
export function parkedWorkerHoldsSlot(task) {
  return fact(`parked-worker-holds-slot:${task}`, `${task} parked on the person, held its slot, and the program routed nothing`, (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'surface').filter((e) => e.rest === task);
    if (surfaces.length === 0) {
      return { pass: false, evidence, detail: `no surface for ${task} — it never asked the person` };
    }
    const surfaceTs = surfaces[0].ts;
    evidence.push(flowLine(surfaces[0]));

    // The program routes nothing down: an `answer` flow line would be the old relay (§2.2). None may exist.
    const answers = flowOf(bundle, 'answer');
    for (const a of answers) evidence.push(flowLine(a));
    if (answers.length > 0) {
      return { pass: false, evidence, detail: `${answers.length} answer line(s) — the program routed a decision down, which the non-agentic model never does (§2.2)` };
    }

    // The parked worker held its slot: still sampled live at or after it surfaced (not closed while parked).
    const seenAfter = (bundle.timeline ?? []).some(
      (tick) => tick.ts >= surfaceTs && (tick.agents ?? []).some((a) => a.isWorkerOf && parseAgentName(a.name).task === task),
    );
    if (!seenAfter) {
      return { pass: false, evidence, detail: `${task}'s worker was not sampled live after it surfaced — its slot was not held` };
    }
    evidence.push(`${task}'s worker still live after it surfaced (slot held)`);

    // Every independent task kept moving: at least one OTHER task merged while this one parked.
    const otherMerges = flowOf(bundle, 'merge').filter((e) => /^T\d+$/.test(e.rest) && e.rest !== task);
    for (const m of otherMerges) evidence.push(flowLine(m));
    if (otherMerges.length === 0) {
      return { pass: false, evidence, detail: `no other task merged while ${task} was parked — the park stalled the run instead of costing only ${task}` };
    }
    return { pass: true, evidence, detail: `${task} parked and held its slot; no answer was routed and ${otherMerges.length} other task(s) still merged` };
  });
}

// A worker-introduced task was ADOPTED at merge and then DISPATCHED and merged (DESIGN §2.2, §2.4). This
// is the automated proof of the dynamic-task path's TAIL: a worker added a new task on its own branch, the
// coordinator folded that row into the feature plan when the branch merged (record('adopt', {task}),
// loop.mjs recordAdoption), and then dispatched the adopted task on a later pass (a `spawn`) and merged its
// finished branch. The HEAD of the path — that a REAL worker escalated for approval BEFORE adding, and
// wrote a well-formed addition — is the person-only judgement the drill hands over (DESIGN §5.1), not
// anything the flow log carries; this fact proves only the mechanical tail the log does carry.
//
// It is task-AGNOSTIC: which T-number the live worker picks for the new task (the next free one) is decided
// at run time, so the fact DISCOVERS the adopted task from the `adopt` line rather than naming it, the same
// way mergeConflictResolved discovers the conflicting task. It reads off the bundle:
//   - an `adopt {task}` flow line (the coordinator folded a worker-introduced row into the feature plan);
//   - a `spawn {task}` line AT OR AFTER the adopt (the adopted task was dispatched to a real worker — the
//     crux: an adopted row that never dispatches is a task silently never built, §2.5);
//   - a `merge {task}` line at or after that spawn (the dispatched task built, was reviewed and its branch
//     landed — so the pass is never vacuous over a run that adopted a row but never carried it through).
// A run that adopted nothing, or adopted a row it never dispatched, or never merged the dispatched task,
// reddens it — which is what makes the fact prove the whole adopt→dispatch→merge tail, not just the fold.
export function adoptedAndDispatched() {
  return fact('adopted-and-dispatched', 'A worker-introduced task was adopted at merge, then dispatched and merged', (bundle) => {
    const evidence = [];
    const adopts = flowOf(bundle, 'adopt').filter((e) => /^T\d+$/.test(e.rest));
    if (adopts.length === 0) {
      return { pass: false, evidence, detail: 'no adopt line — no worker-introduced task was folded into the plan' };
    }
    const spawns = flowOf(bundle, 'spawn');
    const merges = flowOf(bundle, 'merge');
    // A worker may add more than one task; the path passes if ANY adopted task completed adopt→dispatch→merge.
    for (const adopt of adopts) {
      const task = adopt.rest;
      const spawnedAfter = spawns.find((s) => s.rest === task && s.ts >= adopt.ts);
      const mergedAfter = spawnedAfter && merges.find((m) => m.rest === task && m.ts >= spawnedAfter.ts);
      if (spawnedAfter && mergedAfter) {
        evidence.push(flowLine(adopt), flowLine(spawnedAfter), flowLine(mergedAfter));
        return { pass: true, evidence, detail: `${task} was adopted, dispatched and merged — the introduced task ran through` };
      }
    }
    // None completed the tail: report the first adopted task with the step it did not reach.
    const first = adopts[0];
    const task = first.rest;
    evidence.push(flowLine(first));
    const spawnedAfter = spawns.find((s) => s.rest === task && s.ts >= first.ts);
    if (!spawnedAfter) {
      for (const s of spawns.filter((s) => s.rest === task)) evidence.push(flowLine(s));
      return { pass: false, evidence, detail: `${task} was adopted but never dispatched after it — the adopted task was silently never built (§2.5)` };
    }
    evidence.push(flowLine(spawnedAfter));
    for (const m of merges.filter((m) => m.rest === task)) evidence.push(flowLine(m));
    return { pass: false, evidence, detail: `${task} was adopted and dispatched but its branch never merged — the introduced task did not land` };
  });
}

// A coordinator-hit merge conflict was RESOLVED in the non-agentic, ATTENDED model (DESIGN §2.8, §2.2):
// the coordinator kept the conflicting worker alive and parked (it never closed it or merged past it) and
// offered a ready-to-paste resolution prompt (T14). There is no down-channel and no `answer()` any more
// (§2.2, T05), so no decision is routed — a PERSON attaches to that worker directly and pastes it. The
// worker merges the feature branch into its own branch, resolves keeping the decided side, commits and
// re-signals done; the coordinator's next pass merges its now-clean branch and the run HANDS OFF the green
// feature branch (§2.4 — it never merges to main). This REPLACES the old down-channel shape, which
// required an `answer {task}` flow line and a `promote` to main — both gone with the relay and the
// promotion (T05), which is why the old fact could never go green again (FINDINGS 2026-09-20). The fact is
// task-AGNOSTIC: which of the two same-line tasks merges second — and so conflicts — is a timing race (T16
// 2026-09-11), so it finds the task that took the resolution shape rather than naming it. The flow line
// does NOT carry a surface's kind (loop.mjs writes type+task only — see WHAT A BUNDLE CARRIES), so like
// parkedWorkerHoldsSlot it keys on the task id, not on `kind: conflict`. It reads off the bundle:
//   - a `surface` for that task, with NO `merge` of it BEFORE the surface (the conflict was caught,
//     nothing bad merged first);
//   - a `merge {task}` AFTER the surface (the same worker resumed and its now-clean branch merged), with
//     NO `answer` line required — the person, not a routed answer, drove the resolution (§2.2);
//   - exactly ONE implement session for the task in the timeline (no respawn — the T22 clobber spawned a
//     second implementer; this mirrors resumedNotRebuilt's no-respawn check);
//   - the run handed off a green feature branch (composed with handedOffGreenBranch: ZERO promote, NO merge
//     of pir/{plan} into main, ≥1 `merge T{nn}` on the feature branch);
//   - and, when the caller passes { file, content }, the handed-off feature branch's content of that file
//     (bundle.finalFiles, captured by the runner from `pir/{slug}`: loadFinalFiles) matches the DECIDED
//     side. This is the crux of the old T22 regression — the branch must read "hello there", not "hi world".
export function mergeConflictResolved({ file, content } = {}) {
  return fact('merge-conflict-resolved', 'A coordinator-hit conflict was kept alive, resolved by a person on the live worker, and the decided side was handed off', (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'surface').filter((e) => /^T\d+$/.test(e.rest));
    if (surfaces.length === 0) {
      return { pass: false, evidence, detail: 'no task surface — a merge conflict was expected to be surfaced' };
    }
    const merges = flowOf(bundle, 'merge');

    // Find the surfaced task that took the resolution path: surfaced, not merged before, and then merged.
    // No `answer` line is required — the down-channel is gone (§2.2); the person, not a routed answer,
    // drove the resolution. Which task conflicts is a race, so the fact discovers it rather than naming it.
    let resolved = null;
    for (const s of surfaces) {
      const task = s.rest;
      const mergedBefore = merges.find((m) => m.rest === task && m.ts < s.ts);
      const mergedAfter = merges.find((m) => m.rest === task && m.ts >= s.ts);
      if (!mergedBefore && mergedAfter) {
        resolved = { task, surface: s, mergedAfter };
        break;
      }
    }
    if (!resolved) {
      for (const s of surfaces) evidence.push(flowLine(s));
      for (const m of merges) evidence.push(flowLine(m));
      return {
        pass: false,
        evidence,
        detail: 'no surfaced task was later merged — the conflict was not resolved on the live worker and the branch never landed',
      };
    }
    const { task } = resolved;
    evidence.push(flowLine(resolved.surface));
    evidence.push(flowLine(resolved.mergedAfter));

    // No respawn: exactly one implement-role session ran the conflicting task (mirrors resumedNotRebuilt).
    // The T22 clobber closed the done worker and spawned a SECOND implementer over the same task. Counted
    // from distinct session ids in the timeline; 0 (the phase was never sampled) cannot prove a respawn, so
    // only >1 fails.
    const implSids = new Set();
    for (const tick of bundle.timeline ?? []) {
      for (const a of tick.agents ?? []) {
        const p = parseAgentName(a.name);
        if (a.isWorkerOf && p.task === task && p.role === 'implement' && a.sessionId) implSids.add(a.sessionId);
      }
    }
    if (implSids.size > 1) {
      evidence.push(`implement sessions for ${task}: ${implSids.size}`);
      return { pass: false, evidence, detail: `${task} was built by ${implSids.size} implement sessions — it was respawned (the T22 clobber)` };
    }

    // The run handed off a green feature branch: zero promote, no merge to main, ≥1 task merge. Composed
    // with handedOffGreenBranch so the two facts cannot drift — the resolution must END in a hand-off, not
    // the removed promotion (§2.4). Its evidence lines are folded in without duplicating the merge already
    // shown above.
    const handoff = handedOffGreenBranch().check(bundle);
    for (const e of handoff.evidence) if (!evidence.includes(e)) evidence.push(e);
    if (!handoff.pass) {
      return { pass: false, evidence, detail: `the run did not hand off a green feature branch: ${handoff.detail}` };
    }

    // The DECIDED side won: the handed-off feature branch's content of the contested file matches the
    // decision, not the losing side. This is the old T22 regression, so it is the fact's sharpest assertion.
    if (file) {
      const got = (bundle.finalFiles ?? {})[file];
      if (got == null) {
        return { pass: false, evidence, detail: `no captured final content for ${file} — cannot confirm the decided side won (runner did not capture it)` };
      }
      if (String(got).trim() !== String(content).trim()) {
        evidence.push(`feature-branch:${file} = ${JSON.stringify(String(got).trim())}`);
        return { pass: false, evidence, detail: `final ${file} is ${JSON.stringify(String(got).trim())}, not the decided ${JSON.stringify(String(content).trim())} — the losing side shipped` };
      }
      evidence.push(`feature-branch:${file} = ${JSON.stringify(String(got).trim())} (the decided side)`);
    }

    return { pass: true, evidence, detail: `${task}'s conflict was surfaced, resolved by the live worker without a routed answer, and the decided side merged and handed off` };
  });
}

// The git-log lines that are a PROMOTION of the feature branch into main. Git's default message for
// merging `pir/{plan}` into main is exactly `Merge branch 'pir/{plan}'`. But a dependent-task worker
// brings the feature branch INTO its own task branch before signalling done (pir-worker "bring your
// branch up to date"), and git labels THAT merge `Merge branch 'pir/{plan}' into pir/{plan}-T{nn}` —
// same prefix, never touches main. So match the needle but drop the ` into ` integration merges, or a
// correct one-promotion run false-reads as two (observed on the review-queue after-run, 2026-09-13).
function promotionMergeLines(gitLog, plan) {
  const needle = `Merge branch 'pir/${plan}'`;
  return (gitLog ?? '').split('\n').filter((l) => l.includes(needle) && !l.includes(`${needle} into `));
}

// The run ended by handing off a green feature branch, main untouched (DESIGN §2.4). This plan removed
// promotion: the command never merges to main — it stops at a green `pir/{plan}` and prints
// `git merge pir/{slug}` for the person. This REPLACES oneMergeToMain, which asserted the removed
// promotion (one `promote` flow line + one `Merge branch 'pir/{plan}'` into main). Under the new model
// both signals are wrong: a correct run logs ZERO promotes and leaves main at the fixture seed. So the
// fact inverts the old one — it reads off the bundle:
//   - ZERO `promote` flow lines (a promote is the coordinator touching main, the removed model);
//   - NO promotion merge `Merge branch 'pir/{plan}'` into main in the git log (promotionMergeLines: the
//     same needle the promotion used, minus the ` into ` integration merges a dependent worker makes on
//     its own task branch — so a correct hand-off reads zero, not a false positive from an integration);
//   - at least one `merge {task}` flow line — the plan WAS assembled on the feature branch, so the pass
//     is never vacuous over a run that merged nothing.
// The printed `git merge` hand-off line is NOT checkable here: run.mjs launches the coordinator with
// stdio ignored, so the bundle never captures the coordinator's stdout (FINDINGS). Assert from the flow
// log and git only.
export function handedOffGreenBranch() {
  return fact('handed-off-green-branch', 'The run handed off a green feature branch and left main untouched (§2.4)', (bundle) => {
    const evidence = [];
    // No promotion: a `promote` flow line would be the coordinator merging to main (the removed model).
    const promotes = flowOf(bundle, 'promote');
    for (const p of promotes) evidence.push(flowLine(p));
    if (promotes.length > 0) {
      return { pass: false, evidence, detail: `${promotes.length} promote line(s) in the flow — the run merged to main, which §2.4 removed` };
    }
    // main gained nothing beyond the seed: no promotion merge of the feature branch into main.
    const { plan } = runIdentity(bundle);
    if (plan) {
      const promoMerges = promotionMergeLines(bundle.gitLog, plan);
      for (const l of promoMerges) evidence.push(l.trim());
      if (promoMerges.length > 0) {
        return { pass: false, evidence, detail: `git log shows ${promoMerges.length} promotion merge(s) of pir/${plan} into main — main was not left untouched` };
      }
      evidence.push('git log: no promotion merge into main');
    }
    // The plan was assembled on the feature branch: at least one task merged there (a non-vacuous pass).
    const taskMerges = flowOf(bundle, 'merge').filter((e) => /^T\d+$/.test(e.rest));
    for (const m of taskMerges) evidence.push(flowLine(m));
    if (taskMerges.length === 0) {
      return { pass: false, evidence, detail: 'no task merged into the feature branch — nothing was assembled, so the hand-off is vacuous' };
    }
    return { pass: true, evidence, detail: `${taskMerges.length} task merge(s) on the feature branch, zero promotes, main untouched — a clean hand-off` };
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

// slotsInTick(agents) → the number of worker SLOTS live in one timeline tick (DESIGN §2.4 the ceiling;
// §2.1 a task in review holds one slot, not two). Group this run's live workers by task: a task's
// implement+review overlap is ONE slot (the loop closes the implementer as its reviewer spawns, but the
// stopped session lingers in `claude agents --json` for a sample — T08 FINDINGS 2026-09-09 — so counting
// raw sessions would read ceiling+1 on a legit handoff). An EXTRA same-role session on a task is a
// respawn runaway and adds a slot; a worker that does not parse to a task is its own slot, keyed by name
// so it is never silently merged away. Shared by ceilingHeld and leftoverSessionsReaped so both count the
// ceiling the one way.
function slotsInTick(agents) {
  const live = (agents ?? []).filter((a) => a.isWorkerOf);
  const byTask = new Map();
  for (const a of live) {
    const key = parseAgentName(a.name).task ?? `?${a.name}`;
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(a);
  }
  let slots = 0;
  for (const group of byTask.values()) {
    const roles = new Set(group.map((a) => parseAgentName(a.name).role ?? '?'));
    slots += 1 + Math.max(0, group.length - roles.size);
  }
  return slots;
}

// The timeline never shows more than n worker SLOTS in flight at once (DESIGN §2.4 the ceiling; §2.1
// a task in review holds one slot, not two). Counting raw worker sessions over-counts a review
// handoff: the loop closes the implementer AS the fresh reviewer spawns (loop.mjs 3c/3e), but
// `claude stop` is async so the stopped implementer lingers in `claude agents --json` for a ~2s
// sample beside its reviewer (T08 FINDINGS 2026-09-09). A single handoff then reads ceiling+1 and two
// overlapping handoffs ceiling+2 — a FALSE fail, not a real breach: the loop's own `closedIds` count
// (loop.mjs) never recounted the stopped session, so the true ceiling held (clean-merge 2026-09-13).
//
// So count by task, not by session: a task's implement+review overlap is ONE slot. Grouping also keeps
// the runaway honest — the 2026-09-09 runaway spawned DUPLICATE same-role sessions for one task, so an
// extra session of a role already present on a task adds a slot, and N over-provisioned real workers
// still exceed n. (A duplicate is a genuine second paid agent; a stopped-but-listed implementer is not,
// and it never shares its reviewer's role.) Fixtures assert the bare true ceiling, no ceiling+1 fudge.
export function ceilingHeld(n) {
  return fact(`ceiling-held:${n}`, `At most ${n} worker slots in flight at once`, (bundle) => {
    const evidence = [];
    let max = 0;
    let worstTick = null;
    for (const tick of bundle.timeline ?? []) {
      const slots = slotsInTick(tick.agents);
      if (slots > max) {
        max = slots;
        worstTick = tick;
      }
    }
    if (worstTick) {
      evidence.push(`peak ${max} slot(s) at ${worstTick.ts}: ${worstTick.agents.filter((a) => a.isWorkerOf).map((a) => a.name).join(', ')}`);
    }
    if (max > n) {
      return { pass: false, evidence, detail: `peak of ${max} worker slots exceeds the ceiling of ${n}` };
    }
    return { pass: true, evidence, detail: `peak of ${max} worker slot(s) in flight, within the ceiling of ${n}` };
  });
}

// The timeline DID show at least n task IMPLEMENTERS building at the same time (DESIGN §2.4, §4.1, T36).
// This is the LOWER bound ceilingHeld never proves: ceilingHeld(n) proves the run never exceeded n slots,
// but a plan built one task at a time passes it trivially — nothing before this proved work actually ran
// in parallel, which is the whole point of the coordinator. reachedWidth(n) is that proof: PASS iff some
// single timeline tick shows at least n DISTINCT tasks whose implement-role worker is busy at once.
//
// It counts by task, mirroring ceilingHeld's grouping: two roster rows for one task (a respawn, or a
// stopped session lingering beside its successor) are one task, not two, so a duplicate can never inflate
// the width. It counts implementers only — a reviewer is a follow-on session,
// not a build running in parallel, so their roles are excluded. Keyed on the worker→task mapping already
// in the timeline agent name (§2.8), so it cannot drift from bookkeeping.
//
// STRICT on purpose: a PASS must mean the builds genuinely overlapped, so an implementer counts only while
// its live `status` is `busy` (working this tick). An idle-but-listed implementer — one that has gone
// quiet or is a stopped session still in the roster — is not a build in flight and does not count toward
// the width, the opposite bias to ceilingHeld (which counts it, to catch a runaway from above).
export function reachedWidth(n) {
  return fact(`reached-width:${n}`, `At least ${n} task implementers built at once`, (bundle) => {
    const evidence = [];
    let max = 0;
    let best = null;
    for (const tick of bundle.timeline ?? []) {
      const tasks = new Set();
      for (const a of tick.agents ?? []) {
        if (!a.isWorkerOf) continue;
        const p = parseAgentName(a.name);
        if (p.role !== 'implement') continue; // a reviewer is not a build in flight
        if (a.status !== 'busy') continue; // only a session working this tick counts (§4.1, strict lower bound)
        if (p.task) tasks.add(p.task);
      }
      if (tasks.size > max) {
        max = tasks.size;
        best = { ts: tick.ts, tasks: [...tasks] };
      }
    }
    if (best) {
      evidence.push(`peak ${max} implementer(s) building at ${best.ts}: ${best.tasks.join(', ')}`);
    }
    if (max < n) {
      return { pass: false, evidence, detail: `peak of ${max} implementer(s) built at once, below the required width of ${n}` };
    }
    return { pass: true, evidence, detail: `${max} task implementer(s) built concurrently, meeting the width of ${n}` };
  });
}

// --- Restart facts (DESIGN §2, §4, T06) ----------------------------------------------------------
//
// A restart run's captured bundle spans BOTH coordinator launches: one flow log the coordinator appends
// to across the crash (the harness never truncates it), and one timeline the capture keeps sampling
// through the kill and the relaunch. startupControlHygiene appends a `restart` marker to the flow on every
// startup (coordinate.mjs §2.7), so a crash-and-restart run carries TWO `restart` markers — the second is
// the boundary between the dead run and the resumed one, and the restart facts read the flow on each side
// of it. Fewer than two markers means the run never actually restarted, so each fact fails rather than
// passing vacuously.

// restartBoundary(bundle) → the ISO ts of the LAST `restart` marker (the resumed run's hygiene), or null
// if the run did not restart (fewer than two markers). Timestamps are the coordinator's own ISO strings,
// so comparing them lexicographically orders the flow correctly.
function restartBoundary(bundle) {
  const restarts = flowOf(bundle, 'restart');
  return restarts.length >= 2 ? restarts[restarts.length - 1].ts : null;
}

// implementSessionIds(bundle, task) → the distinct session ids that ran `task` as an IMPLEMENTER across
// the whole run. More than one means the task was re-implemented (a second build spawned over it), the
// signature of a rebuild where a resume was expected. Read from the timeline agent names (§2.8), which
// carry the role, so it cannot drift from bookkeeping.
function implementSessionIds(bundle, task) {
  const ids = new Set();
  for (const tick of bundle.timeline ?? []) {
    for (const a of tick.agents ?? []) {
      const p = parseAgentName(a.name);
      if (a.isWorkerOf && p.task === task && p.role === 'implement' && a.sessionId) ids.add(a.sessionId);
    }
  }
  return ids;
}

// The 🔍 task the crash caught was RESUMED, not rebuilt (DESIGN §2.5, T06). After the restart the resumed
// coordinator adopts the committed-🔍 task branch to a fresh reviewer and merges it — it never re-runs the
// implementer from the task doc. Proven from the bundle: the run actually restarted (two `restart`
// markers); no `rebuild {task}` line anywhere; exactly one implement-role session for the task in the
// whole timeline (a second build would be a re-implement); and a `merge {task}` after the boundary (the
// resume landed it). A rebuild run — a `rebuild {task}` line and a second implementer — reddens this,
// which is what makes the fact distinguish resume from rebuild (T06 done-when).
export function resumedNotRebuilt(task) {
  return fact(`resumed-not-rebuilt:${task}`, `${task}'s 🔍 branch was adopted and merged, not rebuilt`, (bundle) => {
    const evidence = [];
    const boundary = restartBoundary(bundle);
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (!boundary) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers) — resume is unproven' };
    }
    const rebuilds = flowOf(bundle, 'rebuild').filter((e) => e.rest === task);
    if (rebuilds.length > 0) {
      for (const r of rebuilds) evidence.push(flowLine(r));
      return { pass: false, evidence, detail: `${task} was rebuilt (a rebuild line) — the resume re-implemented it instead of adopting` };
    }
    const impl = implementSessionIds(bundle, task);
    if (impl.size > 1) {
      evidence.push(`implement sessions for ${task}: ${impl.size}`);
      return { pass: false, evidence, detail: `${task} was built by ${impl.size} implement sessions — it was re-implemented, not resumed` };
    }
    const reviewed = flowOf(bundle, 'review').find((e) => e.rest === task && e.ts >= boundary);
    if (reviewed) evidence.push(flowLine(reviewed));
    const mergedAfter = flowOf(bundle, 'merge').find((e) => e.rest === task && e.ts >= boundary);
    if (!mergedAfter) {
      return { pass: false, evidence, detail: `${task} never merged after the restart — the resume did not land the adopted branch` };
    }
    evidence.push(flowLine(mergedAfter));
    return { pass: true, evidence, detail: `${task} was adopted after the restart and merged, with one implement session — resumed, not rebuilt` };
  });
}

// A task already ✅+merged before the crash is LEFT ALONE by the restart (DESIGN §2.5, T06). decideResume
// skips a feature-✅ task, so the resumed coordinator neither rebuilds nor re-reviews nor re-merges it.
// Proven from the bundle: the run restarted (two markers); the task merged BEFORE the boundary (it was
// finished pre-crash — else "not rebuilt after" is unprovable); and after the boundary there is no
// `rebuild`, `spawn`, `review` or `merge` of it, and no more than one implement session for it across the
// whole run. A resume that wrongly re-dispatched the done task — a `spawn {task}` or a second implementer
// after the boundary — reddens it.
export function noRebuildFrom(task) {
  return fact(`no-rebuild-from:${task}`, `the already-done ${task} was not rebuilt after the restart`, (bundle) => {
    const evidence = [];
    const boundary = restartBoundary(bundle);
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (!boundary) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers) — nothing to prove' };
    }
    const mergedBefore = flowOf(bundle, 'merge').find((e) => e.rest === task && e.ts < boundary);
    if (!mergedBefore) {
      return { pass: false, evidence, detail: `${task} was not merged before the restart — cannot prove it was left alone (it was never finished)` };
    }
    evidence.push(flowLine(mergedBefore));
    for (const type of ['rebuild', 'spawn', 'review', 'merge']) {
      const after = flowOf(bundle, type).find((e) => e.rest === task && e.ts >= boundary);
      if (after) {
        evidence.push(flowLine(after));
        return { pass: false, evidence, detail: `${task} was ${type}d after the restart — the done task was not left alone` };
      }
    }
    const impl = implementSessionIds(bundle, task);
    if (impl.size > 1) {
      evidence.push(`implement sessions for ${task}: ${impl.size}`);
      return { pass: false, evidence, detail: `${task} was built by ${impl.size} implement sessions — the done task was re-implemented` };
    }
    return { pass: true, evidence, detail: `${task} merged before the restart and was untouched after it — not rebuilt` };
  });
}

// The first run was STOPPED, not crashed: its own teardown ran before the restart. That teardown is the
// exit path that used to remove every task branch (the ENOSPC loss, 2026-09-22), so a resume fact over a
// SIGKILL'd run never exercised it. Proven from the flow log: a `teardown:` line before the restart
// boundary (teardownRun logs one per worker it closes), and the runner recorded a non-SIGKILL signal.
export function stoppedGracefully() {
  return fact('stopped-gracefully', 'the first run was stopped and its own teardown ran before the restart', (bundle) => {
    const evidence = [];
    const boundary = restartBoundary(bundle);
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (!boundary) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers)' };
    }
    const signal = bundle.restartPoint?.signal ?? null;
    evidence.push(`stop signal: ${signal ?? '(unrecorded)'}`);
    if (!signal || signal === 'SIGKILL') {
      return { pass: false, evidence, detail: 'the first run was not ended by a stop signal — its teardown never ran' };
    }
    const teardowns = (bundle.flow ?? []).filter((e) => String(e.type).startsWith('teardown') && e.ts < boundary);
    for (const t of teardowns) evidence.push(flowLine(t));
    if (teardowns.length === 0) {
      return { pass: false, evidence, detail: 'no teardown line before the restart — the stop closed no worker, so the teardown was not exercised' };
    }
    return { pass: true, evidence, detail: `stopped with ${signal}; its teardown closed ${teardowns.length} worker(s) before the restart` };
  });
}

// A task caught HALF-BUILT was resumed on its branch, not rebuilt (user decision 2026-09-23). The runner
// stops the first run once the implementer has committed a first part (`commit`, a subject substring)
// and records the branch head then (bundle.restartPoint). Proven from the bundle: the run restarted; the
// branch was really half-built at the stop (a head exists, glyph neither 🔍 nor ✅); the resumed coordinator
// logged `resume {task}` and never `rebuild {task}`; that recorded head commit is still in the final git
// log (a rebuild deletes the branch, orphaning it); exactly one commit carries the part's subject (a
// rebuild would redo it); and the task merged after the restart.
export function resumedFromPartial(task, { commit } = {}) {
  return fact(`resumed-from-partial:${task}`, `${task}'s half-built branch was continued after the restart, not rebuilt`, (bundle) => {
    const evidence = [];
    const boundary = restartBoundary(bundle);
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (!boundary) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers) — resume is unproven' };
    }
    const point = bundle.restartPoint;
    if (!point || point.task !== task || !point.head) {
      return { pass: false, evidence, detail: `no ${task} branch head was recorded at the stop — nothing to resume from` };
    }
    evidence.push(`${task} at the stop: ${point.head} glyph ${point.glyph ?? '(none)'}`);
    if (point.glyph === '🔍' || point.glyph === '✅') {
      return { pass: false, evidence, detail: `${task} was already ${point.glyph} at the stop — the drill caught it built, not half-built` };
    }
    const rebuilds = flowOf(bundle, 'rebuild').filter((e) => e.rest === task);
    if (rebuilds.length > 0) {
      for (const r of rebuilds) evidence.push(flowLine(r));
      return { pass: false, evidence, detail: `${task} was rebuilt — the restart discarded its branch` };
    }
    const resumed = flowOf(bundle, 'resume').find((e) => e.rest === task && e.ts >= boundary);
    if (!resumed) {
      return { pass: false, evidence, detail: `no \`resume ${task}\` line after the restart — the half-built branch was not adopted` };
    }
    evidence.push(flowLine(resumed));
    const gitLog = String(bundle.gitLog ?? '');
    const short = point.head.slice(0, 7);
    if (!gitLog.includes(short)) {
      return { pass: false, evidence, detail: `the commit ${short} ${task} had at the stop is gone from the final history — its work was thrown away` };
    }
    evidence.push(`${short} is still in the final history`);
    if (commit) {
      const redone = gitLog.split('\n').filter((l) => l.includes(commit));
      for (const l of redone) evidence.push(l.trim());
      if (redone.length !== 1) {
        return { pass: false, evidence, detail: `${redone.length} commits carry "${commit}" — the resumed implementer redid the part already committed` };
      }
    }
    const mergedAfter = flowOf(bundle, 'merge').find((e) => e.rest === task && e.ts >= boundary);
    if (!mergedAfter) {
      return { pass: false, evidence, detail: `${task} never merged after the restart` };
    }
    evidence.push(flowLine(mergedAfter));
    return { pass: true, evidence, detail: `${task} was resumed from ${short} after the restart and merged — continued, not rebuilt` };
  });
}

// The restart cleared the transient control feeds, so a dead run's leftover never routes into the fresh
// run (DESIGN §2.7, T06). The runner seeds a sentinel into every transient feed (answers, outbox,
// surfaced, and a reports/*.json) in the gap between the SIGKILL and the relaunch — the exact stale state a
// crash strands — and captures the feeds' contents after the resumed run (bundle.controlFeeds,
// loadControlFeeds). This fact passes iff the run restarted, a sentinel was actually seeded (else clearing
// is unproven), and NO feed still holds the sentinel — startupControlHygiene truncated them all. A feed
// that kept its sentinel reddens it, naming the feed.
export function feedsCleared() {
  return fact('feeds-cleared', 'the restart cleared the transient control feeds of a prior run', (bundle) => {
    const evidence = [];
    const cf = bundle.controlFeeds ?? {};
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (flowOf(bundle, 'restart').length < 2) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers) — clearing is unproven' };
    }
    if (!cf.seeded || !cf.sentinel) {
      return { pass: false, evidence, detail: 'no stale feed was seeded before the relaunch — clearing is unproven' };
    }
    const survivors = [];
    for (const [feed, content] of Object.entries(cf.feeds ?? {})) {
      if (feed === 'reports') {
        if ((content ?? []).some((n) => String(n).includes(cf.sentinel))) survivors.push('reports/');
      } else if (String(content ?? '').includes(cf.sentinel)) {
        survivors.push(feed);
      }
    }
    if (survivors.length > 0) {
      for (const s of survivors) evidence.push(`stale sentinel survived in ${s}`);
      return { pass: false, evidence, detail: `a stale entry survived the restart hygiene in: ${survivors.join(', ')}` };
    }
    evidence.push(`seeded sentinel "${cf.sentinel}" cleared from every transient feed`);
    return { pass: true, evidence, detail: 'the seeded stale feed entries were all cleared on restart' };
  });
}

// The dead run's leftover worker sessions were reaped by the restart (DESIGN §2.5, T06). A SIGKILL of the
// coordinator leaves its workers alive; reconciliation stops every listed worker of the slug before it
// adopts anything, session-only, so an orphan neither inflates the live count nor hides from the slot
// maths. Proven from the timeline, which spans the crash: at least one worker session was sampled BEFORE
// the boundary (there was a leftover to reap), none of those pre-crash sessions is still live in the final
// tick (they were reaped, not left lingering past the resumed run), and the worker-slot peak across the
// WHOLE run stayed within the ceiling (an un-reaped orphan beside the resumed workers would exceed it). A
// leftover still live at the end, or a slot peak over the ceiling, reddens it.
export function leftoverSessionsReaped({ ceiling } = {}) {
  const id = ceiling != null ? `leftover-sessions-reaped:${ceiling}` : 'leftover-sessions-reaped';
  return fact(id, 'the dead run\'s leftover sessions were reaped on restart', (bundle) => {
    const evidence = [];
    const boundary = restartBoundary(bundle);
    for (const r of flowOf(bundle, 'restart')) evidence.push(flowLine(r));
    if (!boundary) {
      return { pass: false, evidence, detail: 'the run did not restart (fewer than two restart markers) — nothing to reap' };
    }
    const ticks = bundle.timeline ?? [];
    // The pre-crash worker sessions: any worker sampled in a tick before the boundary.
    const preCrash = new Map(); // sessionId → name
    for (const tick of ticks) {
      if (tick.ts >= boundary) continue;
      for (const a of tick.agents ?? []) {
        if (a.isWorkerOf && a.sessionId) preCrash.set(a.sessionId, a.name);
      }
    }
    if (preCrash.size === 0) {
      return { pass: false, evidence, detail: 'no worker session was sampled before the crash — there was no leftover to reap' };
    }
    // None of them may still be live in the final tick — the restart reaped them, they did not linger.
    const last = ticks[ticks.length - 1];
    const survivors = (last?.agents ?? []).filter((a) => a.isWorkerOf && a.sessionId && preCrash.has(a.sessionId));
    if (survivors.length > 0) {
      for (const s of survivors) evidence.push(`leftover still live at ${last.ts}: ${s.name} (${s.sessionId})`);
      return { pass: false, evidence, detail: `${survivors.length} leftover session(s) still live after the restart — not reaped` };
    }
    // The ceiling held across the whole run, reap plus resume included.
    if (ceiling != null) {
      let max = 0;
      let worstTick = null;
      for (const tick of ticks) {
        const slots = slotsInTick(tick.agents);
        if (slots > max) {
          max = slots;
          worstTick = tick;
        }
      }
      if (worstTick) {
        evidence.push(`peak ${max} slot(s) at ${worstTick.ts}: ${worstTick.agents.filter((a) => a.isWorkerOf).map((a) => a.name).join(', ')}`);
      }
      if (max > ceiling) {
        return { pass: false, evidence, detail: `peak of ${max} worker slots across the restart exceeds the ceiling of ${ceiling} — a leftover was counted alongside the resumed workers` };
      }
    }
    evidence.push(`${preCrash.size} pre-crash session(s) reaped; none live at ${last?.ts}`);
    return { pass: true, evidence, detail: `${preCrash.size} leftover session(s) reaped on restart, ceiling held` };
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
