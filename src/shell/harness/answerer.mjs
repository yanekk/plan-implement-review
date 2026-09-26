// The harness's stand-in for the person (live-workers T18). A fixture that forces a question set and a
// permission request (live-workers-demo) parks its workers until somebody answers, and an unattended
// harness run has nobody at the `pir` screen. So a scenario may declare `answerPending`, and the runner
// then answers each pending request exactly as the screen would: one drop per request into
// control/inbox/ (person-inbox dropPersonInput, DESIGN §2.5). The coordinator's own forwarder carries it
// to the worker and logs the reply `from:"person"`, so the whole person path below the screen is the one
// the live run exercises; only the keys are not pressed.
//
// The choice is fixed and dull on purpose: a permission is allowed once; a question gets the text the
// scenario says to type on its Other line (`typed`, keyed by the question; the key `*` matches any question
// not named, for a worker whose wording the fixture cannot know), else a pick-several question its first two
// options and a pick-one question its first. Anything subtler is the person's judgement and belongs to the hands-on run.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { readEntry, workerActivity } from '../../core/stream.mjs';
import { dropPersonInput } from '../person-inbox.mjs';
import { parseLog, parseLogName, logSessionId } from './capture.mjs';

// answerFor(request, typed) → the inbox drop (without `to`) that answers one pending request, or null for
// a request this stand-in cannot answer (a question with no options and nothing to type). The answer to a
// question is its labels joined ", ", as the picker sends them (§2.7). Pure.
export function answerFor(request, typed = {}) {
  if (request?.kind === 'permission') return { kind: 'permission', requestId: request.requestId, decision: 'allow' };
  if (request?.kind === 'questions') {
    const answers = {};
    for (const q of request.questions ?? []) {
      const labels = (q.options ?? []).map((o) => o.label).filter(Boolean);
      const answer = Object.hasOwn(typed, q.question)
        ? typed[q.question]
        : Object.hasOwn(typed, '*')
          ? typed['*']
          : labels.slice(0, q.multiSelect ? 2 : 1).join(', ');
      if (!answer) return null;
      answers[q.question] = answer;
    }
    if (Object.keys(answers).length === 0) return null;
    return { kind: 'answers', requestId: request.requestId, answers };
  }
  return null;
}

// pendingDrops(logs, answered, typed) → the drops to write now, each { to, kind, requestId, … }. `logs` is
// [{ file, entries }], one per conversation log; the worker's id (the `to`) is the session id its own
// messages carry (capture logSessionId, DESIGN §2.1). A request already in `answered` is skipped, so a
// drop the coordinator has not forwarded yet is never written twice. Pure.
//
// `say` ({ <task>: <text> }) sends that task's implementer a message the first time it is idle with nothing
// pending, the person's go that the T04 practice task waits for (user 2026-09-26). Its key in `answered` is
// `say:<task>`, carried on the drop as `key` (the inbox validator drops the field).
export function pendingDrops(logs, answered = new Set(), typed = {}, say = {}, replies = null) {
  const out = [];
  for (const { file, entries } of logs) {
    const to = logSessionId(entries);
    if (!to) continue;
    const activity = workerActivity(entries);
    for (const request of activity.pending) {
      if (answered.has(request.requestId)) continue;
      const drop = answerFor(request, typed);
      if (drop) out.push({ to, ...drop, key: request.requestId });
    }
    const name = parseLogName(file);
    const text = name && name.role === 'implement' ? say[name.task] : undefined;
    const exited = entries.some((e) => e?.dir === 'note' && e.kind === 'exited');
    if (text && !exited && activity.state === 'idle' && !answered.has(`say:${name.task}`)) {
      out.push({ to, kind: 'message', text, key: `say:${name.task}` });
    }
  }
  if (replies?.text) {
    let sent = repliesSent(answered);
    for (const r of dueReplies(logs, answered)) {
      if (sent >= (replies.cap ?? Infinity)) break;
      out.push({ to: r.to, kind: 'message', text: replies.text, key: r.key });
      sent += 1;
    }
  }
  return out;
}

// --- The canned reply to a planning session (pir-plan-command DESIGN §5.2, T17) ------------------
//
// A real planner and reviewer do not only ask through AskUserQuestion: most of a planning conversation is
// the session ending its turn on a question put in plain words, and then waiting for the person. With
// nobody at the screen that wait never ends. So a plan scenario declares `replies = { text, cap }`: a
// planning session (a `plan-{n}` or `review-{n}` log) that is idle, has nothing pending, and spoke last
// gets `text` once for that turn. The cap bounds the whole run, so a planner that never converges is
// stopped by the runner rather than fed for ever.

// replyTurn(entries) → the turn a reply is due for (workerActivity's count of ended turns), or null. Due
// only when the session is idle with nothing pending, has not exited, and the last thing in its log is
// its own text: a message or an answer from pir or the person, a tool call or its result after that text
// all mean the session is not waiting on words from the person. Pure.
export function replyTurn(entries = []) {
  if (entries.some((e) => e?.dir === 'note' && e.kind === 'exited')) return null;
  const activity = workerActivity(entries);
  if (activity.state !== 'idle' || activity.pending.length > 0) return null;
  let last = null;
  for (const entry of entries) {
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'text') last = ev.role === 'assistant' ? 'own' : 'other';
      else if (ev.kind === 'sent' || ev.kind === 'reply' || ev.kind === 'tool-use' || ev.kind === 'tool-result') last = 'other';
    }
  }
  return last === 'own' ? activity.turns : null;
}

// dueReplies(logs, answered) → [{ to, key }] for every planning session a reply is due to now and not yet
// given. The key names the log and the turn, so a session gets one reply per turn however many ticks it
// stays idle. Pure.
export function dueReplies(logs, answered = new Set()) {
  const out = [];
  for (const { file, entries } of logs) {
    if (parseLogName(file)?.task !== 'plan') continue;
    const to = logSessionId(entries);
    const turn = to ? replyTurn(entries) : null;
    if (turn == null) continue;
    const key = `reply:${file}:${turn}`;
    if (!answered.has(key)) out.push({ to, key });
  }
  return out;
}

const repliesSent = (answered) => [...answered].filter((k) => String(k).startsWith('reply:')).length;

// createAnswerer({ controlDir, typed, say, replies, holdReplies, drop, log }) → { tick(), capReached() }.
// Reads every conversation log of the run, answers what is pending, and remembers what it answered.
// `controlDir` is a path or a function returning one, called every tick: a planning run's control folder
// moves at the rename (pir-plan-command DESIGN §2.6), so the plan scenario passes the index record's
// current folder. `holdReplies()` true withholds the canned replies for this tick (the runner holds them
// while a session's report is being acted on, so a finished planner is not talked into another turn).
// capReached() is true once a reply was due and the cap had been spent. `drop` is dropPersonInput with
// the program taken as alive (the runner only ticks while it runs), called as drop(input, controlDir);
// injected so a test sees the drops without an inbox.
export function createAnswerer({
  controlDir,
  typed = {},
  say = {},
  replies = null,
  holdReplies = () => false,
  drop = (input, dir) => dropPersonInput(dir, input, { coordinatorAlive: true }),
  log = () => {},
} = {}) {
  const answered = new Set();
  const dirNow = typeof controlDir === 'function' ? controlDir : () => controlDir;
  let capped = false;
  const readLogs = (controlRoot) => {
    const dir = controlRoot ? join(controlRoot, 'conversations') : null;
    if (!dir || !existsSync(dir)) return [];
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
      const root = dirNow();
      if (!root) return written;
      const logs = readLogs(root);
      const withReplies = replies?.text && !holdReplies() ? replies : null;
      for (const { key, ...d } of pendingDrops(logs, answered, typed, say, withReplies)) {
        const r = drop(d, root);
        if (!r?.ok) {
          log(`answerer: could not answer ${key}: ${r?.reason ?? 'unknown'}`);
          continue;
        }
        answered.add(key);
        written.push(d);
        const verb = d.kind === 'permission' ? 'allowed' : d.kind === 'message' ? `said "${d.text}" as` : 'answered';
        log(`answerer: ${verb} ${key} for ${d.to}`);
      }
      if (withReplies && repliesSent(answered) >= (withReplies.cap ?? Infinity) && dueReplies(logs, answered).length > 0) {
        if (!capped) log(`answerer: reply cap of ${withReplies.cap} spent and a session is still waiting`);
        capped = true;
      }
      return written;
    },
    capReached: () => capped,
  };
}
