// The coordinator agent's rulebook (pir-coordinator DESIGN §2.3, §2.4, §2.11, §3.3). Pure: it decides
// which waiting items are the person's and never the agent's, what a decision file must look like, and
// whether a decision may be applied to what is waiting now. The shell reads the files and applies what
// this returns; it interprets nothing itself, so every refusal is decided and tested here.
//
// The reservation is enforced in code, not trusted to the agent: a rule the model can argue itself out
// of is not a rule (DESIGN §2.4). Everything here errs toward the person — a false positive costs one
// question, a false negative costs exactly the action the person reserved.

import { ruleMatches } from './person-input.mjs';
import { allowResult, denyResult, answersResult } from './stream.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// ---- Reservation (DESIGN §2.4, §3.3) ----

// Each entry is matched against one part of a Bash command (a compound command is split first) and
// against the whole command. Unanchored on purpose so a wrapper (`sudo rm -rf`, `git -C dir push -f`)
// still matches. `[^;&|\n]*` keeps a flag from being borrowed from a different command in the line.
export const DESTRUCTIVE = [
  // rm with a recursive or force flag, short (bundled or not) or long.
  /(?:^|[\s;&|(`])rm\s(?:[^;&|\n]*\s)?(?:-[a-zA-Z]*[rRf]|--(?:recursive|force)\b)/,
  // git push forcing: --force, --force-with-lease, -f (bundled), or a `+refspec`.
  /\bgit\b[^;&|\n]*\spush\b[^;&|\n]*\s(?:--force(?:-with-lease)?\b|-[a-zA-Z]*f\b|\+\S)/,
  /\bgit\b[^;&|\n]*\sreset\b[^;&|\n]*\s--hard\b/,
  /\bgit\b[^;&|\n]*\sclean\b[^;&|\n]*\s(?:-[a-zA-Z]*f|--force\b)/,
  // branch -D, or -d/--delete with --force; case matters, `-d` alone is the safe delete.
  /\bgit\b[^;&|\n]*\sbranch\b[^;&|\n]*\s(?:-[a-zA-Z]*D\b|--force\b[^;&|\n]*\s(?:-d|--delete)\b|(?:-d|--delete)\b[^;&|\n]*\s(?:--force|-f)\b)/,
  // checkout discarding working-tree paths: `git checkout -- path` or `git checkout .`.
  /\bgit\b[^;&|\n]*\scheckout\b[^;&|\n]*\s(?:--|\.)(?=\s|$)/,
  /\bgit\b[^;&|\n]*\srestore\b/,
  /\bgit\b[^;&|\n]*\srebase\b/,
  /\bgit\b[^;&|\n]*\sfilter-branch\b/,
  /\b(?:drop\s+(?:table|database)|truncate)\b/i,
  /\bmkfs\b/,
  /\bdd\b[^;&|\n]*\bof=/,
];

// parseRule(text) → { toolName, ruleContent? } | null. The settings-file form of a permission rule:
// `Tool` or `Tool(content)`. Anything else is null, never a bare (match-all) rule: a typo in the
// person's settings must not turn into "every Bash command is reserved" silently either way, and above
// all must not become a rule that matches what it was not written for.
export function parseRule(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*([A-Za-z_][\w.:-]*)\s*(?:\(([\s\S]*)\))?\s*$/.exec(text);
  if (!m) return null;
  const [, toolName, content] = m;
  if (content === undefined) return { toolName };
  if (content.trim() === '') return null;
  return { toolName, ruleContent: content };
}

// The simple commands a Bash line runs: split on `&&`, `||`, `;`, `|`, a background `&` and newlines,
// with `$(…)`/backtick bodies added as parts of their own, leading `VAR=value` assignments dropped and
// trailing redirects cut, so `ruleMatches` (which refuses anything compound, as a grant must) can judge
// each part. Over-splitting only ever makes a part match more readily, which is the person's side.
export function commandParts(command) {
  if (typeof command !== 'string') return [];
  const subs = [];
  for (const m of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) subs.push(m[1] ?? m[2]);
  const pieces = [command, ...subs].flatMap((c) => c.split(/&&|\|\||[;|\n\r]|(?<![>&<])&(?![>&])/));
  const parts = [];
  for (let p of pieces) {
    p = p.replace(/(?:\d|&)?(?:>>?|<)&?\s*\S+/g, ' '); // redirects (`> out`, `2>&1`, `&>out`, `< in`)
    p = p.replace(/[()]/g, ' ').trim();
    while (/^[A-Za-z_]\w*=\S*\s+/.test(p)) p = p.replace(/^[A-Za-z_]\w*=\S*\s+/, '');
    p = p.replace(/\s+/g, ' ');
    if (p) parts.push(p);
  }
  return parts;
}

// Every word-boundary tail of every part, with quotes and backslashes dropped and each tail also taken
// with its first word's directory cut (`/bin/rm` → `rm`). A wrapper (`nohup`, `env`, `sudo`, `xargs`,
// `time`), a keyword (`then`, `{`) or a quoted `sh -c` body therefore cannot carry a reserved command
// past the match (review T01). It over-matches (`echo git push`), which is the person's side.
function commandTails(parts) {
  const tails = new Set();
  for (const part of parts) {
    const words = part.replace(/["'\\]/g, '').split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const tail = words.slice(i).join(' ');
      tails.add(tail);
      tails.add(tail.replace(/^\S*\//, ''));
    }
  }
  return [...tails].filter(Boolean);
}

const ruleText = (r) => (r.ruleContent === undefined ? r.toolName : `${r.toolName}(${r.ruleContent})`);

// reservedFor(request, askRules) → null | { kind: 'ask-rule' | 'destructive', why }
//   request:  a permission request as stream.mjs readRequest normalises it, plus `matchedAskRule` /
//             `defaultToNo` when the SDK sent them. A question set (no toolName) is never reserved.
//   askRules: the strings of the project's `.claude/settings.json` permissions.ask; the shell reads it.
// Both the SDK's flag and our own match are checked: T00 measured `matchedAskRule` absent even when an
// ask rule forced the prompt (CLI 2.1.283), so the settings match is what actually carries the bin.
export function reservedFor(request, askRules = []) {
  if (!isObject(request) || !nonEmpty(request.toolName)) return null;
  const input = isObject(request.input) ? request.input : {};

  if (isObject(request.matchedAskRule)) {
    return { kind: 'ask-rule', why: `the project's ask rule ${ruleText(request.matchedAskRule)} holds this for the person` };
  }
  const bash = request.toolName === 'Bash';
  const parts = bash ? commandTails(commandParts(input.command)) : [];
  for (const text of Array.isArray(askRules) ? askRules : []) {
    const rule = parseRule(text);
    if (!rule || rule.toolName !== request.toolName) continue;
    const hit = bash ? parts.some((command) => ruleMatches(rule, { ...input, command })) : ruleMatches(rule, input);
    if (hit) return { kind: 'ask-rule', why: `the project's ask rule ${ruleText(rule)} holds this for the person` };
  }
  if (request.defaultToNo === true) {
    return { kind: 'destructive', why: 'Claude Code marked this request as one to refuse by default' };
  }
  if (bash && typeof input.command === 'string') {
    const candidates = [input.command, ...parts];
    if (DESTRUCTIVE.some((re) => candidates.some((c) => re.test(c)))) {
      return { kind: 'destructive', why: 'a destructive command is always the person\'s to approve' };
    }
  }
  return null;
}

// ---- Decision files (DESIGN §2.3, §3.5) ----

const DECISION_KINDS = ['permission', 'answers', 'message', 'pass', 'report', 'close'];
const REPORT_SECTIONS = ['delivered', 'checkByHand', 'risks'];

// readDecision(obj) → { ok: true, decision } | { ok: false, error }. `obj` is one parsed decision file.
// The normalised decision keeps only the fields its kind defines. Never throws.
export function readDecision(obj) {
  if (!isObject(obj)) return bad('a decision must be a JSON object');
  if (!DECISION_KINDS.includes(obj.kind)) {
    return bad(`unknown kind ${JSON.stringify(obj.kind)}; expected one of ${DECISION_KINDS.join(', ')}`);
  }
  if (obj.kind === 'close') return good({ kind: 'close' });
  if (obj.kind === 'report') {
    if (!isObject(obj.sections)) return bad('a report needs `sections`: { delivered, checkByHand, risks }');
    const sections = {};
    for (const s of REPORT_SECTIONS) {
      if (typeof obj.sections[s] !== 'string') return bad(`report section \`${s}\` must be a markdown string`);
      sections[s] = obj.sections[s];
    }
    return good({ kind: 'report', sections });
  }

  if (!nonEmpty(obj.worker)) return bad('missing `worker`: the worker the decision is for');
  if (!nonEmpty(obj.reason)) return bad('missing `reason`: why you decided this');
  if (obj.notable !== undefined && typeof obj.notable !== 'boolean') return bad('`notable` must be true or false');
  const base = { kind: obj.kind, worker: obj.worker, reason: obj.reason };
  const flagged = { ...base, notable: obj.notable === true };

  switch (obj.kind) {
    case 'permission':
      if (!nonEmpty(obj.requestId)) return bad('missing `requestId`');
      if (obj.decision !== 'allow' && obj.decision !== 'deny') {
        return bad(`unknown decision ${JSON.stringify(obj.decision)}; expected allow or deny`);
      }
      return good({ ...flagged, requestId: obj.requestId, decision: obj.decision });
    case 'answers': {
      if (!nonEmpty(obj.requestId)) return bad('missing `requestId`');
      if (!isObject(obj.answers)) return bad('`answers` must be an object of question → answer');
      const entries = Object.entries(obj.answers);
      if (entries.length === 0) return bad('`answers` is empty');
      for (const [q, a] of entries) {
        if (typeof a !== 'string') return bad(`the answer to ${JSON.stringify(q)} must be a string`);
      }
      return good({ ...flagged, requestId: obj.requestId, answers: { ...obj.answers } });
    }
    case 'message':
      if (!nonEmpty(obj.text)) return bad('a message needs non-empty `text`');
      return good({ ...flagged, text: obj.text });
    case 'pass': {
      if (obj.requestId !== undefined && !nonEmpty(obj.requestId)) return bad('`requestId`, when given, must be a non-empty string');
      if (!nonEmpty(obj.suggestion)) return bad('a pass needs `suggestion`: what you would pick');
      const d = { ...base, suggestion: obj.suggestion };
      if (obj.requestId !== undefined) d.requestId = obj.requestId;
      return good(d);
    }
  }
}

const good = (decision) => ({ ok: true, decision });
const bad = (error) => ({ ok: false, error });

// ---- Checking a decision against what is waiting (DESIGN §2.3, §2.4, §2.10, §2.11) ----

// Which waiting-item kind each worker-addressed decision answers.
const ANSWERS_ITEM = { permission: 'permission', answers: 'questions', message: 'report' };

// checkDecision(decision, waiting, { ready, answered }) → { ok: true, apply } | { ok: false, why, passOn }
//   decision: a normalised decision from readDecision.
//   waiting:  [{ worker, task, kind: 'permission'|'questions'|'report', requestId?, request?, reserved?, text? }]
//             — every item waiting now, as the shell sees it this pass. An item already answered by the
//             person is not in it, so a late decision for it is refused as not waiting (first answer wins).
//   ready:    the run is in `ready to merge` (the caller knows; this module has no run state).
//   answered: Map of item key (`${worker}:${requestId ?? 'report'}`) → why, for items the agent was told
//             were closed without it (T15). A decision for one that is no longer waiting is refused with
//             those facts; the generic "unknown worker, or already answered" stays for everything else.
// `apply` is everything the shell needs to act, with the worker's result already built:
//   { kind, worker, task, requestId?, result | text | suggestion | sections, ledger }
// `passOn` is true only for a `permission` on a reserved item: that item goes to the person with the
// agent's reason as its note, rather than being dropped.
export function checkDecision(decision, waiting, { ready = false, answered = new Map() } = {}) {
  if (!isObject(decision)) return refuse('not a decision');
  const items = Array.isArray(waiting) ? waiting.filter(isObject) : [];

  if (decision.kind === 'report') return { ok: true, apply: { kind: 'report', sections: decision.sections } };
  if (decision.kind === 'close') {
    return ready
      ? { ok: true, apply: { kind: 'close' } }
      : refuse('the run is still building, so it cannot be closed yet; stopping a run is the person\'s, from the dashboard');
  }

  const mine = items.filter((i) => i.worker === decision.worker);
  const key = `${decision.worker}:${decision.requestId ?? 'report'}`;
  const waitingNow = decision.requestId !== undefined ? mine.some((i) => i.requestId === decision.requestId) : mine.some((i) => i.kind === 'report');
  if (!waitingNow && answered instanceof Map && nonEmpty(answered.get(key))) return refuse(answered.get(key));
  if (mine.length === 0) return refuse(`nothing is waiting from worker ${JSON.stringify(decision.worker)} (unknown worker, or already answered)`);

  let item;
  if (decision.requestId !== undefined) {
    item = mine.find((i) => i.requestId === decision.requestId);
    if (!item) return refuse(`request ${JSON.stringify(decision.requestId)} from ${decision.worker} is not waiting (unknown, or already answered by the person)`);
  } else if (decision.kind === 'message' || decision.kind === 'pass') {
    item = mine.find((i) => i.kind === 'report');
    if (!item) {
      return refuse(decision.kind === 'message'
        ? `${decision.worker} is not parked on a report, so a message does not answer it; answer its request instead`
        : `${decision.worker} is not parked on a report; name the \`requestId\` you are passing on`);
    }
  }

  if (decision.kind === 'pass') {
    const apply = { kind: 'pass', worker: item.worker, task: item.task, reason: decision.reason, suggestion: decision.suggestion };
    if (item.requestId !== undefined) apply.requestId = item.requestId;
    apply.ledger = ledgerLine(decision, item, `passed on (would pick: ${decision.suggestion})`);
    return { ok: true, apply };
  }

  const want = ANSWERS_ITEM[decision.kind];
  if (item.kind !== want) {
    return refuse(`a ${decision.kind} decision does not answer a ${item.kind} item; it answers a ${want}`);
  }

  if (decision.kind === 'permission') {
    if (item.reserved) {
      return { ok: false, passOn: true, why: `this request is the person's (${item.reserved.why}); it has been passed on with your note` };
    }
    const request = isObject(item.request) ? item.request : { input: {} };
    const result = decision.decision === 'allow' ? allowResult(request) : denyResult(request, decision.reason);
    return { ok: true, apply: { kind: 'permission', worker: item.worker, task: item.task, requestId: item.requestId, result, ledger: ledgerLine(decision, item, decision.decision) } };
  }

  if (decision.kind === 'answers') {
    const request = isObject(item.request) ? item.request : { input: {} };
    const questions = Array.isArray(request.questions) ? request.questions.map((q) => q?.question).filter(nonEmpty) : [];
    if (questions.length) {
      const extra = Object.keys(decision.answers).filter((q) => !questions.includes(q));
      if (extra.length) return refuse(`no such question on request ${item.requestId}: ${extra.map((q) => JSON.stringify(q)).join(', ')}`);
      const missing = questions.filter((q) => !(q in decision.answers));
      if (missing.length) return refuse(`every question needs an answer; missing ${missing.map((q) => JSON.stringify(q)).join(', ')}`);
    }
    const result = answersResult(request, decision.answers);
    const answer = Object.entries(decision.answers).map(([q, a]) => `${q} → ${a}`).join('; ');
    return { ok: true, apply: { kind: 'answers', worker: item.worker, task: item.task, requestId: item.requestId, result, ledger: ledgerLine(decision, item, answer) } };
  }

  // message
  return { ok: true, apply: { kind: 'message', worker: item.worker, task: item.task, text: decision.text, ledger: ledgerLine(decision, item, decision.text) } };
}

const refuse = (why) => ({ ok: false, why, passOn: false });

// One ledger line (DESIGN §2.7), without a timestamp: the shell adds the time as it appends.
function ledgerLine(decision, item, answer) {
  const line = { kind: decision.kind, worker: item.worker, task: item.task, item: describeItem(item), answer, reason: decision.reason, notable: decision.notable === true };
  if (item.requestId !== undefined) line.requestId = item.requestId;
  return line;
}

// What was asked, in one line, for the ledger and the report's decisions section.
export function describeItem(item) {
  const r = isObject(item?.request) ? item.request : {};
  if (item?.kind === 'questions') {
    const qs = Array.isArray(r.questions) ? r.questions.map((q) => q?.question).filter(nonEmpty) : [];
    return qs.length ? qs.join(' / ') : 'a question set';
  }
  if (item?.kind === 'permission') {
    const input = isObject(r.input) ? r.input : {};
    const target = input.command ?? input.file_path ?? input.path ?? input.notebook_path ?? input.url ?? input.skill;
    return `${r.toolName ?? 'a tool'}${typeof target === 'string' ? `: ${target}` : ''}`;
  }
  const text = typeof item?.text === 'string' ? item.text : typeof r.text === 'string' ? r.text : '';
  return text.trim() ? text.trim() : 'a report-parked question';
}
