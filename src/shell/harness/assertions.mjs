// The assertion layer of the live-scenario harness (DESIGN §4.1, T15). A scenario declares the facts it
// must show; each FACT is a pure predicate over a captured bundle (T14) that reports pass/fail with the
// bundle lines that decided it. checkScenario runs a spec's facts into one report and one verdict, and
// formatReport renders it for a person. This is what makes the harness data-driven: the verdict is a
// list of facts and the evidence that proves or breaks each, not a person's recollection.
//
// PURITY (DESIGN §3.1). Every fact `check(bundle)` is a pure function of an already-loaded bundle — no
// clock, no filesystem, no live agent. The only I/O in this file is the loaders (loadTranscripts and its
// siblings), which read bundle files into memory BEFORE any predicate runs; a fact never touches disk.
// The layer lives in src/shell/ (not scanned by the core boundary test) for exactly those loaders.
//
// WHAT A BUNDLE CARRIES (capture.mjs loadBundle + loadTranscripts here; live-workers T16):
//   flow      — [{ ts, type, rest }] parsed from the coordinator's control/log. Each line is
//               `${ISO} ${type} ${task-or-branch}` (loop.mjs record()): the type is the action
//               (open-feature, spawn, await-idle, review, merge, close, halt-close, surface, conflict-sent,
//               rebuild, resume, cleanup, restart), the rest is a task id (T05), a branch, or free text.
//               The line does NOT carry a surface's KIND (conflict/question/decision), so the parked and
//               conflict facts key on the TASK id.
//   timeline  — [{ ts, workers:[{ id, task, role, pid, startTime, status, state, log }] }], one per tick:
//               the coordinator's workers.json joined with each worker's activity from its conversation
//               log (live-workers §2.4). `status` is busy/idle, `state` the finer activity, `log` its
//               conversation file. A worker absent from a tick had exited (or was reaped).
//   workers   — the run's final workers.json.
//   run       — { repo, plan }, the run's identity, written by capture.
//   manifest  — { <log file>: { role:'worker', task, workerRole, n, sessionId, copied, copiedTo } }, one
//               entry per conversation log of the run (§2.3).
//   gitLog    — `git log --oneline --graph --all` text of the scratch repo.
//   transcripts (added here) — [{ key, task, role, n, sessionId, events }], each worker's conversation
//               log parsed to its entries (`{ t, dir, … }`, §2.3). One log is one worker ever spawned,
//               which is how the respawn checks count implementers, including one too short-lived for a
//               tick to see.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseProgress } from '../../core/progress.mjs';

// --- Small pure helpers over a bundle ------------------------------------------------------------

// Reconstruct a flow line for evidence, in the on-disk shape a person would grep.
function flowLine(e) {
  return [e.ts, e.type, e.rest].filter((s) => s != null && s !== '').join(' ');
}

const flowOf = (bundle, type) => (bundle.flow ?? []).filter((e) => e.type === type);

const workersOf = (tick) => tick?.workers ?? [];
const workerLabel = (w) => `${w.task ?? '?'}-${w.role ?? '?'}`;

// runIdentity(bundle) → { repo, plan }, from the bundle's run.json (capture writes the repo and slug it
// was built for). workers.json carries no agent name, so the identity is no longer read from one; a bundle
// without run.json has { repo: null, plan: null } and the facts that need the plan fail on it.
export function runIdentity(bundle) {
  return { repo: bundle.run?.repo ?? null, plan: bundle.run?.plan ?? null };
}

// --- Transcripts: the one loader (I/O), then pure accessors --------------------------------------

// loadTranscripts(bundle, { readFile }) → a new bundle with `transcripts` attached: every conversation log
// the manifest lists, parsed. readFile is injected so a test can load a canned bundle with no real files. A
// log that was not copied or fails to read is included with events: [] rather than dropped, so a fact can
// say "no log" from data.
export function loadTranscripts(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  const transcripts = [];
  for (const [key, entry] of Object.entries(bundle.manifest ?? {})) {
    if (!entry) continue;
    let events = [];
    if (entry.copied && entry.copiedTo) {
      try {
        events = parseTranscript(readFile(join(bundle.dir, entry.copiedTo)));
      } catch {
        events = [];
      }
    }
    transcripts.push({
      key,
      task: entry.task ?? null,
      role: entry.workerRole ?? null,
      n: entry.n ?? null,
      sessionId: entry.sessionId ?? null,
      events,
    });
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

// loadPlanRun(bundle, { readFile }) → a new bundle with `planRun` attached, read from the bundle's
// `plan-run.json` (written by the plan-scenario runner at seal, pir-plan-command T17): what the planning
// run and its build left behind, captured while the scratch repo still stood.
//   { runId, slug, outcome, planFinalState, base, baseBefore, baseAfter, remoteBefore, remoteAfter, cutFromRemote,
//     progress, records }
// `progress` is plans/{slug}/PROGRESS.md as committed on pir/{slug} (null when git could not show it);
// `records` is every index record of the scratch repo, parsed. A missing or malformed file yields null,
// so each plan fact reports "no plan-run capture" from data rather than throwing.
export function loadPlanRun(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let planRun = null;
  try {
    const parsed = JSON.parse(readFile(join(bundle.dir, 'plan-run.json')));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) planRun = parsed;
  } catch {
    planRun = null;
  }
  return { ...bundle, planRun };
}

// loadSingleRun(bundle, { readFile }) → a new bundle with `singleRun`, read from the bundle's
// single-run.json (run.mjs runSingleScenario writes it while the scratch repo still stands). A missing or
// malformed file gives `singleRun: null`, so each single fact reports that from data (single-runs T12).
export function loadSingleRun(bundle, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let singleRun = null;
  try {
    const parsed = JSON.parse(readFile(join(bundle.dir, 'single-run.json')));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) singleRun = parsed;
  } catch {
    singleRun = null;
  }
  return { ...bundle, singleRun };
}

// parseTranscript(text) → the NDJSON lines parsed to objects, malformed lines skipped (never a throw).
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

// sendMessagesOf(transcript) → the SendMessage calls the worker made: in its conversation log, an `in`
// entry whose SDK assistant message holds a tool_use named SendMessage carrying { to, summary, message }.
// Pure.
export function sendMessagesOf(transcript) {
  const out = [];
  for (const e of transcript?.events ?? []) {
    if (e?.dir !== 'in' || e.event?.type !== 'assistant') continue;
    const content = e.event.message?.content;
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
        for (const w of workersOf(tick)) {
          if (w.task === task) obs.push({ ts: tick.ts, status: w.status });
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
// relay is gone: the person answers a blocked worker in its conversation view in `pir` (live-workers
// §2.5), and the program routes no decision of its own (§2.2). So the load-bearing property is no longer "the answer came back" but "the park
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
      (tick) => tick.ts >= surfaceTs && workersOf(tick).some((w) => w.task === task),
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

// A coordinator-hit merge conflict was SENT to its live worker and resolved there, with the person asked
// the judgement as an ordinary question (live-workers §2.10). The coordinator kept the conflicting worker
// alive (it never closed it or merged past it), sent it the resolution prompt over its line
// (`conflict-sent`), the worker asked the person which side ships (an AskUserQuestion the person — the
// harness answerer — answered), merged the feature branch into its own branch, resolved, committed and
// re-signalled done; the coordinator's next pass merged its now-clean branch and the run HANDED OFF the
// green feature branch (§2.4 — it never merges to main). The fact is task-AGNOSTIC: which of the two
// same-line tasks merges second is a race, so it finds the task that took the resolution shape rather
// than naming it. The flow line carries type+task only (see WHAT A BUNDLE CARRIES). It reads off the bundle:
//   - a `conflict-sent` for that task, with NO `merge` of it BEFORE it (the conflict was caught at the
//     coordinator, nothing bad merged first). A `surface` does not count: that is the printed paste-in
//     prompt (no live worker) or a conflict the worker hit at its own integrate, neither the path proven;
//   - a `merge {task}` AFTER it (the same worker resolved and its now-clean branch merged);
//   - that task's review session (the one sent the fix) asked the person a question set and the person's
//     answer reached it (requestAnswered);
//   - exactly ONE implement worker for the task (implementSessionIds: its conversation logs; no respawn — the T22 clobber spawned a
//     second implementer; this mirrors resumedNotRebuilt's no-respawn check);
//   - the run handed off a green feature branch (composed with handedOffGreenBranch: ZERO promote, NO merge
//     of pir/{plan} into main, ≥1 `merge T{nn}` on the feature branch);
//   - and, when the caller passes { file, content }, the handed-off feature branch's content of that file
//     (bundle.finalFiles, captured by the runner from `pir/{slug}`: loadFinalFiles) matches the DECIDED
//     side. This is the crux of the old T22 regression — the branch must read "hello there", not "hi world".
export function mergeConflictResolved({ file, content } = {}) {
  return fact('merge-conflict-resolved', 'A coordinator-hit conflict was sent to its live worker, the person was asked which side ships, and the decided side was handed off', (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'conflict-sent')
      .filter((e) => /^T\d+$/.test(e.rest))
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    if (surfaces.length === 0) {
      const printed = flowOf(bundle, 'surface').filter((e) => /^T\d+$/.test(e.rest));
      for (const s of printed) evidence.push(flowLine(s));
      return {
        pass: false,
        evidence,
        detail: printed.length
          ? 'no conflict-sent — the conflict was surfaced (a printed prompt, or caught at the worker\'s own integrate), not sent to the live worker'
          : 'no conflict-sent — no coordinator-side merge conflict was sent to a worker',
      };
    }
    const merges = flowOf(bundle, 'merge');

    // Find the task that took the resolution path: sent the fix, not merged before, and then merged. Which
    // task conflicts is a race, so the fact discovers it rather than naming it.
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
        detail: 'no task sent the fix was later merged — the conflict was not resolved on the live worker and the branch never landed',
      };
    }
    const { task } = resolved;
    evidence.push(flowLine(resolved.surface));
    evidence.push(flowLine(resolved.mergedAfter));

    // The judgement reached the person as an ordinary question and their answer reached the worker. Only
    // the review session counts: it is the one that signalled done, so the fix went to it — a question
    // the implementer asked earlier is not this one.
    const reviewOnly = { ...bundle, transcripts: (bundle.transcripts ?? []).filter((t) => t.role === 'review') };
    const asked = requestAnswered(task, 'questions').check(reviewOnly);
    for (const e of asked.evidence) evidence.push(e);
    if (!asked.pass) {
      return { pass: false, evidence, detail: `the person was not asked which side ships: ${asked.detail}` };
    }

    // No respawn: exactly one implement worker ran the conflicting task (mirrors resumedNotRebuilt). The
    // T22 clobber closed the done worker and spawned a SECOND implementer over the same task. Counted by
    // implementSessionIds; 0 (no log, never sampled) cannot prove a respawn, so only >1 fails.
    const implSids = implementSessionIds(bundle, task);
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

    return { pass: true, evidence, detail: `${task}'s conflict was sent to its live worker, the person answered which side ships, and the decided side merged and handed off` };
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
//     is never vacuous over a run that merged nothing;
//   - the coordinator's own printed hand-off (bundle.coordinatorOut, its stdout, captured by run.mjs)
//     carries the green `git merge pir/{plan}` line and not the red `not ready to merge` one. The flow log
//     and git look identical for a red and a green finish, so this is the only signal of the end-of-run
//     gate's verdict; a missing capture fails rather than passing unseen (declared-test-command T10).
export function handedOffGreenBranch() {
  return fact('handed-off-green-branch', 'The run handed off a green feature branch and left the base untouched (§2.4)', (bundle) => {
    const evidence = [];
    // No promotion: a `promote` flow line would be the coordinator merging to main (the removed model).
    const promotes = flowOf(bundle, 'promote');
    for (const p of promotes) evidence.push(flowLine(p));
    if (promotes.length > 0) {
      return { pass: false, evidence, detail: `${promotes.length} promote line(s) in the flow — the run merged to main, which §2.4 removed` };
    }
    // main gained nothing beyond the seed: no promotion merge of the feature branch into main. Without the
    // run's plan that cannot be checked, so the fact fails rather than skipping it.
    const { plan } = runIdentity(bundle);
    if (!plan) {
      return { pass: false, evidence, detail: 'the bundle does not name its plan (no run.json) — cannot check that main was left untouched' };
    }
    const promoMerges = promotionMergeLines(bundle.gitLog, plan);
    for (const l of promoMerges) evidence.push(l.trim());
    if (promoMerges.length > 0) {
      return { pass: false, evidence, detail: `git log shows ${promoMerges.length} promotion merge(s) of pir/${plan} into main — main was not left untouched` };
    }
    evidence.push('git log: no promotion merge into main');
    // The plan was assembled on the feature branch: at least one task merged there (a non-vacuous pass).
    const taskMerges = flowOf(bundle, 'merge').filter((e) => /^T\d+$/.test(e.rest));
    for (const m of taskMerges) evidence.push(flowLine(m));
    if (taskMerges.length === 0) {
      return { pass: false, evidence, detail: 'no task merged into the feature branch — nothing was assembled, so the hand-off is vacuous' };
    }
    // The gate's verdict, from the coordinator's printed hand-off (coordinate.mjs renderHandoff).
    const out = bundle.coordinatorOut;
    if (out == null) {
      return { pass: false, evidence, detail: 'no coordinator.out in the bundle — the end-of-run gate verdict was not captured' };
    }
    const outLines = out.split('\n');
    // The LAST red line: on a non-TTY the renderer appends the final red frame, whose footer says `not
    // ready to merge` with no reason under it, before renderHandoff prints its own red line and reason.
    const redAt = outLines.findLastIndex((l) => l.includes('not ready to merge'));
    if (redAt !== -1) {
      evidence.push(`coordinator.out: ${outLines[redAt].trim()}`);
      // renderHandoff prints the gate's reason on the line after the red one.
      const why = outLines[redAt + 1]?.trim();
      return { pass: false, evidence, detail: `the feature-branch tests went red${why ? `: ${why}` : ''}` };
    }
    // The merge line must follow `Yours to merge:` (renderHandoff, blank line between). A bare
    // `git merge pir/{plan}` also appears in the conflict-resolution prompt printed mid-run, so a run that
    // conflicted and then stalled would otherwise read as green.
    // The offer switches to the run's base first (base-branch DESIGN §2.9: `git switch {base} && git merge
    // pir/{plan}`); any base is accepted here, since which base a run used is not this fact's question.
    const mergeLine = `git merge pir/${plan}`;
    const isOffer = (l) => {
      const t = l?.trim() ?? '';
      return t === mergeLine || (t.startsWith('git switch ') && t.endsWith(` && ${mergeLine}`));
    };
    const nextNonBlank = (i) => outLines.slice(i + 1).find((l) => l.trim() !== '');
    const offerAt = outLines.findLastIndex((l, i) => l.includes('Yours to merge:') && isOffer(nextNonBlank(i)));
    // With the coordinator agent on, the run does not print renderHandoff: it waits in `ready to merge`,
    // whose footer (display.mjs) carries the offer on one line, `✔ ready to merge · git switch … && git
    // merge pir/{plan}`, shown only on a green branch with its report committed (base-branch T09).
    const readyLine = outLines.findLast((l) => {
      const m = /^✔ ready to merge · (.*)$/.exec(l.trim());
      return !!m && isOffer(m[1]);
    });
    // With the finisher (finisher DESIGN §2.1) the run hands over in the pass that settles `ready`: no merge
    // line is printed unless it falls back, and its row is the hand-off. It only ever takes a green branch.
    const finisherLine = outLines.findLast((l) => /^◆ finisher\b/.test(l.trim()));
    const green = offerAt === -1 ? readyLine ?? finisherLine ?? null : nextNonBlank(offerAt);
    if (!green) {
      return { pass: false, evidence, detail: `coordinator.out has no \`${mergeLine.trim()}\` hand-off line — the run did not hand off a green branch` };
    }
    evidence.push(`coordinator.out: ${green.trim()}`);
    return { pass: true, evidence, detail: `${taskMerges.length} task merge(s) on the feature branch, zero promotes, the base untouched, tests green — a clean hand-off` };
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
    const survivors = workersOf(last);
    if (survivors.length > 0) {
      evidence.push(`last tick ${last.ts} still lists: ${survivors.map(workerLabel).join(', ')}`);
      return { pass: false, evidence, detail: `${survivors.length} worker(s) still live after the kill switch` };
    }
    evidence.push('last tick lists no live worker of this run');
    return { pass: true, evidence, detail: 'every worker left the timeline and nothing was promoted' };
  });
}

// slotsInTick(workers) → the number of worker SLOTS live in one timeline tick (DESIGN §2.4 the ceiling;
// §2.1 a task in review holds one slot, not two). Group the tick's live workers by task: a task's
// implement+review overlap is ONE slot (the loop closes the implementer as its reviewer spawns, and the
// closing child can still be alive for a sample), so counting raw workers would read ceiling+1 on a legit
// handoff. An EXTRA same-role worker on a task is a respawn runaway and adds a slot. Shared by ceilingHeld
// and leftoverSessionsReaped so both count the ceiling the one way.
function slotsInTick(workers) {
  const byTask = new Map();
  for (const w of workers ?? []) {
    const key = w.task ?? `?${w.id}`;
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(w);
  }
  let slots = 0;
  for (const group of byTask.values()) {
    const roles = new Set(group.map((w) => w.role ?? '?'));
    slots += 1 + Math.max(0, group.length - roles.size);
  }
  return slots;
}

// The timeline never shows more than n worker SLOTS in flight at once (DESIGN §2.4 the ceiling; §2.1
// a task in review holds one slot, not two). Counting raw workers over-counts a review handoff: the loop
// closes the implementer AS the fresh reviewer spawns (loop.mjs 3c/3e), but a closing worker takes up to
// its close grace to exit, so it can still be alive in workers.json for a sample beside its reviewer (the
// same lag `claude stop` had, T08 FINDINGS 2026-09-09). A single handoff then reads ceiling+1 — a FALSE
// fail, not a real breach: the loop's own `closedIds` count never recounts the closing worker.
//
// So count by task, not by worker: a task's implement+review overlap is ONE slot. Grouping also keeps
// the runaway honest — the 2026-09-09 runaway spawned DUPLICATE same-role workers for one task, so an
// extra worker of a role already present on a task adds a slot, and N over-provisioned real workers
// still exceed n. (A duplicate is a genuine second paid agent; a closing implementer is not, and it never
// shares its reviewer's role.) Fixtures assert the bare true ceiling, no ceiling+1 fudge.
export function ceilingHeld(n) {
  return fact(`ceiling-held:${n}`, `At most ${n} worker slots in flight at once`, (bundle) => {
    const evidence = [];
    let max = 0;
    let worstTick = null;
    for (const tick of bundle.timeline ?? []) {
      const slots = slotsInTick(workersOf(tick));
      if (slots > max) {
        max = slots;
        worstTick = tick;
      }
    }
    if (worstTick) {
      evidence.push(`peak ${max} slot(s) at ${worstTick.ts}: ${workersOf(worstTick).map(workerLabel).join(', ')}`);
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
// It counts by task, mirroring ceilingHeld's grouping: two workers of one task (a respawn, or a closing
// worker beside its successor) are one task, not two, so a duplicate can never inflate the width. It
// counts implementers only — a reviewer is a follow-on worker, not a build running in parallel. Keyed on
// the task and role workers.json records, so it cannot drift from bookkeeping.
//
// STRICT on purpose: a PASS must mean the builds genuinely overlapped, so an implementer counts only while
// its `status` is `busy` (a turn open this tick, from its log). An idle implementer — one whose turn ended
// or that waits on the person — is not a build in flight and does not count toward
// the width, the opposite bias to ceilingHeld (which counts it, to catch a runaway from above).
export function reachedWidth(n) {
  return fact(`reached-width:${n}`, `At least ${n} task implementers built at once`, (bundle) => {
    const evidence = [];
    let max = 0;
    let best = null;
    for (const tick of bundle.timeline ?? []) {
      const tasks = new Set();
      for (const w of workersOf(tick)) {
        if (w.role !== 'implement') continue; // a reviewer is not a build in flight
        if (w.status !== 'busy') continue; // only a worker in a turn this tick counts (§4.1, strict lower bound)
        if (w.task) tasks.add(w.task);
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

// implementSessionIds(bundle, task) → one key per IMPLEMENT worker `task` had across the whole run. More
// than one means the task was re-implemented (a second build spawned over it), the signature of a rebuild
// where a resume was expected. Every spawn opens its own conversation log (live-workers §2.3), so each
// `{task}-implement-{n}` log is one implementer, including one too short-lived for any tick to see; the
// timeline adds any worker whose log was not captured, keyed by that same log name when it has one.
function implementSessionIds(bundle, task) {
  const ids = new Set();
  for (const t of bundle.transcripts ?? []) {
    if (t.task === task && t.role === 'implement') ids.add(t.key);
  }
  for (const tick of bundle.timeline ?? []) {
    for (const w of workersOf(tick)) {
      if (w.task === task && w.role === 'implement') ids.add(w.log ?? `id:${w.id}`);
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

// The dead run's leftover workers were reaped by the restart (DESIGN §2.5; live-workers T06). A SIGKILL of
// the coordinator can leave a worker mid-command alive; the next start reaps every pid workers.json
// recorded before it adopts anything, so an orphan neither inflates the live count nor hides from the slot
// maths. Proven from the timeline, which spans the crash: at least one worker was sampled BEFORE the
// boundary (there was a leftover to reap), none of those pre-crash workers is still live in the final
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
    const preCrash = new Map(); // worker id → label
    for (const tick of ticks) {
      if (tick.ts >= boundary) continue;
      for (const w of workersOf(tick)) {
        if (w.id) preCrash.set(w.id, workerLabel(w));
      }
    }
    if (preCrash.size === 0) {
      return { pass: false, evidence, detail: 'no worker session was sampled before the crash — there was no leftover to reap' };
    }
    // None of them may still be live in the final tick — the restart reaped them, they did not linger.
    const last = ticks[ticks.length - 1];
    const survivors = workersOf(last).filter((w) => w.id && preCrash.has(w.id));
    if (survivors.length > 0) {
      for (const w of survivors) evidence.push(`leftover still live at ${last.ts}: ${workerLabel(w)} (${w.id})`);
      return { pass: false, evidence, detail: `${survivors.length} leftover session(s) still live after the restart — not reaped` };
    }
    // The ceiling held across the whole run, reap plus resume included.
    if (ceiling != null) {
      let max = 0;
      let worstTick = null;
      for (const tick of ticks) {
        const slots = slotsInTick(workersOf(tick));
        if (slots > max) {
          max = slots;
          worstTick = tick;
        }
      }
      if (worstTick) {
        evidence.push(`peak ${max} slot(s) at ${worstTick.ts}: ${workersOf(worstTick).map(workerLabel).join(', ')}`);
      }
      if (max > ceiling) {
        return { pass: false, evidence, detail: `peak of ${max} worker slots across the restart exceeds the ceiling of ${ceiling} — a leftover was counted alongside the resumed workers` };
      }
    }
    evidence.push(`${preCrash.size} pre-crash session(s) reaped; none live at ${last?.ts}`);
    return { pass: true, evidence, detail: `${preCrash.size} leftover session(s) reaped on restart, ceiling held` };
  });
}

// A worker of `task` asked the person something of `kind` over the line, and the person's answer reached
// it (live-workers §2.6, §2.7, T18). `kind` is `questions` (an AskUserQuestion request) or `permission`
// (a request for any other tool). Read from the task's conversation logs: a `request` entry of that kind,
// and an `out` `reply` to the same requestId `from:"person"` whose result allowed it. A reply from pir (a
// grant) does not count, and neither does a refusal: the fixture's point is that an answer let the worker
// carry on. Pure over the loaded transcripts.
export function requestAnswered(task, kind) {
  return fact(`request-answered:${task}:${kind}`, `${task} asked the person ${kind === 'questions' ? 'a question set' : 'a permission'} and the answer reached it`, (bundle) => {
    const evidence = [];
    const logs = (bundle.transcripts ?? []).filter((t) => t.task === task);
    if (logs.length === 0) return { pass: false, evidence, detail: `no conversation log for ${task}` };
    let asked = 0;
    for (const t of logs) {
      const events = t.events ?? [];
      const requests = events.filter(
        (e) => e?.dir === 'request' && (e.toolName === 'AskUserQuestion') === (kind === 'questions'),
      );
      asked += requests.length;
      for (const r of requests) {
        evidence.push(`${t.key}: request ${r.requestId} ${r.toolName}`);
        const reply = events.find((e) => e?.dir === 'out' && e.kind === 'reply' && e.requestId === r.requestId);
        if (!reply) continue;
        evidence.push(`${t.key}: reply ${r.requestId} from ${reply.from} ${reply.result?.behavior}`);
        if (reply.from === 'person' && reply.result?.behavior === 'allow') {
          return { pass: true, evidence, detail: `${task}'s ${r.toolName} request was answered by the person and allowed` };
        }
      }
    }
    if (asked === 0) return { pass: false, evidence, detail: `${task} never asked ${kind === 'questions' ? 'a question set' : 'a permission'}` };
    return { pass: false, evidence, detail: `${task} asked ${asked} time(s) but no person's allowing answer reached it` };
  });
}

// --- The coordinator agent's live check (pir-coordinator DESIGN §1 success criteria, T09) ----------
//
// Read from the bundle's ledger (the agent's applied decisions, `t` ISO), its status snapshots (each row's
// `asking` and `holder`, `ts` ISO), the workers' conversation logs (`t` in ms) and the runner's steps.json.

const msOf = (t) => (typeof t === 'number' ? t : Date.parse(t));
const rowsOf = (status) => [...(status?.runState?.tasks ?? []), ...(status?.runState?.helpers ?? [])];
const rowFor = (status, id) => rowsOf(status).find((r) => r?.id === id) ?? null;
// A row asks the person when something waits and the agent does not hold it (display.mjs asksPerson).
const asksPersonRow = (row) => !!row?.asking && row.holder !== 'coordinator';
const ledgerFor = (bundle, task) => (bundle.ledger ?? []).filter((l) => l?.task === task);

// agentAnswered(task) — the agent answered `task`'s question on its own: a non-pass ledger line for the
// task, its reply reached the worker `from: 'coordinator'`, and no status snapshot ever showed the task's
// row asking the person.
export function agentAnswered(task) {
  return fact(`agent-answered:${task}`, `The coordinator agent answered ${task}'s question, and ${task} never read \`asking you\``, (bundle) => {
    const evidence = [];
    const lines = ledgerFor(bundle, task);
    for (const l of lines) evidence.push(`ledger ${l.t}: ${l.kind} ${task} — ${l.item} → ${JSON.stringify(l.answer)}`);
    const answered = lines.filter((l) => l.kind !== 'pass');
    if (answered.length === 0) return { pass: false, evidence, detail: `no ledger line answers ${task} (${lines.length} line(s), none an answer)` };
    const replies = (bundle.transcripts ?? [])
      .filter((t) => t.task === task)
      .flatMap((t) => (t.events ?? []).filter((e) => e?.dir === 'out' && (e.kind === 'reply' || e.kind === 'message') && e.from === 'coordinator').map((e) => `${t.key}: ${e.kind} from coordinator`));
    evidence.push(...replies);
    if (replies.length === 0) return { pass: false, evidence, detail: `the ledger answers ${task} but no reply from the coordinator reached its worker` };
    const asked = (bundle.statuses ?? []).filter((s) => asksPersonRow(rowFor(s.status, task)));
    for (const s of asked.slice(0, 3)) evidence.push(`status ${s.ts}: ${task} asking you (${rowFor(s.status, task).asking})`);
    if (asked.length > 0) return { pass: false, evidence, detail: `${task} read \`asking you\` in ${asked.length} snapshot(s)` };
    if ((bundle.statuses ?? []).length === 0) return { pass: false, evidence, detail: 'no status snapshots in the bundle — cannot show the row never asked the person' };
    return { pass: true, evidence, detail: `${answered.length} answer(s) by the agent; ${task} never read \`asking you\`` };
  });
}

// reservedToPerson(task, decision) — `task`'s permission request was the person's: it read `asking you`, the
// agent logged no permission decision for it, and the person's answer (the harness's `decision`) reached it.
export function reservedToPerson(task, decision = 'deny') {
  return fact(`reserved-to-person:${task}`, `${task}'s reserved permission reached the person, who answered it (${decision})`, (bundle) => {
    const evidence = [];
    const behavior = decision === 'deny' ? 'deny' : 'allow';
    for (const t of (bundle.transcripts ?? []).filter((x) => x.task === task)) {
      const events = t.events ?? [];
      for (const r of events.filter((e) => e?.dir === 'request' && e.toolName !== 'AskUserQuestion')) {
        evidence.push(`${t.key}: request ${r.requestId} ${r.toolName} ${JSON.stringify(r.input?.command ?? '')}`);
        const reply = events.find((e) => e?.dir === 'out' && e.kind === 'reply' && e.requestId === r.requestId);
        if (!reply) continue;
        evidence.push(`${t.key}: reply ${r.requestId} from ${reply.from} ${reply.result?.behavior}`);
        const agentLine = (bundle.ledger ?? []).find((l) => l?.kind === 'permission' && l.requestId === r.requestId);
        if (agentLine) return { pass: false, evidence, detail: `the agent decided ${r.requestId} (${JSON.stringify(agentLine.answer)}), a reserved request` };
        if (reply.from !== 'person' || reply.result?.behavior !== behavior) continue;
        const shown = (bundle.statuses ?? []).some((s) => asksPersonRow(rowFor(s.status, task)) && rowFor(s.status, task).asking === 'permission');
        if (!shown) return { pass: false, evidence, detail: `${task}'s permission was answered by the person but no snapshot showed it asking you` };
        return { pass: true, evidence, detail: `${task}'s ${r.toolName} request read \`asking you\` and the person's ${behavior} reached it` };
      }
    }
    return { pass: false, evidence, detail: `no permission request of ${task} was answered ${behavior} by the person` };
  });
}

// remoteOnlyAfterPass(task) — the agent passed `task`'s question on, and the task's worker was reachable
// on the phone only from then: its Remote Control was off at the pass and switched on at or after it.
export function remoteOnlyAfterPass(task) {
  return fact(`remote-only-after-pass:${task}`, `${task}'s passed question switched its Remote Control on only after the pass`, (bundle) => {
    const evidence = [];
    const pass = ledgerFor(bundle, task).find((l) => l.kind === 'pass');
    if (!pass) return { pass: false, evidence, detail: `the agent never passed a question of ${task} on` };
    const tp = msOf(pass.t);
    evidence.push(`ledger ${pass.t}: pass ${task} — ${pass.item} (${pass.reason ?? 'no reason'})`);
    const notes = (bundle.transcripts ?? [])
      .filter((t) => t.task === task)
      .flatMap((t) => (t.events ?? []).filter((e) => e?.dir === 'note' && e.kind === 'remote-control').map((e) => ({ key: t.key, t: msOf(e.t), on: !!e.on })))
      .sort((a, b) => a.t - b.t);
    for (const n of notes) evidence.push(`${n.key} ${new Date(n.t).toISOString()}: remote control ${n.on ? 'on' : 'off'}`);
    const before = notes.filter((n) => n.t < tp).at(-1);
    if (before?.on) return { pass: false, evidence, detail: `${task}'s Remote Control was already on when the agent passed its question` };
    const after = notes.find((n) => n.t >= tp && n.on);
    if (!after) return { pass: false, evidence, detail: `${task}'s Remote Control never switched on after the pass` };
    return { pass: true, evidence, detail: `off at the pass, on ${Math.round((after.t - tp) / 1000)}s after it` };
  });
}

// readyWithReport() — the end with the agent (DESIGN §2.9, §2.10): the end sync met a conflict (a main-sync
// helper row appeared), the run then read \`ready to merge\` with a report path, REPORT.md was on the
// feature branch when the runner merged it (steps.json), and the command saw the merge and finished.
// `conflict: false` (T14) drops the main-sync requirement, for a fixture whose main does not move.
export function readyWithReport({ conflict = true } = {}) {
  const label = conflict
    ? 'The run reached `ready to merge` with REPORT.md committed, after resolving the main-sync conflict'
    : 'The run reached `ready to merge` with REPORT.md committed';
  return fact(conflict ? 'ready-with-report' : 'ready-with-report:no-conflict', label, (bundle) => {
    const evidence = [];
    const statuses = bundle.statuses ?? [];
    let since = -Infinity;
    if (conflict) {
      const sync = statuses.find((s) => rowFor(s.status, 'main-sync'));
      if (!sync) return { pass: false, evidence, detail: 'no snapshot shows a main-sync worker — the end sync met no conflict' };
      evidence.push(`status ${sync.ts}: main-sync worker row`);
      since = msOf(sync.ts);
    }
    const ready = statuses.find((s) => msOf(s.ts) >= since && s.status?.runState?.handoff?.state === 'ready');
    if (!ready) return { pass: false, evidence, detail: `the run never read \`ready to merge\`${conflict ? ' after the main-sync conflict' : ''}` };
    evidence.push(`status ${ready.ts}: ready to merge, report ${ready.status.runState.handoff.reportPath}`);
    const merged = bundle.steps?.merged;
    if (!merged?.report) return { pass: false, evidence, detail: 'no REPORT.md was read from the feature branch at the merge' };
    const heads = merged.report.split('\n').filter((l) => l.startsWith('## '));
    evidence.push(`${merged.reportPath} at ${merged.at}: ${heads.join(' · ')}`);
    if (!heads.includes('## Decisions made for you') || !heads.includes('## Branch')) {
      return { pass: false, evidence, detail: 'REPORT.md lacks its decisions section or its branch footer' };
    }
    // The finished line names the run's base, whichever it is (base-branch DESIGN §2.9).
    const finished = (bundle.coordinatorOut ?? '').split('\n').find((l) => / is in \S+\. The run is finished\./.test(l));
    if (!finished) return { pass: false, evidence, detail: 'the command did not finish on the merge (no "is in {base}" line in coordinator.out)' };
    evidence.push(`coordinator.out: ${finished.trim()}`);
    return { pass: true, evidence, detail: `${conflict ? 'conflict resolved, ' : ''}ready to merge with REPORT.md committed, finished on the merge` };
  });
}

// --- Several briefs at once, the hold limit, and the agent's statements (pir-coordinator T14) ------
//
// These read the agent's own conversation log too: `coordinator-{n}.ndjson`, copied into the bundle with
// every other log (capture.mjs snapshotConversations; its task is null). pir's messages to the agent are its
// `out` entries `from: 'pir'`; the agent's replies are the text of its `in` assistant events. Every brief
// and hand-over names its item on lines of their own (coordinator-brief.mjs header): `Task: T01`,
// requestId: `…`.

const isAgentLog = (t) => /^coordinator-\d+\.ndjson$/.test(t?.key ?? '');
const agentLogsOf = (bundle) => (bundle.transcripts ?? []).filter(isAgentLog);
const taskIn = (text) => /^Task: (T\d+)\s*$/m.exec(text ?? '')?.[1] ?? null;
const requestIdIn = (text) => /^requestId: `([^`]+)`\s*$/m.exec(text ?? '')?.[1] ?? null;
const BRIEF = /^A worker (is asking|dropped)/;
const HANDED = /^Handed to the person/;
const DECISION_KINDS = new Set(['permission', 'answers', 'message', 'pass']);

// pirToAgent(bundle) → [{ t, text, key }] every message pir sent the agent, in time order. Pure.
export function pirToAgent(bundle) {
  return agentLogsOf(bundle)
    .flatMap((l) => (l.events ?? []).filter((e) => e?.dir === 'out' && e.from === 'pir' && e.kind === 'message').map((e) => ({ t: msOf(e.t), text: String(e.text ?? ''), key: l.key })))
    .sort((a, b) => a.t - b.t);
}

// agentReplies(bundle) → [{ t, text, key }] every piece of text the agent wrote, in time order. Pure.
export function agentReplies(bundle) {
  const out = [];
  for (const l of agentLogsOf(bundle)) {
    for (const e of l.events ?? []) {
      if (e?.dir !== 'in' || e.event?.type !== 'assistant') continue;
      const content = e.event.message?.content;
      if (!Array.isArray(content)) continue;
      const text = content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n').trim();
      if (text) out.push({ t: msOf(e.t), text, key: l.key });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const iso = (ms) => new Date(ms).toISOString();

// briefsOverlapped(a, b) — the agent had both tasks' briefs before any decision for either was applied: the
// later of the two first briefs was sent before the earliest ledger decision for either task.
export function briefsOverlapped(a, b) {
  return fact(`briefs-overlapped:${a}:${b}`, `${a}'s and ${b}'s briefs both reached the agent before its decision for either was applied`, (bundle) => {
    const evidence = [];
    const briefs = pirToAgent(bundle).filter((m) => BRIEF.test(m.text));
    const first = {};
    for (const task of [a, b]) {
      const m = briefs.find((x) => taskIn(x.text) === task);
      if (!m) return { pass: false, evidence, detail: `no brief for ${task} in the agent's conversation` };
      first[task] = m.t;
      evidence.push(`${m.key} ${iso(m.t)}: brief for ${task}`);
    }
    const decisions = (bundle.ledger ?? []).filter((l) => (l?.task === a || l?.task === b) && DECISION_KINDS.has(l.kind));
    for (const l of decisions) evidence.push(`ledger ${l.t}: ${l.kind} ${l.task}`);
    if (decisions.length === 0) return { pass: false, evidence, detail: `no decision of the agent's for ${a} or ${b} in the ledger` };
    const lastBrief = Math.max(first[a], first[b]);
    const firstDecision = Math.min(...decisions.map((l) => msOf(l.t)));
    if (lastBrief >= firstDecision) {
      return { pass: false, evidence, detail: `the second brief (${iso(lastBrief)}) came after the first decision was applied (${iso(firstDecision)}): no overlap` };
    }
    return { pass: true, evidence, detail: `both briefs in by ${iso(lastBrief)}, first decision applied ${Math.round((firstDecision - lastBrief) / 1000)}s later` };
  });
}

// oneDecisionEach(tasks) — every item of each task the agent decided got exactly one ledger decision (items
// keyed by requestId, a report park by the task), and each task got at least one.
export function oneDecisionEach(tasks) {
  return fact(`one-decision-each:${tasks.join(',')}`, `The agent decided ${tasks.join(' and ')} separately, one ledger line per item`, (bundle) => {
    const evidence = [];
    for (const task of tasks) {
      const lines = ledgerFor(bundle, task).filter((l) => DECISION_KINDS.has(l.kind));
      if (lines.length === 0) return { pass: false, evidence, detail: `no ledger decision for ${task}` };
      const byItem = new Map();
      for (const l of lines) {
        const k = l.requestId ?? 'report';
        byItem.set(k, [...(byItem.get(k) ?? []), l]);
        evidence.push(`ledger ${l.t}: ${l.kind} ${task} ${k}`);
      }
      for (const [k, ls] of byItem) {
        if (ls.length !== 1) return { pass: false, evidence, detail: `${task}'s item ${k} has ${ls.length} ledger decisions` };
      }
    }
    return { pass: true, evidence, detail: `${tasks.join(', ')}: one decision per item` };
  });
}

// timedOutToPerson(task, holdMs, { slackMs }) — the hold limit fired for real (DESIGN §2.11): the task's row
// read `asking coordinator`, a `timeout` ledger line came at about `holdMs` (within `slackMs`), before any
// answer to the item; the row then read `asking you`, the worker's Remote Control came on at or after the
// timeout and was off before it; the agent was handed the item and replied naming the task; and the harness's
// answer as the person reached the worker.
export function timedOutToPerson(task, holdMs, { slackMs = 60000 } = {}) {
  return fact(`timed-out-to-person:${task}`, `${task}'s held question went to the person after the ${Math.round(holdMs / 1000)}s hold limit, the agent gave its pointer, and the person's answer reached ${task}`, (bundle) => {
    const evidence = [];
    const timeout = ledgerFor(bundle, task).find((l) => l.kind === 'timeout');
    if (!timeout) return { pass: false, evidence, detail: `no \`timeout\` ledger line for ${task}` };
    const tt = msOf(timeout.t);
    evidence.push(`ledger ${timeout.t}: timeout ${task} — held ${timeout.heldForMs} ms`);
    if (!(timeout.heldForMs >= holdMs && timeout.heldForMs < holdMs + slackMs)) {
      return { pass: false, evidence, detail: `held for ${timeout.heldForMs} ms, not about the ${holdMs} ms limit` };
    }
    const early = ledgerFor(bundle, task).find((l) => DECISION_KINDS.has(l.kind) && msOf(l.t) < tt);
    if (early) return { pass: false, evidence, detail: `the agent decided ${task} (${early.kind}) before the timeout` };

    const statuses = bundle.statuses ?? [];
    const held = statuses.find((s) => rowFor(s.status, task)?.asking && rowFor(s.status, task).holder === 'coordinator');
    if (!held) return { pass: false, evidence, detail: `no snapshot shows ${task} \`asking coordinator\`` };
    evidence.push(`status ${held.ts}: ${task} asking coordinator`);
    const youBefore = statuses.find((s) => msOf(s.ts) < tt && asksPersonRow(rowFor(s.status, task)));
    if (youBefore) return { pass: false, evidence, detail: `${task} read \`asking you\` at ${youBefore.ts}, before the timeout` };
    const you = statuses.find((s) => msOf(s.ts) >= tt && asksPersonRow(rowFor(s.status, task)));
    if (!you) return { pass: false, evidence, detail: `${task} never read \`asking you\` after the timeout` };
    evidence.push(`status ${you.ts}: ${task} asking you`);

    const logs = (bundle.transcripts ?? []).filter((t) => t.task === task);
    const events = logs.flatMap((t) => (t.events ?? []).map((e) => ({ ...e, key: t.key })));
    const rc = events.filter((e) => e?.dir === 'note' && e.kind === 'remote-control').map((e) => ({ t: msOf(e.t), on: !!e.on })).sort((x, y) => x.t - y.t);
    if (rc.filter((n) => n.t < tt).at(-1)?.on) return { pass: false, evidence, detail: `${task}'s Remote Control was on before the timeout` };
    const on = rc.find((n) => n.t >= tt && n.on);
    if (!on) return { pass: false, evidence, detail: `${task}'s Remote Control never came on after the timeout` };
    evidence.push(`${iso(on.t)}: ${task} remote control on`);

    const handed = pirToAgent(bundle).find((m) => HANDED.test(m.text) && taskIn(m.text) === task);
    if (!handed) return { pass: false, evidence, detail: `the agent was never told ${task} was handed to the person` };
    evidence.push(`${handed.key} ${iso(handed.t)}: hand-over message for ${task}`);
    const pointer = agentReplies(bundle).find((r) => r.t > handed.t && r.text.includes(task));
    if (!pointer) return { pass: false, evidence, detail: `no reply of the agent's names ${task} after the hand-over` };
    evidence.push(`${pointer.key} ${iso(pointer.t)}: pointer "${pointer.text.slice(0, 120).replace(/\s+/g, ' ')}…"`);

    const request = events.find((e) => e?.dir === 'request' && e.requestId === timeout.requestId) ?? events.find((e) => e?.dir === 'request');
    if (!request) return { pass: false, evidence, detail: `no request in ${task}'s log` };
    const reply = events.find((e) => e?.dir === 'out' && e.kind === 'reply' && e.requestId === request.requestId);
    if (!reply) return { pass: false, evidence, detail: `${task}'s request ${request.requestId} was never answered` };
    evidence.push(`${reply.key} ${iso(msOf(reply.t))}: reply ${request.requestId} from ${reply.from} ${reply.result?.behavior}`);
    if (msOf(reply.t) < tt) return { pass: false, evidence, detail: `${task} was answered before the timeout` };
    if (reply.from !== 'person' || reply.result?.behavior !== 'allow') return { pass: false, evidence, detail: `${task}'s answer came from ${reply.from} (${reply.result?.behavior}), not the person's` };
    return { pass: true, evidence, detail: `held ${Math.round(timeout.heldForMs / 1000)}s, then the person's; pointer given, answered ${Math.round((msOf(reply.t) - tt) / 1000)}s after the timeout` };
  });
}

// waitingAt(bundle, task, t) → true when `task`'s worker had an item waiting at `t`: a request logged at or
// before `t` with no reply at or before `t`, or, for a task that never logged a request (a report park), a
// status snapshot at or before `t` showing its row asking. Pure.
export function waitingAt(bundle, task, t) {
  const events = (bundle.transcripts ?? []).filter((x) => x.task === task).flatMap((x) => x.events ?? []);
  const requests = events.filter((e) => e?.dir === 'request');
  if (requests.length > 0) {
    return requests.some((r) => {
      if (msOf(r.t) > t) return false;
      const closed = events.find((e) => ((e?.dir === 'out' && e.kind === 'reply') || (e?.dir === 'note' && (e.kind === 'answered-remotely' || e.kind === 'delivered-by-grant'))) && e.requestId === r.requestId);
      return !closed || msOf(closed.t) > t;
    });
  }
  const before = (bundle.statuses ?? []).filter((s) => msOf(s.ts) <= t).at(-1);
  return !!rowFor(before?.status, task)?.asking;
}

// A sentence of the agent's that sends the person to an item: it names the task and tells them to answer it
// or says it waits on them. "T01 is asking …" alone is a description, often of an item the agent is answering
// itself, so it is not a pointer. A sentence saying the item is already settled is a correction, not a pointer.
const POINTER = /(\b(please )?answer (it|this|that|them)\b|\banswer\b[^.]{0,60}\b(conversation|session|phone|row)\b|\bwaits? (for|on) you\b|\bneeds you\b|\byour (answer|call|decision|pick)\b|\bover to you\b|\byours to (answer|decide)\b)/i;
const CORRECTION = /\b(already|settled|no longer|has been answered|was answered|been handled)\b/i;

// pointersAt(text) → the task ids a reply points the person at, sentence by sentence. A pointer sentence that
// names no task ("Answer it in its conversation.") points at the task named last before it. Pure.
export function pointersAt(text) {
  const out = new Set();
  let last = null;
  for (const sentence of String(text ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const named = [...sentence.matchAll(/\bT\d{2,}\b/g)].map((m) => m[0]);
    // "I'll answer them myself", "I won't answer it" are the agent speaking of its own answering, not sending the person: its own answering is cut first.
    const directed = sentence.replace(/\b(I|we)(['’]\w+)?(\s+\w+['’]?\w*){0,2}\s+answer\w*\b[^.;]*/gi, '');
    if (POINTER.test(directed) && !CORRECTION.test(directed)) {
      for (const t of named.length ? named : last ? [last] : []) out.add(t);
    }
    if (named.length) last = named.at(-1);
  }
  return [...out];
}

// What a closing reply recorded in the worker's log should read like in pir's "already answered" message
// (coordinator-brief.mjs closedWhy): who, and every answer given. → { who: RegExp, answers: string[] }.
function expectedClosing(events, requestId) {
  const reply = events.find((e) => e?.dir === 'out' && e.kind === 'reply' && e.requestId === requestId);
  if (reply) {
    const who = { person: /by the person/, coordinator: /by your own decision/, pir: /by pir|standing permission/ }[reply.from] ?? /./;
    const r = reply.result ?? {};
    const given = r.updatedInput?.answers;
    const answers = r.behavior === 'allow' ? (given && typeof given === 'object' ? Object.values(given).map(String) : ['allowed']) : ['denied'];
    return { who, answers, source: `reply from ${reply.from} ${r.behavior}` };
  }
  if (events.some((e) => e?.dir === 'note' && e.kind === 'answered-remotely' && e.requestId === requestId)) return { who: /on the phone/, answers: [], source: 'answered-remotely' };
  if (events.some((e) => e?.dir === 'note' && e.kind === 'exited')) return { who: /closed with no answer/i, answers: [], source: 'worker exited' };
  return null;
}

// statementsMatchRecord() — the mechanical half of checking the agent's words against the record (T14, after
// T09's "you most likely answered it"): (1) no reply of the agent's points the person at an item that was not
// waiting when the reply was written (pointersAt, waitingAt); (2) every "already answered" / "closed with no
// answer" message pir sent the agent names who closed the item and the answer the worker's own log records.
// The rest of what the agent said is read by the worker against the record and listed in the commit message.
export function statementsMatchRecord() {
  return fact('statements-match-record', "The agent's pointers and the answered-first facts it was sent match the record", (bundle) => {
    const evidence = [];
    const replies = agentReplies(bundle);
    if (replies.length === 0) return { pass: false, evidence, detail: "no reply of the agent's in the bundle" };
    let pointers = 0;
    for (const r of replies) {
      for (const task of pointersAt(r.text)) {
        pointers += 1;
        const ok = waitingAt(bundle, task, r.t);
        evidence.push(`${r.key} ${iso(r.t)}: points at ${task} — ${ok ? 'waiting' : 'NOT waiting'}`);
        if (!ok) return { pass: false, evidence, detail: `the agent pointed the person at ${task} at ${iso(r.t)}, when nothing of ${task} was waiting` };
      }
    }
    let facts = 0;
    for (const m of pirToAgent(bundle)) {
      if (!/^(Already |Closed with no answer|No longer waiting)/.test(m.text)) continue;
      facts += 1;
      const task = taskIn(m.text);
      const requestId = requestIdIn(m.text);
      const events = (bundle.transcripts ?? []).filter((x) => x.task === task).flatMap((x) => x.events ?? []).filter((e) => msOf(e.t) <= m.t);
      const first = m.text.split('\n')[0];
      evidence.push(`${m.key} ${iso(m.t)}: told "${first}" (${task} ${requestId ?? 'report'})`);
      if (!requestId) continue; // a report park's closing is quoted from the log itself (closingAnswer); nothing to compare here
      const want = expectedClosing(events, requestId);
      if (!want) return { pass: false, evidence, detail: `pir told the agent ${task}'s ${requestId} was closed, but the worker's log shows no close before ${iso(m.t)}` };
      const missing = want.answers.filter((a) => !first.includes(a));
      if (!want.who.test(first) || missing.length > 0) {
        return { pass: false, evidence, detail: `pir's message on ${task}'s ${requestId} does not match the log (${want.source}${missing.length ? `; missing ${missing.join(', ')}` : ''})` };
      }
    }
    return { pass: true, evidence, detail: `${pointers} pointer(s), each at a waiting item; ${facts} answered-first message(s), each matching the worker's log` };
  });
}

// --- The plan-command facts (pir-plan-command DESIGN §1 success criteria, T17) --------------------
//
// A plan scenario starts from a repo with no plan, so what it must show is the whole of `pir plan`'s
// promise: a reviewed plan on pir/{slug}, a build that finished every task on that branch (its green
// hand-off is handedOffGreenBranch above), the base branch exactly where the seed left it, and the dashboard's one
// row for the slug turned into the build's. Each reads `bundle.planRun` (loadPlanRun) and nothing else.

const NO_PLAN_RUN = { pass: false, evidence: [], detail: 'no plan-run capture in the bundle (plan-run.json)' };

// The planning run ended `reviewed` with a slug, and the plan committed on pir/{slug} reads reviewed
// (parseProgress's gate, the one the build's review gate reads).
export function planReviewedOnBranch() {
  return fact('plan-reviewed-on-branch', 'The planning run left a reviewed plan on pir/{slug} (§2.7)', (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    const evidence = [`outcome: ${pr.outcome ?? '(none)'}`, `slug: ${pr.slug ?? '(none)'}`];
    if (pr.outcome !== 'reviewed' || !pr.slug) {
      return { pass: false, evidence, detail: `the planning run ended ${pr.outcome ?? 'without an outcome'}, not reviewed` };
    }
    if (typeof pr.progress !== 'string') {
      return { pass: false, evidence, detail: `plans/${pr.slug}/PROGRESS.md is not committed on pir/${pr.slug}` };
    }
    const gate = parseProgress(pr.progress).planReviewed;
    evidence.push(`Plan reviewed: ${gate?.reviewed ? 'yes' : 'no'}${gate?.note ? ` — ${gate.note}` : ''}`);
    if (!gate?.reviewed) return { pass: false, evidence, detail: `pir/${pr.slug}'s PROGRESS.md does not read reviewed` };
    return { pass: true, evidence, detail: `plan ${pr.slug} is reviewed on pir/${pr.slug}` };
  });
}

// Every task row of the plan on pir/{slug} is ✅: the build ran the whole plan, not part of it.
export function everyTaskDone() {
  return fact('every-task-done', 'Every task of the plan is ✅ on pir/{slug}', (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    if (typeof pr.progress !== 'string') return { pass: false, evidence: [], detail: 'no PROGRESS.md captured from pir/{slug}' };
    const { tasks, errors } = parseProgress(pr.progress);
    const evidence = [...tasks.map((t) => `${t.num} ${t.name} ${t.state}`), ...errors.map((e) => `parse: ${e}`)];
    if (tasks.length === 0) return { pass: false, evidence, detail: 'the plan has no task rows' };
    if (errors.length) return { pass: false, evidence, detail: `PROGRESS.md has ${errors.length} unreadable row(s)` };
    const open = tasks.filter((t) => t.state !== '✅');
    if (open.length) return { pass: false, evidence, detail: `${open.length} of ${tasks.length} task(s) not ✅: ${open.map((t) => t.num).join(', ')}` };
    return { pass: true, evidence, detail: `all ${tasks.length} task(s) ✅` };
  });
}

// The run's base branch (`main` unless the fixture names another, base-branch T09) points where it pointed
// before the planning run started, or at the remote's copy pir fast-forwarded it to when it started from
// the newest commit (base-branch DESIGN §2.3): planning and building both happen on pir/… branches, and
// the person merges (§1, §8).
export function baseUntouched() {
  return fact('base-untouched', "The base branch's head is unchanged by the run", (bundle) => {
    // A single run's capture carries the same base fields (single-runs T12).
    const pr = bundle.planRun ?? bundle.singleRun;
    if (!pr) return NO_PLAN_RUN;
    const base = pr.base ?? 'main';
    const evidence = [`${base} before: ${pr.baseBefore ?? '(unread)'}`, `${base} after: ${pr.baseAfter ?? '(unread)'}`];
    if (pr.remoteBefore) evidence.push(`origin/${base} at the start: ${pr.remoteBefore}`);
    if (!pr.baseBefore || !pr.baseAfter) return { pass: false, evidence, detail: `${base}'s head was not read at both ends` };
    if (pr.baseAfter === pr.baseBefore) return { pass: true, evidence, detail: `${base} is where the seed left it` };
    if (pr.remoteBefore && pr.baseAfter === pr.remoteBefore) {
      return { pass: true, evidence, detail: `${base} only moved forward to origin/${base}'s commit at the start (§2.3)` };
    }
    return { pass: false, evidence, detail: `${base} moved` };
  });
}

// The planning branch holds the remote's newest base at the start (base-branch DESIGN §2.3, §2.6): pir cut
// it from origin/{base}, not from the stale local copy. Only meaningful for a fixture with a remote.
export function cutFromRemote() {
  return fact('cut-from-remote', "pir/{slug} was cut from the remote's newest base, not the stale local one", (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    const base = pr.base ?? 'main';
    const evidence = [`origin/${base} at the start: ${pr.remoteBefore ?? '(unread)'}`, `local ${base} before: ${pr.baseBefore ?? '(unread)'}`];
    if (!pr.remoteBefore) return { pass: false, evidence, detail: 'no remote head was read at the start' };
    if (pr.remoteBefore === pr.baseBefore) return { pass: false, evidence, detail: `the remote was not ahead of the local ${base}: the check proves nothing` };
    if (pr.cutFromRemote !== true) return { pass: false, evidence, detail: `pir/${pr.slug ?? '{slug}'} does not hold origin/${base}'s commit` };
    return { pass: true, evidence, detail: `pir/${pr.slug} holds origin/${base}'s commit` };
  });
}

// Every line the person reads at the end names the run's base (base-branch DESIGN §2.9): the hand-off is
// `git switch {base} && git merge pir/{slug}`, the report footer says `Synced with `{base}` at {sha}` with
// the remote's commit, and nothing the command printed says `main` (apart from the kept `main-sync` label)
// unless the base is main.
export function handedOffOnBase() {
  return fact('handed-off-on-base', 'The hand-off, the report footer and the finished line name the run\'s base', (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    const base = pr.base ?? 'main';
    const slug = pr.slug;
    const evidence = [];
    const out = bundle.coordinatorOut ?? '';
    const offer = `git switch ${base} && git merge pir/${slug}`;
    // renderHandoff's own line, or the agent's `✔ ready to merge · {offer}` footer. A run the finisher took
    // over prints no offer (finisher DESIGN §2.1; the finisher is told the base itself): its finished line
    // `✔ pir/{slug} is in {base}.` is then the end line that must name the base.
    const outLines = out.split('\n').map((l) => l.trim());
    const finished = `✔ pir/${slug} is in ${base}.`;
    if (outLines.some((l) => l === offer || l.endsWith(` · ${offer}`))) evidence.push(`coordinator.out: ${offer}`);
    else if (outLines.some((l) => /^◆ finisher\b/.test(l)) && outLines.some((l) => l.startsWith(finished))) evidence.push(`coordinator.out: ${finished} (the finisher took over)`);
    else return { pass: false, evidence, detail: `coordinator.out has no \`${offer}\` line` };
    const report = bundle.steps?.merged?.report ?? '';
    const footer = report.split('\n').find((l) => l.startsWith('Synced with '));
    if (!footer) return { pass: false, evidence, detail: 'the report read at the merge has no `Synced with` footer' };
    evidence.push(`REPORT.md: ${footer}`);
    const m = /^Synced with `([^`]+)` at `([0-9a-f]+)`/.exec(footer);
    if (!m || m[1] !== base) return { pass: false, evidence, detail: `the footer does not name ${base}` };
    if (pr.remoteBefore && !pr.remoteBefore.startsWith(m[2])) return { pass: false, evidence, detail: `the footer's commit is not origin/${base}'s ${pr.remoteBefore.slice(0, 12)}` };
    if (base !== 'main') {
      const saysMain = out.split('\n').filter((l) => /\bmain\b/.test(l.replaceAll('main-sync', '')));
      if (saysMain.length) {
        evidence.push(...saysMain.map((l) => `coordinator.out: ${l.trim()}`));
        return { pass: false, evidence, detail: `${saysMain.length} line(s) of coordinator.out say main` };
      }
    }
    return { pass: true, evidence, detail: `every end line names ${base}` };
  });
}

// The person merged on the remote only (the harness's `mergeWhenReady: 'remote'`, as a merge done on GitHub):
// the local base never gained the feature branch, and the command still saw the merge and finished
// (base-branch DESIGN §2.8's watch).
export function finishedOnRemoteMerge() {
  return fact('finished-on-remote-merge', 'A merge done on the remote only was seen and the run finished', (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    const base = pr.base ?? 'main';
    const merged = bundle.steps?.merged;
    const evidence = [];
    if (merged?.into !== `origin's ${base}`) return { pass: false, evidence, detail: `the harness did not merge on origin's ${base}` };
    evidence.push(`merged ${merged.branch} into ${merged.into} at ${merged.at}`);
    evidence.push(`origin/${base} after: ${pr.remoteAfter ?? '(unread)'}`, `local ${base} after: ${pr.baseAfter ?? '(unread)'}`);
    if (!pr.remoteAfter || pr.remoteAfter === pr.remoteBefore) return { pass: false, evidence, detail: `origin/${base} did not move` };
    if (pr.baseAfter === pr.remoteAfter) return { pass: false, evidence, detail: `the local ${base} moved too: the merge was not on the remote only` };
    const finished = (bundle.coordinatorOut ?? '').split('\n').find((l) => l.includes(`is in ${base}. The run is finished.`));
    if (!finished) return { pass: false, evidence, detail: `the command did not finish on the merge (no "is in ${base}" line)` };
    evidence.push(`coordinator.out: ${finished.trim()}`);
    return { pass: true, evidence, detail: `the remote-only merge was seen; the run finished` };
  });
}

// The dashboard holds one row for the slug and it is the build's (`kind 'work'`, §2.8, §2.10): the go
// turned the planning run's row into the build's, and no row is left under the temporary run id.
export function indexRowIsWork() {
  return fact('index-row-is-work', "The slug's index row flipped from plan to work at the go (§2.8)", (bundle) => {
    const pr = bundle.planRun;
    if (!pr) return NO_PLAN_RUN;
    const records = Array.isArray(pr.records) ? pr.records : [];
    const evidence = records.map((r) => `${r?.slug}: kind ${r?.kind ?? 'work'}, final ${r?.finalState ?? 'none'}`);
    const leftover = pr.runId ? records.filter((r) => r?.slug === pr.runId) : [];
    if (leftover.length) return { pass: false, evidence, detail: `a row is still under the run id ${pr.runId}` };
    const mine = records.filter((r) => r?.slug === pr.slug);
    if (mine.length !== 1) return { pass: false, evidence, detail: `${mine.length} row(s) for ${pr.slug ?? '(no slug)'}, expected one` };
    const kind = mine[0].kind ?? 'work';
    if (kind !== 'work') return { pass: false, evidence, detail: `the row for ${pr.slug} is kind ${kind}` };
    return { pass: true, evidence, detail: `one row for ${pr.slug}, kind work` };
  });
}

// --- The live check of a single run (single-runs T12, DESIGN §5.1) ---------------------------------
//
// Each reads `bundle.singleRun` (loadSingleRun) and nothing else.

const NO_SINGLE_RUN = { pass: false, evidence: [], detail: 'no single-run capture in the bundle (single-run.json)' };

// The program recorded its own end, and that end is `ready`: the builder's change and the reviewer's pass
// both went green under pir's tests (§2.4).
export function singleReady() {
  return fact('single-ready', 'The single run finished `ready` (§2.4)', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const evidence = [`outcome: ${sr.outcome ?? '(none)'}`, `final status: ${sr.finalState ?? '(none)'}`, `ended: ${sr.end ?? '(unknown)'}`];
    if (sr.outcome !== 'ready') return { pass: false, evidence, detail: `the run ended ${sr.outcome ?? 'without an outcome'}, not ready` };
    if (sr.finalState !== 'finished') return { pass: false, evidence, detail: `the program recorded ${sr.finalState ?? 'no final status'}, not finished` };
    return { pass: true, evidence, detail: `ready, as ${sr.name}` };
  });
}

// pir/{name} carries at least one commit the builder made (the commits up to the head pir tested green
// before it renamed the run and opened the reviewer), and the fixture's test passes at the branch's tip.
// The seeded test failing on the base is required too: otherwise the run proved nothing was fixed.
export function singleBuilderCommitGreen() {
  return fact('single-builder-commit-green', 'pir/{name} has a builder commit and the test passes on it', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const builder = Array.isArray(sr.builderCommits) ? sr.builderCommits : [];
    const evidence = [
      `builder head: ${sr.builderHead ?? '(not found in the program log)'}`,
      ...builder.map((c) => `builder commit: ${c}`),
      `test on the base: ${sr.testAtBase?.ok == null ? '(not run)' : sr.testAtBase.ok ? 'green' : 'red'}`,
      `test at pir/${sr.name ?? '?'}'s tip: ${sr.testAtTip?.ok == null ? '(not run)' : sr.testAtTip.ok ? 'green' : 'red'}`,
    ];
    if (builder.length === 0) return { pass: false, evidence, detail: 'no commit by the builder on the branch' };
    if (sr.testAtBase?.ok !== false) return { pass: false, evidence, detail: 'the seeded test did not fail on the base, so nothing was shown fixed' };
    if (sr.testAtTip?.ok !== true) return { pass: false, evidence, detail: `the test does not pass at pir/${sr.name}'s tip` };
    return { pass: true, evidence, detail: `${builder.length} builder commit(s); red on the base, green at the tip` };
  });
}

// The index holds one entry for the run, `kind: 'single'`, under the builder's name, and none is left
// under the run id (the rename, §2.4 step 4).
export function singleIndexUnderName() {
  return fact('single-index-under-name', "The run's index entry is kind single under the builder's name", (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const records = Array.isArray(sr.records) ? sr.records : [];
    const evidence = records.map((r) => `${r?.slug}: kind ${r?.kind ?? 'work'}, final ${r?.finalState ?? 'none'}`);
    if (!sr.name) return { pass: false, evidence, detail: 'the run never took a name' };
    const leftover = sr.runId ? records.filter((r) => r?.slug === sr.runId) : [];
    if (leftover.length) return { pass: false, evidence, detail: `an entry is still under the run id ${sr.runId}` };
    const mine = records.filter((r) => r?.slug === sr.name);
    if (mine.length !== 1) return { pass: false, evidence, detail: `${mine.length} entries for ${sr.name}, expected one` };
    if (mine[0].kind !== 'single') return { pass: false, evidence, detail: `the entry for ${sr.name} is kind ${mine[0].kind ?? 'work'}` };
    return { pass: true, evidence, detail: `one entry for ${sr.name}, kind single` };
  });
}

// Once the program had ended on its own, nothing it started still ran: no session it recorded in
// workers.json at any point, no test run it recorded in command.json, and not the program itself. Read
// before the runner's own teardown reaps anything, so the teardown cannot make it pass.
export function singleNoSessionLeft() {
  return fact('single-no-session-left', 'No session or command of the run was left running', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const seen = Array.isArray(sr.seen) ? sr.seen : [];
    const survivors = Array.isArray(sr.survivors) ? sr.survivors : null;
    const evidence = seen.map((p) => `${p.what} pid ${p.pid}`);
    if (survivors == null) return { pass: false, evidence, detail: 'what was left running was not read' };
    if (!seen.some((p) => p.what !== 'program')) return { pass: false, evidence, detail: 'no session was ever recorded, so none was shown closed' };
    if (survivors.length) return { pass: false, evidence: [...evidence, ...survivors.map((p) => `still running: ${p.what} pid ${p.pid}`)], detail: `${survivors.length} left running` };
    return { pass: true, evidence, detail: `${seen.length} process(es) seen, none left running` };
  });
}

// --- The live check of a single run's finisher (single-finisher T10, DESIGN §2.2, §2.5, §2.7) ------------
//
// Each reads `bundle.singleRun.finisher` (run.mjs runSingleScenario on a fixture with `finisher`): `moved`, the
// commit the runner made on the base once the build had started; `beforeGo`, its look the first poll the
// finisher's state.json read `awaiting-go`; `afterRun`, its look once the run was over, with the ledger;
// `sessionId`, the finisher's; and `answeredTo`, every session the stand-in answerer wrote to.

const singleFin = (bundle) => bundle.singleRun?.finisher ?? null;
const NO_SINGLE_FIN = { pass: false, evidence: [], detail: 'no finisher record in single-run.json (was the fixture run with `finisher`?)' };

// The program recorded its own end, and it is the finisher's `finished` (§2.10).
export function singleFinished() {
  return fact('single-finished', 'The single run finished `finished`, on the finisher\'s done (§2.10)', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const evidence = [`outcome: ${sr.outcome ?? '(none)'}`, `final status: ${sr.finalState ?? '(none)'}`, `ended: ${sr.end ?? '(unknown)'}`];
    if (sr.outcome !== 'finished') return { pass: false, evidence, detail: `the run ended ${sr.outcome ?? 'without an outcome'}, not finished` };
    if (sr.finalState !== 'finished') return { pass: false, evidence, detail: `the program recorded ${sr.finalState ?? 'no final status'}, not finished` };
    return { pass: true, evidence, detail: `finished, as ${sr.name}` };
  });
}

// When the finisher first waited for the go: the base held the runner's post-start commit but not pir/{name},
// pir/{name} held a `sync {base} into pir/{name}` merge commit, and FINISHED was absent (§2.2, §2.5).
export function singleFinisherWaitedSynced() {
  return fact('single-finisher-waited-synced', 'Before the go: the base moved, pir/{name} synced it in, nothing merged, FINISHED absent', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const fin = singleFin(bundle);
    if (!fin) return NO_SINGLE_FIN;
    const b = fin.beforeGo;
    const base = sr.base ?? 'main';
    const want = `sync ${base} into pir/${sr.name}`;
    const evidence = [
      fin.moved ? `${fin.moved.at}: ${base} moved to ${String(fin.moved.sha).slice(0, 8)} during ${fin.moved.step}` : `${base} was never moved by the runner`,
      ...(b ? [`${b.at}: phase ${b.phase}, ${base} ${String(b.baseSha).slice(0, 8)} holds the move ${b.movedInBase}, holds pir/${sr.name} ${b.branchInBase}, FINISHED ${b.finishedFile}`, ...(b.syncMerges ?? []).map((m) => `merge on the branch: ${m}`)] : []),
    ];
    if (!fin.moved) return { pass: false, evidence, detail: `the runner never moved ${base} after the build started` };
    if (!b) return { pass: false, evidence, detail: 'the finisher never waited for the go (its state.json never read awaiting-go)' };
    if (b.phase !== 'awaiting-go') return { pass: false, evidence, detail: `the look was taken in phase ${b.phase}` };
    if (b.movedInBase !== true) return { pass: false, evidence, detail: `${base} did not hold the post-start commit` };
    if (b.branchInBase) return { pass: false, evidence, detail: `pir/${sr.name} was in ${base} before the go` };
    if (!(b.syncMerges ?? []).includes(want)) return { pass: false, evidence, detail: `no "${want}" merge commit on the branch` };
    if (b.finishedFile) return { pass: false, evidence, detail: 'FINISHED was written before the go' };
    return { pass: true, evidence, detail: `${base} moved and synced in, nothing merged, FINISHED absent` };
  });
}

// The harness's stand-in answerer wrote nothing to the finisher's session, so the go can only have come from
// the person (DESIGN §1 Stance: the go is the person's and only the person's).
export function singleGoLeftToPerson() {
  return fact('single-go-left-to-person', 'The stand-in answerer never answered the finisher', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const fin = singleFin(bundle);
    if (!fin) return NO_SINGLE_FIN;
    const to = Array.isArray(fin.answeredTo) ? fin.answeredTo : null;
    const evidence = [`finisher session: ${fin.sessionId ?? '(none)'}`, `answerer wrote to: ${to ? to.join(', ') || '(nobody)' : '(not recorded)'}`];
    if (!fin.sessionId) return { pass: false, evidence, detail: 'the finisher\'s session id was not read' };
    if (!to) return { pass: false, evidence, detail: 'what the answerer wrote was not recorded' };
    if (to.includes(fin.sessionId)) return { pass: false, evidence, detail: 'the answerer wrote to the finisher' };
    return { pass: true, evidence, detail: `${to.length} answer(s), none to the finisher` };
  });
}

// After the run: pir/{name} is in the base, FINISHED is in the main checkout, and the finisher's ledger holds
// a go by the person or the phone (§2.7).
export function singleFinisherFinishedAfterGo() {
  return fact('single-finisher-finished-after-go', 'After the person\'s go the finisher merged pir/{name} into the base and wrote FINISHED', (bundle) => {
    const sr = bundle.singleRun;
    if (!sr) return NO_SINGLE_RUN;
    const fin = singleFin(bundle);
    if (!fin) return NO_SINGLE_FIN;
    const a = fin.afterRun;
    const base = sr.base ?? 'main';
    if (!a) return { pass: false, evidence: [], detail: 'no look after the run' };
    const go = goLine(a.ledger);
    const evidence = [`${a.at}: ${base} ${String(a.baseSha).slice(0, 8)} holds pir/${sr.name} ${a.branchInBase}, FINISHED ${a.finishedFile}`, ...(go ? [`ledger ${go.t}: go by ${go.by}, ${go.from} → ${go.to}`] : [])];
    if (!go) return { pass: false, evidence, detail: 'the finisher\'s ledger has no go line' };
    if (go.by !== 'person' && go.by !== 'phone') return { pass: false, evidence, detail: `the go came by ${go.by}, not the person or the phone` };
    if (!a.branchInBase) return { pass: false, evidence, detail: `pir/${sr.name} is not in ${base}` };
    if (!a.finishedFile) return { pass: false, evidence, detail: 'FINISHED is not in the main checkout' };
    return { pass: true, evidence, detail: `go by ${go.by}, pir/${sr.name} in ${base}, FINISHED present` };
  });
}

// --- Running a scenario's facts and rendering the verdict ----------------------------------------

// checkScenario(spec, bundle) → { scenario, pass, facts:[{ id, label, pass, evidence, detail }] }. Runs
// every declared fact over the one bundle; the scenario passes only if every fact passes (one failing
// fact fails the scenario). A fact whose check throws is reported failed, never allowed to abort the
// run — a bad predicate must not hide the others' verdicts.
// --- The live check of the finisher (finisher T10, DESIGN §2.7, §2.9, §5.1) ---------------------------
//
// These read `steps.finisher`, the runner's two looks at the scratch repo (run.mjs createScenarioSteps with
// `watchFinisher`): `beforeGo`, taken the first poll the finisher waited for the go, and `afterRun`, taken
// once the run was over, with the finisher's ledger.

const finisherSteps = (bundle) => bundle.steps?.finisher ?? null;
const goLine = (ledger) => (ledger ?? []).find((l) => l?.kind === 'go') ?? null;

// finisherWaitedForGo() — the finisher reached `awaiting-go` and, at that moment, the run's base had not
// moved, the feature branch was in no branch but pir's own, the main checkout was on the branch it started on
// and the rules' FINISHED file was absent: it looked and touched nothing.
export function finisherWaitedForGo() {
  return fact('finisher-waited-for-go', 'The finisher waited for the go with the base unmoved, nothing switched and FINISHED absent', (bundle) => {
    const fin = finisherSteps(bundle);
    const b = fin?.beforeGo;
    const base = fin?.base ?? 'main';
    const evidence = b
      ? [`${b.at}: phase ${b.phase}, ${base} ${String(b.baseSha).slice(0, 8)} (start ${String(fin.baseAtStart).slice(0, 8)}), branch in ${base} ${b.branchInBase}, checkout on ${b.checkout} (start ${fin.checkoutAtStart}), FINISHED ${b.finishedFile}`]
      : [];
    if (!fin) return { pass: false, evidence, detail: 'no finisher record in steps.json (was the scenario run with watchFinisher?)' };
    if (!b) return { pass: false, evidence, detail: 'the finisher never waited for the go (no status showed it in awaiting-go)' };
    if (b.phase !== 'awaiting-go') return { pass: false, evidence, detail: `the look was taken in phase ${b.phase}` };
    if (b.baseMoved || b.branchInBase) return { pass: false, evidence, detail: `${base} moved before the go` };
    if ((b.strays ?? []).length) return { pass: false, evidence, detail: `the branch was merged into ${b.strays.join(', ')} before the go` };
    if ((b.checkout ?? null) !== (fin.checkoutAtStart ?? null)) return { pass: false, evidence, detail: `the main checkout was switched to ${b.checkout} before the go` };
    if (b.finishedFile) return { pass: false, evidence, detail: 'FINISHED was written before the go' };
    return { pass: true, evidence, detail: `awaiting-go, ${base} unmoved, checkout not switched, FINISHED absent` };
  });
}

// finisherFinishedOnPhoneGo() — after the run the feature branch is in the run's base and in no other branch,
// the main checkout is on the base, FINISHED is in the main checkout, the ledger holds a go `by: 'phone'`,
// and the run ended on the finisher's done (`✔ finished:` in coordinator.out, not the hand merge's line).
export function finisherFinishedOnPhoneGo() {
  return fact('finisher-finished-on-phone-go', 'After a go from the phone the finisher merged into the run\'s base only, wrote FINISHED, and ended the run', (bundle) => {
    const fin = finisherSteps(bundle);
    const a = fin?.afterRun;
    const base = fin?.base ?? 'main';
    const evidence = [];
    if (!a) return { pass: false, evidence, detail: 'no look after the run in steps.json' };
    evidence.push(`${a.at}: ${base} ${String(a.baseSha).slice(0, 8)}, branch in ${base} ${a.branchInBase}, also in [${(a.strays ?? []).join(', ')}], checkout on ${a.checkout}, FINISHED ${a.finishedFile}`);
    const go = goLine(a.ledger);
    if (go) evidence.push(`ledger ${go.t}: go by ${go.by}, ${go.from} → ${go.to}`);
    const finished = (bundle.coordinatorOut ?? '').split('\n').find((l) => l.startsWith('✔ finished:'));
    if (finished) evidence.push(`coordinator.out: ${finished.trim()}`);
    if (!go) return { pass: false, evidence, detail: 'the ledger has no go line' };
    if (go.by !== 'phone') return { pass: false, evidence, detail: `the go came by ${go.by}, not the phone` };
    if (!a.branchInBase) return { pass: false, evidence, detail: `the feature branch is not in ${base}` };
    if ((a.strays ?? []).length) return { pass: false, evidence, detail: `the feature branch was also merged into ${a.strays.join(', ')}` };
    if (a.checkout != null && a.checkout !== base) return { pass: false, evidence, detail: `the main checkout was left on ${a.checkout}, not ${base}` };
    if (!a.finishedFile) return { pass: false, evidence, detail: 'FINISHED is not in the main checkout' };
    if (!finished) return { pass: false, evidence, detail: 'the run did not end on the finisher\'s done (no "✔ finished:" line in coordinator.out)' };
    return { pass: true, evidence, detail: `go by phone, branch in ${base} only, FINISHED present, run finished by the finisher` };
  });
}

// finisherAlerted() — the flow log shows the finisher's alerts sent: one before the go (ready) and one after
// it (finished). What the phone showed, and where the tap led, is the person's to say (DESIGN §5.1).
export function finisherAlerted() {
  return fact('finisher-alerted', 'The finisher\'s ready alert went out before the go and its finished alert after', (bundle) => {
    const sends = String(bundle.flowText ?? '')
      .split('\n')
      .filter((l) => / notify (send|reminder) finisher .* ok /.test(`${l} `));
    const evidence = sends.map((l) => l.trim());
    const go = goLine(finisherSteps(bundle)?.afterRun?.ledger);
    if (!go) return { pass: false, evidence, detail: 'the ledger has no go line to split the alerts by' };
    const goMs = Date.parse(go.t);
    const atMs = (l) => Date.parse(l.slice(0, l.indexOf(' ')));
    const before = sends.filter((l) => atMs(l) <= goMs);
    const after = sends.filter((l) => atMs(l) > goMs);
    if (!before.length) return { pass: false, evidence, detail: 'no finisher alert was sent before the go' };
    if (!after.length) return { pass: false, evidence, detail: 'no finisher alert was sent after the go' };
    return { pass: true, evidence, detail: `${before.length} alert(s) before the go, ${after.length} after` };
  });
}

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
