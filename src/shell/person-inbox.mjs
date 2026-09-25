// The person's input, from the `pir` screen to a worker (plans/live-workers DESIGN §2.5–§2.8). The screen
// and the coordinator are separate processes, so the screen drops one JSON file per input into
// `control/inbox/` (dropPersonInput) and the coordinator forwards each one over the platform the moment
// it lands (startPersonInbox), outside the 5 s pass. The same module holds the per-worker "do not ask
// this worker again" grants, which the platform consults on every permission request (createGrants).
//
// Every outcome is written down so nothing the person sends disappears silently: a forwarded input is the
// worker's `dir:"out", from:"person"` log entry; one for a worker that is gone, or answering a request no
// longer pending, is an `undelivered` note in that worker's log; and every drop, delivered, undelivered or
// invalid, gets one line in the run log.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateDrop, grantFrom, decidePermission } from '../core/person-input.mjs';
import { allowResult, denyResult, answersResult, declineQuestionsResult } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { drainDropFolder, waitForDrop } from './drop-folder.mjs';

// How long the forwarder's wait lasts when no watch event arrives. The coordinator also drains once per
// pass, so this only matters while a pass is not running; it matches the pass interval.
const BACKSTOP_MS = 5000;

export const inboxDirOf = (controlDir) => join(controlDir, 'inbox');

// ---- The screen's side. ----

// dropPersonInput(controlDir, input, { coordinatorAlive, now }) → { ok: true } | { ok: false, reason }.
// `coordinatorAlive` is the screen's verdict that the open run is `running` (the dashboard's classifyRun,
// DESIGN §2.5), a boolean or a function returning one. When it is not, nothing is written and the reason
// is `not-running`, so the view can say so and keep the typed text. An input that does not validate is
// refused with the validator's words and never written either. The file lands temp-then-rename, so the
// forwarder never reads half of it.
export function dropPersonInput(controlDir, input, { coordinatorAlive, now = Date.now } = {}) {
  const alive = typeof coordinatorAlive === 'function' ? coordinatorAlive() : coordinatorAlive === true;
  if (!alive) return { ok: false, reason: 'not-running' };
  const v = validateDrop(input);
  if (!v.ok) return { ok: false, reason: v.error };
  const name = `${now()}-${Math.random().toString(36).slice(2, 10)}.json`;
  try {
    writeJsonAtomic(join(inboxDirOf(controlDir), name), v.input);
  } catch (err) {
    return { ok: false, reason: `could not write the input: ${err?.message ?? err}` };
  }
  return { ok: true };
}

// ---- The grants (DESIGN §2.6). ----

// createGrants() → { add(workerId, grant), decide(workerId, request) }. One grant list per worker, in
// memory for the coordinator's life and never written to any settings file (user 2026-09-24). `grant` is
// core's grantFrom(request); a null grant (no `addRules` suggestion, or one Claude flagged
// suppressAlwaysAllowRule) adds nothing. decide → 'allow-by-grant' | 'ask', core's decidePermission.
export function createGrants() {
  const byWorker = new Map();
  return {
    add(workerId, grant) {
      if (!grant) return false;
      if (!byWorker.has(workerId)) byWorker.set(workerId, []);
      byWorker.get(workerId).push(grant);
      return true;
    },
    decide(workerId, request) {
      return decidePermission(byWorker.get(workerId) ?? [], request);
    },
  };
}

// ---- The coordinator's side. ----

// startPersonInbox({ controlDir, platform, grants, watch, log }) → { inboxDir, drain(), stop() }.
// Starts a forwarder that waits on inbox/ (drop-folder's waitForDrop, the same watcher the loop's own
// wait uses) and drains the moment a file lands; the coordinator also calls drain() once per pass as a
// backstop. drain() reads every *.json in name order, validates it, forwards it, logs the outcome and has
// already deleted it; it returns the outcomes, for the tests. `platform` is createPlatform's: send,
// interrupt, answer, pending, note, logPathOf. `log` is the run log's line writer.
export function startPersonInbox({ controlDir, platform, grants = createGrants(), watch, log = () => {} }) {
  const inboxDir = inboxDirOf(controlDir);
  // The folder must exist for fs.watch to watch it; the screen's first drop would create it too late.
  mkdirSync(inboxDir, { recursive: true });
  const say = (line) => {
    try {
      log(`person input: ${line}`);
    } catch {
      /* the run log must never break forwarding */
    }
  };

  function drain() {
    const outcomes = [];
    const values = drainDropFolder(inboxDir, {
      onBad: (name, err) => {
        say(`invalid drop ${name} deleted: ${err?.message ?? err}`);
        outcomes.push({ outcome: 'invalid', file: name, reason: String(err?.message ?? err) });
      },
    });
    for (const value of values) {
      const v = validateDrop(value);
      if (!v.ok) {
        say(`invalid drop deleted: ${v.error}`);
        outcomes.push({ outcome: 'invalid', reason: v.error });
        continue;
      }
      let result;
      try {
        result = forward(v.input);
      } catch (err) {
        // A platform failure on one input must not stop the rest, nor the watcher.
        result = { outcome: 'undelivered', reason: `forwarding failed: ${err?.message ?? err}` };
      }
      const { to, kind } = v.input;
      say(`${kind} for ${to}: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`);
      outcomes.push({ ...result, to, kind });
    }
    return outcomes;
  }

  function forward(input) {
    const { to, kind } = input;
    // An id this coordinator never spawned has no conversation log to note it in; the run log has it.
    if (platform.logPathOf(to) == null) return { outcome: 'undelivered', reason: 'no such worker in this run' };
    if (kind === 'message') return delivered(platform.send(to, input.text, { from: 'person' }), 'the worker has exited');
    if (kind === 'interrupt') return delivered(platform.interrupt(to, { from: 'person' }), 'the worker has exited');

    const request = platform.pending(to).find((r) => r.requestId === input.requestId);
    // Answering what is not pending: the request was answered already (twice, or from two screens,
    // DESIGN §2.14), cancelled by an interrupt, or died with its worker.
    const wantKind = kind === 'permission' ? 'permission' : 'questions';
    if (!request || request.kind !== wantKind) {
      const reason = !request ? 'the request is no longer pending' : `the request is a ${request.kind}, not a ${wantKind}`;
      platform.note(to, 'undelivered', { what: 'reply', from: 'person', requestId: input.requestId, input: kind, reason });
      return { outcome: 'undelivered', reason };
    }

    let result;
    if (kind === 'permission') {
      result = input.decision === 'deny' ? denyResult(request, input.text) : allowResult(request);
    } else if (kind === 'answers') {
      result = answersResult(request, input.answers);
    } else {
      result = declineQuestionsResult(request, input.text);
    }
    const sent = delivered(platform.answer(to, input.requestId, result, { from: 'person' }), 'the request is no longer pending');
    if (sent.outcome === 'delivered' && kind === 'permission' && input.decision === 'allow-always') {
      grants.add(to, grantFrom(request));
      allowCoveredPending(to);
    }
    return sent;
  }

  // A grant just added also covers any other request of that worker already waiting on the person: it is
  // allowed as a later one would be (DESIGN §2.6), by pir and logged `delivered-by-grant`.
  function allowCoveredPending(to) {
    for (const r of platform.pending(to)) {
      if (r.kind !== 'permission' || grants.decide(to, r) !== 'allow-by-grant') continue;
      if (platform.answer(to, r.requestId, allowResult(r), { from: 'pir' }).ok) {
        platform.note(to, 'delivered-by-grant', { requestId: r.requestId, toolName: r.toolName });
      }
    }
  }

  const delivered = (r, reason) => (r?.ok ? { outcome: 'delivered' } : { outcome: 'undelivered', reason });

  // The forwarder: wait for a drop, drain, repeat, until stop(). The wait is unref'd so it never holds the
  // coordinator's process open on its own.
  const abort = new AbortController();
  (async () => {
    drain();
    while (!abort.signal.aborted) {
      await waitForDrop(inboxDir, BACKSTOP_MS, { signal: abort.signal, unref: true, ...(watch ? { watch } : {}) });
      if (abort.signal.aborted) break;
      try {
        drain();
      } catch {
        /* drain already contains its own failures; never let the forwarder die */
      }
    }
  })();

  return {
    inboxDir,
    drain,
    stop() {
      abort.abort();
    },
  };
}
