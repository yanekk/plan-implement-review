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
//               `${ISO} ${type} ${task-or-branch}` (loop.mjs record(), coordinate.mjs answer()): the
//               type is the action (open-feature, spawn, await-idle, review, merge, answer, send-failed,
//               close, halt-close, surface, promote, teardown, ceiling), the rest is a task id (T05), a
//               branch, or free text. The spawn `hello` was retired in T30 (there is no spawn ping).
//               The line does NOT carry a surface's KIND (conflict/question/decision) — loop.mjs
//               writes only type+task — so the question/conflict facts key on the TASK id a scenario
//               names, not on a kind read from the log (see questionRoundTrip / mergeConflictResolved).
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
//               the coordinator's answers ride the coordinator agent's own transcript the same way,
//               because platform.send hands the string to the agent to actually send (T09 bridge), not a
//               child process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordinatorName, parseAgentName } from '../../core/naming.mjs';

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

// A failed answer down-send was recorded, not dropped (C, DESIGN §2.2, T30). When the coordinator's
// answer to a parked worker cannot be delivered (SendMessage errors, or the worker is gone), the bin
// records a `send-failed {task}` flow line so the failure is visible and capturable — the answer is
// never silently lost. This fact keys on that tag: with a task it checks that task's send-failed line,
// without one it checks any send-failed is present. It is exercised by the deterministic C test rather
// than a live fixture, because a live send failure cannot be forced on demand (T30 done-when).
export function sendFailureSurfaced(task) {
  const id = task ? `send-failure-surfaced:${task}` : 'send-failure-surfaced';
  const label = task ? `A failed down-send to ${task} was recorded` : 'A failed down-send was recorded';
  return fact(id, label, (bundle) => {
    const evidence = [];
    const fails = flowOf(bundle, 'send-failed').filter((e) => !task || e.rest === task);
    for (const f of fails) evidence.push(flowLine(f));
    if (fails.length === 0) {
      return {
        pass: false,
        evidence,
        detail: task
          ? `no send-failed line for ${task} — a failed down-send went unrecorded`
          : 'no send-failed line in the flow — a failed down-send would have gone unrecorded',
      };
    }
    return { pass: true, evidence, detail: `${fails.length} send-failed line(s) recorded${task ? ` for ${task}` : ''}` };
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
      // The answer went to whichever session parked (implement or review role), so match by task, not a
      // rebuilt role-suffixed name.
      const answer = sendMessagesOf(coord).find((s) => {
        const p = parseAgentName(stripRef(s.to));
        return p.matches && p.task === task && p.repo === repo && p.plan === plan;
      });
      if (answer) evidence.push(`coordinator → ${stripRef(answer.to)} (answer): ${answer.summary}`);
    }
    return { pass: true, evidence, detail: `${task} was surfaced and then resumed to a merge` };
  });
}

// A coordinator-hit merge conflict was RESOLVED via Option 2 (DESIGN §2.5, T28): the coordinator kept
// the worker alive and parked, delivered the user's decision, the worker resolved on its own branch and
// re-signalled done, and the decided side merged and reached main. This REPLACES the old
// `conflictSurfacedAndParked`/`mergeConflictParked` facts, which asserted the task NEVER merges — only
// ever right for a terminal park, which Option 2 discarded (the terminal park stranded the whole plan's
// shipment behind one clash; the T22 live run then shipped the WRONG side because the worker was closed
// and its task respawned). The fact is task-AGNOSTIC: which of the two same-line tasks merges second —
// and so conflicts — is a timing race (T16 2026-09-11), so it finds the task that took the Option-2
// shape rather than naming it. It reads all of the following off the bundle:
//   - a `surface` for that task, with NO `merge` of it BEFORE the surface (the conflict was caught,
//     nothing bad merged first);
//   - an `answer {task}` flow line (the decision was delivered DOWN to the live worker — the T22 bug
//     was that no answer landed, the worker having been closed);
//   - a `merge {task}` AFTER the surface (the same worker resumed and its now-clean branch merged);
//   - exactly ONE implement session for the task in the timeline (no respawn — the T22 clobber spawned
//     a second implementer);
//   - exactly one `promote` to main, corroborated by one promotion merge in the git log;
//   - and, when the caller passes { file, content }, the final promoted content of that file matches the
//     DECIDED side (bundle.finalFiles, captured by the runner: loadFinalFiles). This is the crux of the
//     T22 regression — main shipped the losing "hi world", opposite the "keep hello there" decision.
export function mergeConflictResolved({ file, content } = {}) {
  return fact('merge-conflict-resolved', 'A coordinator-hit conflict was kept alive, decided, resolved, and the decided side reached main', (bundle) => {
    const evidence = [];
    const surfaces = flowOf(bundle, 'surface').filter((e) => /^T\d+$/.test(e.rest));
    if (surfaces.length === 0) {
      return { pass: false, evidence, detail: 'no task surface — a merge conflict was expected to be surfaced' };
    }
    const merges = flowOf(bundle, 'merge');
    const answers = flowOf(bundle, 'answer');

    // Find the surfaced task that took the Option-2 path: surfaced, not merged before, answered, and
    // then merged. Which task conflicts is a race, so the fact discovers it rather than naming it.
    let resolved = null;
    for (const s of surfaces) {
      const task = s.rest;
      const mergedBefore = merges.find((m) => m.rest === task && m.ts < s.ts);
      const mergedAfter = merges.find((m) => m.rest === task && m.ts >= s.ts);
      const answered = answers.find((a) => a.rest === task);
      if (!mergedBefore && answered && mergedAfter) {
        resolved = { task, surface: s, answered, mergedAfter };
        break;
      }
    }
    if (!resolved) {
      for (const s of surfaces) evidence.push(flowLine(s));
      for (const a of answers) evidence.push(flowLine(a));
      for (const m of merges) evidence.push(flowLine(m));
      return {
        pass: false,
        evidence,
        detail: 'no surfaced task was answered and then merged — the conflict was not resolved through the live worker (the T22 failure)',
      };
    }
    const { task } = resolved;
    evidence.push(flowLine(resolved.surface));
    evidence.push(flowLine(resolved.answered));
    evidence.push(flowLine(resolved.mergedAfter));

    // No respawn: exactly one implement-role session ran the conflicting task. The T22 clobber closed
    // the done worker and spawned a SECOND implementer over the same task. Counted from distinct
    // session ids in the timeline; 0 (the phase was never sampled) cannot prove a respawn, so only >1
    // fails.
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

    // The decision was addressed to the task's worker (supporting, when the coordinator transcript is
    // present): the answer SendMessage went to a name that parses to this task.
    const { repo, plan } = runIdentity(bundle);
    const coord = coordinatorTranscript(bundle);
    if (coord && repo && plan) {
      const ans = sendMessagesOf(coord).find((s) => {
        const p = parseAgentName(stripRef(s.to));
        return p.matches && p.task === task && p.repo === repo && p.plan === plan;
      });
      if (ans) evidence.push(`coordinator → ${stripRef(ans.to)} (answer): ${ans.summary}`);
    }

    // Exactly one promotion reached main (the resolved plan lands once, DESIGN §2.9).
    const promotes = flowOf(bundle, 'promote');
    for (const p of promotes) evidence.push(flowLine(p));
    if (promotes.length !== 1) {
      return { pass: false, evidence, detail: `expected exactly one promote after the resolution, found ${promotes.length}` };
    }
    if (plan) {
      const count = promotionMergeLines(bundle.gitLog, plan).length;
      evidence.push(`git log promotion merges: ${count}`);
      if (count !== 1) {
        return { pass: false, evidence, detail: `git log shows ${count} promotion merge(s) into main, expected 1` };
      }
    }

    // The DECIDED side won: the final promoted content of the contested file matches the decision, not
    // the losing side. This is the T22 regression, so it is the fact's sharpest assertion.
    if (file) {
      const got = (bundle.finalFiles ?? {})[file];
      if (got == null) {
        return { pass: false, evidence, detail: `no captured final content for ${file} — cannot confirm the decided side won (runner did not capture it)` };
      }
      if (String(got).trim() !== String(content).trim()) {
        evidence.push(`main:${file} = ${JSON.stringify(String(got).trim())}`);
        return { pass: false, evidence, detail: `final ${file} is ${JSON.stringify(String(got).trim())}, not the decided ${JSON.stringify(String(content).trim())} — the losing side shipped` };
      }
      evidence.push(`main:${file} = ${JSON.stringify(String(got).trim())} (the decided side)`);
    }

    return { pass: true, evidence, detail: `${task}'s conflict was surfaced, decided, resolved by the live worker, and the decided side merged and promoted once` };
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
      const count = promotionMergeLines(bundle.gitLog, plan).length;
      evidence.push(`git log promotion merges: ${count}`);
      if (count !== 1) {
        return { pass: false, evidence, detail: `git log shows ${count} promotion merge(s) into main, expected 1` };
      }
    }
    return { pass: true, evidence, detail: 'exactly one promotion reached main' };
  });
}

// The `you` task's worker is a HANDS-ON verify session, not an autonomous implementer (DESIGN §2.6,
// T32). The role is encoded in the worker NAME (`{repo} · {plan} · Txx · verify`, §2.8); the flow log
// drops the role (it writes `spawn Txx` only, this file's header), so ONLY the capture timeline — which
// samples full agent names — can prove it. Pass when a worker of `task` is seen with role `verify`; fail
// when it was only ever an implementer, or was never sampled (so no role can be read from data).
export function verifyWorkerSpawned(task) {
  return fact(`verify-worker-spawned:${task}`, `${task}'s worker is a hands-on verify session`, (bundle) => {
    const evidence = [];
    const roles = new Set();
    for (const tick of bundle.timeline ?? []) {
      for (const a of tick.agents ?? []) {
        const p = parseAgentName(a.name);
        if (a.isWorkerOf && p.task === task && p.role) roles.add(p.role);
      }
    }
    for (const r of roles) evidence.push(`${task} worker role seen: ${r}`);
    if (roles.size === 0) {
      return { pass: false, evidence, detail: `no worker of ${task} was sampled in the timeline — its role cannot be read` };
    }
    if (!roles.has('verify')) {
      return { pass: false, evidence, detail: `${task}'s worker(s) were ${[...roles].join(', ')}, not a hands-on verify session` };
    }
    return { pass: true, evidence, detail: `${task} ran as a hands-on verify session` };
  });
}

// A `you` task goes straight from hands-on to merge with NO fresh-review phase (DESIGN §2.6): the
// person's recorded observation is the result, so there is no code for a second session to review. Proven
// from the flow log: a `merge {task}` line (it completed and folded back) and NO `review {task}` line. A
// task that never merged cannot prove it SKIPPED review — it might merely be unfinished — so a missing
// merge fails rather than passing vacuously.
export function youNeverReviewed(task) {
  return fact(`you-never-reviewed:${task}`, `${task} folded back without a fresh-review phase`, (bundle) => {
    const evidence = [];
    const merges = flowOf(bundle, 'merge').filter((e) => e.rest === task);
    const reviews = flowOf(bundle, 'review').filter((e) => e.rest === task);
    for (const m of merges) evidence.push(flowLine(m));
    for (const r of reviews) evidence.push(flowLine(r));
    if (merges.length === 0) {
      return { pass: false, evidence, detail: `no merge of ${task} — it never folded back, so "skipped review" is unproven` };
    }
    if (reviews.length > 0) {
      return { pass: false, evidence, detail: `${task} has ${reviews.length} review line(s) — a you task must skip the fresh-review phase` };
    }
    return { pass: true, evidence, detail: `${task} merged with no review line — it folded back hands-on to merge` };
  });
}

// The hands-on scribe's verification reached main: the plan's FINDINGS.md, promoted, contains the
// hand-verified row (DESIGN §2.6 — the person's recorded observation IS a `you` task's deliverable). A
// CONTAINS check over the final promoted content (bundle.finalFiles, loadFinalFiles), because the merged
// file grows a `✅` row on top of the seed template, so the exact-trim match mergeConflictResolved uses
// won't do. The runner captures `file` because the fixture declares it in `finalContent`. Optional
// corroboration (T32): the load-bearing set is verifyWorkerSpawned + youNeverReviewed + oneMergeToMain.
export function scribeWroteFinding({ file, needle = '✅' } = {}) {
  return fact('scribe-wrote-finding', `the scribe's hand-verified row reached main in ${file}`, (bundle) => {
    const evidence = [];
    const got = (bundle.finalFiles ?? {})[file];
    if (got == null) {
      return { pass: false, evidence, detail: `no captured final content for ${file} — cannot confirm the scribe's row reached main` };
    }
    if (!String(got).includes(needle)) {
      return { pass: false, evidence, detail: `final ${file} does not contain ${JSON.stringify(needle)} — no hand-verified row was written` };
    }
    evidence.push(`main:${file} contains ${JSON.stringify(needle)}`);
    return { pass: true, evidence, detail: `${file} on main carries the scribe's hand-verified row` };
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
      const live = (tick.agents ?? []).filter((a) => a.isWorkerOf);
      // Group live workers by task. A worker that does not parse to a task (should not happen once
      // isWorkerOf is true) is its own slot, keyed by name so it is never silently merged away.
      const byTask = new Map();
      for (const a of live) {
        const key = parseAgentName(a.name).task ?? `?${a.name}`;
        if (!byTask.has(key)) byTask.set(key, []);
        byTask.get(key).push(a);
      }
      // One slot per task in flight, plus one for every EXTRA same-role session on a task — a duplicate
      // implementer or reviewer is a respawn runaway, not the legit implement→review handoff pair.
      let slots = 0;
      for (const group of byTask.values()) {
        const roles = new Set(group.map((a) => parseAgentName(a.name).role ?? '?'));
        slots += 1 + Math.max(0, group.length - roles.size);
      }
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
// the width. It counts implementers only — a reviewer or a hands-on verify scribe is a follow-on session,
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
        if (p.role !== 'implement') continue; // reviewers and verify scribes are not builds in flight
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
