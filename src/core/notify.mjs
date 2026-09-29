// Phone alerts for a build run (reliable-notifications DESIGN §2.1–§2.4, §3.2). Pure: the shell builds a
// view per live build worker each pass, and this module decides what to send, what to repeat once and
// what to clear, and words every alert. `now` is always an argument, so a night of alerts is testable in
// milliseconds. Sending, reading the config and the clock are the shell's (src/shell/ntfy.mjs,
// coordinate.mjs).

import { mainArg } from './conversation.mjs';
import { clipText, plainText } from './text.mjs';

const EXCERPT_MAX = 150;

// Why the question is the person's, as the first words on the lock screen (§2.3). `off` (no agent in this
// run) and `null` (no item to read a reason from) carry no prefix: there is no agent to explain.
const REASON_PREFIX = {
  passed: 'Agent passed it on: ',
  timeout: "Agent didn't answer in time: ",
  reserved: 'Needs your yes: ',
  unavailable: 'Agent unavailable: ',
};

const FALLBACK = 'is waiting for you';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonBlank = (s) => typeof s === 'string' && s.trim() !== '';
// Whether text still shows something once escapes and controls go: a worker's text that is only a colour
// reset would otherwise become a bare `asks:` on the lock screen instead of falling through.
const shows = (s) => typeof s === 'string' && plainText(s).trim() !== '';

// excerpt(text, max) → at most `max` code points of `text` as plain characters on one line, the last one
// `…` when cut. Escapes and control characters go (plainText) and newlines fold to one space, since a
// lock screen shows one paragraph and a raw escape would be sent to the phone as-is.
export function excerpt(text, max = EXCERPT_MAX) {
  const flat = plainText(text).replace(/\s*\n\s*/g, ' ').trim();
  return clipText(flat, max);
}

// The kind part of the message: what the worker wants, cut as a whole to 150 code points so the message
// with the longest reason prefix stays under 190. A question set's `(+N more)` is kept outside the cut
// of the question itself, so a long first question never hides that more are waiting.
function kindPart({ kind, decisionText, lastText, pending }) {
  const list = Array.isArray(pending) ? pending : [];
  if (kind === 'question') {
    // A report park's text is the question as the worker wrote it for the person; a worker that stopped
    // with no report asked in its last assistant text.
    const text = shows(decisionText) ? decisionText : shows(lastText) ? lastText : null;
    return text === null ? FALLBACK : excerpt(`asks: ${text}`);
  }
  if (kind === 'questions') {
    // The oldest pending question set: a session blocks on one AskUserQuestion at a time, and the more
    // count is that set's other questions.
    const req = list.find((p) => p?.kind === 'questions');
    const qs = Array.isArray(req?.questions) ? req.questions : [];
    const first = qs.find((q) => shows(q?.question));
    if (!first) return FALLBACK;
    const more = qs.length > 1 ? ` (+${qs.length - 1} more)` : '';
    return excerpt(`asks: ${first.question}`, EXCERPT_MAX - more.length) + more;
  }
  if (kind === 'permission') {
    const req = list.find((p) => p?.kind === 'permission');
    const tool = typeof req?.toolName === 'string' ? req.toolName : '';
    if (!tool) return FALLBACK;
    const arg = mainArg(tool, isObject(req.input) ? req.input : {});
    return excerpt(`wants to run ${tool}${nonBlank(arg) ? ` ${arg}` : ''}`);
  }
  return FALLBACK;
}

// alertText(...) → { title, message } for a question alert (§2.3). `name` is a helper worker's
// `{label} {slug}`, which stands in for `{task} {role}`. The reason prefix sits outside the 150-code-point
// cut, so the reason always survives a long question.
export function alertText({ plan, task, role, name, why = null, kind, decisionText, lastText, pending } = {}) {
  const who = nonBlank(name) ? name : [task, role].filter(nonBlank).join(' ');
  return {
    title: `${plan ?? ''} · ${who}`,
    message: (REASON_PREFIX[why] ?? '') + kindPart({ kind, decisionText, lastText, pending }),
  };
}

// reminderText(message) → the one reminder's message (§2.3).
export const reminderText = (message) => `Still waiting: ${message}`;

// endAlert(...) → { title, message, tags } for the one alert when the run waits on the person's merge
// (§2.4). Red names what failed: an unresolved main-sync outranks the test reason, since the tests never
// ran against the base. `base` is the run's base branch (base-branch DESIGN §2.9), default `main`; the
// ready line switches to it first so the command is right whichever branch is checked out.
export function endAlert({ slug, ready, taskCount, reason, unresolved, base = 'main' } = {}) {
  if (ready) {
    return { title: `${slug} · ready to merge`, message: `All ${taskCount} tasks merged. git switch ${base} && git merge pir/${slug}`, tags: ['tada'] };
  }
  const cut = excerpt(reason ?? '');
  let message;
  if (unresolved) message = `Merge with ${base} unresolved on pir/${slug}`;
  else if (cut !== '') message = `Tests red on pir/${slug}: ${cut}`;
  else message = `Tests red on pir/${slug}`;
  return { title: `${slug} · not ready`, message, tags: ['warning'] };
}

// holdAlert({ slug, hold }) → { title, message, tags } for the one alert when the end-of-run sync is held
// (base-branch DESIGN §2.8): the base could not be fetched, or the local and remote bases split apart.
// `hold.text` is holdText's short reason, read on the lock screen as `{slug} · waiting` over the reason.
export function holdAlert({ slug, hold } = {}) {
  const reason = excerpt(hold?.text ?? '');
  return { title: `${slug ?? ''} · waiting`, message: reason === '' ? 'the end of the run is held' : reason, tags: ['hourglass'] };
}

// ---- The episode machine (§2.1, §2.2, §3.2) ----
//
// An episode is one continuous stretch in which a worker is the person's. Its title and message are fixed
// at its start, so a reason or excerpt that shifts mid-wait never rewords the reminder. `counts` survives
// the episode, so the same worker waiting again gets a new sequence id and a new alert.

export const newNotifyState = () => ({ episodes: {}, counts: {} });

// notifyStep(state, views, now, opts) → { state, actions }. The input state is not mutated.
//   views: [{ id, waiting: kind|null, title, message, remote: 'wanted'|'off'|'refused', url }]
//   actions: { type: 'send', id, seq, title, message, click, reminder } | { type: 'clear', id, seq }
export function notifyStep(state, views, now, { remindMs = 900_000, linkWaitMs = 20_000 } = {}) {
  const prev = state ?? newNotifyState();
  const episodes = {};
  const counts = { ...(prev.counts ?? {}) };
  const actions = [];
  const seen = new Set();

  for (const v of Array.isArray(views) ? views : []) {
    if (!v || typeof v.id !== 'string' || seen.has(v.id) || !v.waiting) continue;
    seen.add(v.id);
    let ep = prev.episodes?.[v.id];
    if (!ep) {
      const n = (counts[v.id] ?? 0) + 1;
      counts[v.id] = n;
      ep = { n, startedAt: now, sentAt: null, reminded: false, seq: `pir-${v.id}-${n}`, title: v.title ?? '', message: v.message ?? '' };
    } else {
      ep = { ...ep };
    }
    const click = nonBlank(v.url) ? v.url : null;
    if (ep.sentAt === null) {
      // Hold the first alert for the Remote Control link, so the tap opens the worker's chat — unless no
      // link is coming, or the bridge has been slow past linkWaitMs (a stuck bridge must not hold it back).
      // A clock that went backwards reads as no time passed.
      const linkComing = v.remote === 'wanted' && !click;
      if (!linkComing || now - ep.startedAt >= linkWaitMs) {
        actions.push({ type: 'send', id: v.id, seq: ep.seq, title: ep.title, message: ep.message, click, reminder: false });
        ep.sentAt = now;
      }
    } else if (!ep.reminded && now - ep.sentAt >= remindMs) {
      actions.push({ type: 'send', id: v.id, seq: ep.seq, title: ep.title, message: reminderText(ep.message), click, reminder: true });
      ep.reminded = true;
    }
    episodes[v.id] = ep;
  }

  // An episode whose worker is no longer the person's (answered, back to work, exited) ends; the phone is
  // told to clear only what it was sent.
  for (const [id, ep] of Object.entries(prev.episodes ?? {})) {
    if (seen.has(id)) continue;
    if (ep.sentAt !== null) actions.push({ type: 'clear', id, seq: ep.seq });
  }

  return { state: { episodes, counts }, actions };
}

// notifyExit(state) → a clear per open episode that was sent, for the coordinator's exit (§2.2).
export function notifyExit(state) {
  return Object.entries(state?.episodes ?? {})
    .filter(([, ep]) => ep.sentAt !== null)
    .map(([id, ep]) => ({ type: 'clear', id, seq: ep.seq }));
}
