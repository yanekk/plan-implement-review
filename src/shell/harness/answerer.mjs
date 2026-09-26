// The harness's stand-in for the person (live-workers T18). A fixture that forces a question set and a
// permission request (live-workers-demo) parks its workers until somebody answers, and an unattended
// harness run has nobody at the `pir` screen. So a scenario may declare `answerPending`, and the runner
// then answers each pending request exactly as the screen would: one drop per request into
// control/inbox/ (person-inbox dropPersonInput, DESIGN §2.5). The coordinator's own forwarder carries it
// to the worker and logs the reply `from:"person"`, so the whole person path below the screen is the one
// the live run exercises; only the keys are not pressed.
//
// The choice is fixed and dull on purpose: a permission is allowed once, a question set gets each
// question's first option. Anything subtler is the person's judgement and belongs to the hands-on run.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { workerActivity } from '../../core/stream.mjs';
import { dropPersonInput } from '../person-inbox.mjs';
import { parseLog, parseLogName, logSessionId } from './capture.mjs';

// answerFor(request) → the inbox drop (without `to`) that answers one pending request, or null for a
// request this stand-in cannot answer (a question with no options). Pure.
export function answerFor(request) {
  if (request?.kind === 'permission') return { kind: 'permission', requestId: request.requestId, decision: 'allow' };
  if (request?.kind === 'questions') {
    const answers = {};
    for (const q of request.questions ?? []) {
      const label = q.options?.[0]?.label;
      if (!label) return null;
      answers[q.question] = label;
    }
    if (Object.keys(answers).length === 0) return null;
    return { kind: 'answers', requestId: request.requestId, answers };
  }
  return null;
}

// pendingDrops(logs, answered) → the drops to write now, each { to, kind, requestId, … }. `logs` is
// [{ file, entries }], one per conversation log; the worker's id (the `to`) is the session id its own
// messages carry (capture logSessionId, DESIGN §2.1). A request already in `answered` is skipped, so a
// drop the coordinator has not forwarded yet is never written twice. Pure.
export function pendingDrops(logs, answered = new Set()) {
  const out = [];
  for (const { entries } of logs) {
    const to = logSessionId(entries);
    if (!to) continue;
    for (const request of workerActivity(entries).pending) {
      if (answered.has(request.requestId)) continue;
      const drop = answerFor(request);
      if (drop) out.push({ to, ...drop });
    }
  }
  return out;
}

// createAnswerer({ controlDir, drop, log }) → { tick() → the drops written this tick }. Reads every
// conversation log of the run, answers what is pending, and remembers what it answered. `drop` is
// dropPersonInput with the coordinator taken as alive (the runner only ticks while it runs); injected so
// a test sees the drops without an inbox.
export function createAnswerer({
  controlDir,
  drop = (input) => dropPersonInput(controlDir, input, { coordinatorAlive: true }),
  log = () => {},
} = {}) {
  const answered = new Set();
  const dir = join(controlDir, 'conversations');
  const readLogs = () => {
    if (!existsSync(dir)) return [];
    const logs = [];
    for (const file of readdirSync(dir)) {
      if (!parseLogName(file)) continue;
      try {
        logs.push({ file, entries: parseLog(readFileSync(join(dir, file), 'utf8')) });
      } catch {
        /* a log that vanished between the listing and the read has nothing to answer */
      }
    }
    return logs;
  };
  return {
    tick() {
      const written = [];
      for (const d of pendingDrops(readLogs(), answered)) {
        const r = drop(d);
        if (!r?.ok) {
          log(`answerer: could not answer ${d.requestId}: ${r?.reason ?? 'unknown'}`);
          continue;
        }
        answered.add(d.requestId);
        written.push(d);
        log(`answerer: ${d.kind === 'permission' ? 'allowed' : 'answered'} ${d.requestId} for ${d.to}`);
      }
      return written;
    },
  };
}
