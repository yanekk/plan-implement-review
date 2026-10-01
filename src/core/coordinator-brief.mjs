// Every message the command sends the coordinator agent (pir-coordinator DESIGN §2.3, §2.4, §2.11,
// §3.4). Pure: text in, text out. The agent copies `worker` and `requestId` from these briefs into its
// decision files exactly (skills/pir-coordinator/SKILL.md § Writing a decision), so every brief names
// both on lines of their own, in backticks, with nothing else on the line to mis-copy.

import { HAND_RESERVED } from './coordinator-policy.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// The block that says which item this is: the fields a decision must copy.
function header(item) {
  const lines = [`Worker: \`${item.worker}\``];
  if (nonEmpty(item.name)) lines.push(`Worker name: ${item.name}`);
  if (nonEmpty(item.task)) lines.push(`Task: ${item.task}`);
  if (nonEmpty(item.requestId)) lines.push(`requestId: \`${item.requestId}\``);
  return lines.join('\n');
}

const json = (v) => JSON.stringify(v, null, 2);

// briefFor(item) → the brief for one waiting item (DESIGN §2.3). `item` is a T01 waiting entry
// ({ worker, task, kind, requestId?, request?, reserved?, text? }) plus text context the shell adds:
// `name` (the worker's name) and, for a report park, `lastWords` (its last assistant text). A reserved
// item (DESIGN §2.4) is never briefed as answerable: it says the item is the person's and asks for a
// note, whatever its kind.
export function briefFor(item) {
  const i = isObject(item) ? item : {};
  const r = isObject(i.request) ? i.request : {};
  const parts = [];

  if (i.kind === 'permission') {
    parts.push('A worker is asking permission to use a tool.', header(i), `Tool: ${r.toolName ?? 'unknown'}`, `Input:\n${json(isObject(r.input) ? r.input : {})}`);
    if (nonEmpty(r.reason)) parts.push(`Why Claude Code asked: ${r.reason}`);
    if (nonEmpty(r.description)) parts.push(`Description: ${r.description}`);
  } else if (i.kind === 'command') {
    // A command an agent hands the person (bang-commands DESIGN §2.6): only the person runs it, so it is
    // briefed as reserved even when the item came without `reserved`.
    parts.push('A worker has handed the person a command to run.', header(i), `Command: ${r.command ?? r.input?.command ?? ''}`);
    if (nonEmpty(r.reason)) parts.push(`Why the worker wants it run: ${r.reason}`);
  } else if (i.kind === 'questions') {
    parts.push('A worker is asking a set of questions.', header(i));
    const qs = Array.isArray(r.questions) ? r.questions.filter(isObject) : [];
    qs.forEach((q, n) => {
      const opts = (Array.isArray(q.options) ? q.options : []).filter(isObject);
      const lines = [`Question ${n + 1}${q.multiSelect ? ' (pick any number)' : ''}: ${q.question ?? ''}`];
      for (const o of opts) lines.push(`  - ${o.label ?? ''}${nonEmpty(o.description) ? `: ${o.description}` : ''}`);
      parts.push(lines.join('\n'));
    });
  } else {
    parts.push('A worker dropped a question or decision report and is waiting for an answer.', header(i));
    if (nonEmpty(i.text)) parts.push(`Its report:\n${i.text.trim()}`);
    if (nonEmpty(i.lastWords)) parts.push(`Its last words:\n${i.lastWords.trim()}`);
  }

  const reserved = isObject(i.reserved) ? i.reserved : i.kind === 'command' ? HAND_RESERVED : null;
  if (reserved) {
    parts.push(
      `This one is the person's (${reserved.why}); add your note. Write a \`pass\` decision whose \`reason\` is your note ` +
        'and whose `suggestion` is what you would pick, and give the person the pointer in your reply. ' +
        'A `permission` decision for it is refused.',
    );
  } else {
    const how = { permission: 'a `permission` decision (allow or deny)', questions: 'an `answers` decision', report: 'a `message` decision' }[i.kind] ?? 'a `message` decision';
    parts.push(`Answer it with ${how}, or pass it on with a \`pass\` decision and the pointer in your reply.`);
  }
  return parts.join('\n\n');
}

// refusalFor(why, file) → the message telling the agent one of its decision files was not applied
// (DESIGN §2.11). Nothing was guessed on its behalf.
export function refusalFor(why, file = null) {
  const which = nonEmpty(file) ? `Your decision file ${file}` : 'Your decision';
  return `${which} was not applied: ${why}. Nothing was done with it. Write a new file if you still mean to decide, or pass the item on.`;
}

// closedWhy(closed) → how an item stopped waiting without a decision of the agent's, as one clause (DESIGN
// §2.3, T15). `closed` is closingAnswer's { by, answer?, how? }. Says who closed it and the answer when the
// log showed it, says plainly when the answer was not recorded, and never says "answered by the person"
// for an item nobody answered.
export function closedWhy(closed) {
  const c = isObject(closed) ? closed : {};
  const answer = nonEmpty(c.answer) ? c.answer : null;
  switch (c.by) {
    case 'person':
      return `already answered by the person: ${answer ?? 'the answer was not recorded'}`;
    case 'phone':
      return `already answered by the person on the phone (Remote Control): ${answer ?? 'the answer was not recorded'}`;
    case 'grant':
      return `already allowed by a standing permission the person gave earlier: ${answer ?? 'allowed'}`;
    case 'coordinator':
      return `already answered by your own decision: ${answer ?? 'the answer was not recorded'}`;
    case 'pir':
      return `already answered by pir: ${answer ?? 'the answer was not recorded'}`;
    case 'stopped': {
      const how = { interrupted: 'was interrupted', restarted: 'was restarted' }[c.how] ?? 'exited';
      return `closed with no answer: the worker ${how} before anyone answered`;
    }
    default:
      return 'no longer waiting; pir did not record who closed it or the answer';
  }
}

// answeredElsewhereFor(item, closed) → the item stopped waiting without a decision of the agent's (DESIGN
// §2.3, T15): who closed it and what the answer was, once. The agent drops the item, and speaks of it only
// to correct its own pointer (skills/pir-coordinator/SKILL.md).
export function answeredElsewhereFor(item, closed) {
  const i = isObject(item) ? item : {};
  const why = closedWhy(closed);
  return [
    `${why[0].toUpperCase()}${why.slice(1)}.`,
    header(i),
    'Drop this item; any decision for it will be refused. If your last reply sent the person to answer it, say in one line ' +
      'that it is already settled and how; otherwise say nothing about it. Never guess who answered.',
  ].join('\n\n');
}

// holdWords(holdMs) → the hold limit in words: whole minutes as minutes, anything shorter or odd as
// seconds (a test's or the live check's shortened limit reads true, not rounded to "0 minutes").
export function holdWords(holdMs) {
  const ms = Number.isFinite(holdMs) && holdMs > 0 ? holdMs : 0;
  if (ms >= 60000 && ms % 60000 === 0) {
    const m = ms / 60000;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

// timedOutFor(item, holdMs) → the agent held an item for the hold limit without a decision, so it is the
// person's now, exactly as if passed on (DESIGN §2.11, T13). The agent may still answer it, the first
// answer winning, and owes the person a pointer either way (§2.5).
export function timedOutFor(item, holdMs) {
  const i = isObject(item) ? item : {};
  return [
    `Handed to the person: you held this item for ${holdWords(holdMs)} without a decision, so it is now the person's, as if you had passed it on.`,
    header(i),
    'You may still answer it while the person has not: the first answer wins, yours included. Or pass it on with a `pass` decision. ' +
      'Either way, give the person the pointer in your reply now: which worker and task is asking, why you have not decided, and what you would pick.',
  ].join('\n\n');
}

// openingFor({ slug, projectRulesPath, dropDir }) → the agent's opening instruction (DESIGN §3.4).
export function openingFor({ slug, projectRulesPath = null, dropDir }) {
  return [
    `Invoke the pir-coordinator skill and follow it. You are the coordinator agent of the parallel build of plan \`${slug}\`.`,
    `Plan: ${slug}`,
    nonEmpty(projectRulesPath) ? `Project rules: ${projectRulesPath}` : 'Project rules: none (this project has no .claude/pir-coordinator.md)',
    `Drop folder: ${dropDir}`,
    'Read the plan now. Briefs arrive as messages from pir.',
  ].join('\n');
}

// resumedFor() → sent into a resumed session (DESIGN §2.11): after an exit or a pir restart, the items
// the agent held may have been answered or lost; new ones are briefed afresh.
export function resumedFor() {
  return 'pir restarted your session. Items you were briefed on before may since have been answered, and a ' +
    'decision for one of those is refused; new items are briefed as they come. Re-read PROGRESS.md before you answer.';
}

// ---- The end of the run (DESIGN §2.9, §2.10, T05) ----

// syncWords(base) → how the end brief names each sync state, naming the run's base branch (base-branch
// DESIGN §2.9: no user-visible text says `main` unless the base is `main`).
export function syncWords(base = 'main') {
  return {
    'up-to-date': `the branch already held the current ${base}`,
    merged: `${base} merged in cleanly`,
    resolved: `${base} merged in; a worker resolved the conflicts`,
    unresolved: `merging ${base} conflicted and was NOT resolved`,
    unknown: 'unknown',
  };
}

// mergeLine(base, slug) → the command the person runs to take the branch. It switches to the base first,
// so it is right whichever branch the person has checked out (base-branch DESIGN §2.9).
export const mergeLine = (base, slug) => `git switch ${base} && git merge pir/${slug}`;

// endBriefFor(facts) → the end brief (DESIGN §2.9 step 2): the run's facts, from coordinator-report's
// endFacts (its `base` names the branch synced with, default `main`), and what to write back — one
// `report` decision with three markdown sections.
export function endBriefFor(facts) {
  const f = isObject(facts) ? facts : {};
  const tasks = Array.isArray(f.tasks) ? f.tasks : [];
  const ledger = Array.isArray(f.ledger) ? f.ledger : [];
  const findings = Array.isArray(f.findings) ? f.findings : [];
  const unverified = Array.isArray(f.unverified) ? f.unverified : [];
  const sync = isObject(f.sync) ? f.sync : {};
  const base = nonEmpty(f.base) ? f.base : 'main';
  const parts = ['Every task is done. Write the delivery report.'];
  parts.push(['Tasks:', ...tasks.map((t) => `- ${t.num} ${t.name ?? ''} ${t.state ?? ''}`.trimEnd())].join('\n'));
  parts.push(
    ledger.length
      ? ['Decisions applied during the run (ledger):', ...ledger.map((l) => `- ${l.task ?? '-'} ${l.kind}${l.notable ? ' (notable)' : ''}: ${l.item} → ${l.answer}${l.reason ? ` (why: ${l.reason})` : ''}`)].join('\n')
      : 'Decisions applied during the run (ledger): none.',
  );
  parts.push(findings.length ? ['FINDINGS rows:', ...findings].join('\n') : 'FINDINGS rows: none.');
  parts.push(`Tasks with a hand-checked half still unverified: ${unverified.length ? unverified.join(', ') : 'none'}.`);
  const files = Array.isArray(sync.files) && sync.files.length ? ` (files: ${sync.files.join(', ')})` : '';
  parts.push(`Sync with ${base}: ${syncWords(base)[sync.state] ?? sync.state ?? 'unknown'}${sync.baseSha ? `, ${base} at ${String(sync.baseSha).slice(0, 12)}` : ''}${files}.`);
  parts.push(`Tests on the feature branch: ${f.tests === 'green' ? 'green' : 'red'}.`);
  if (f.fix === 'green') parts.push('The tests were red at the end; a worker fixed them.');
  else if (f.fix === 'red') parts.push('The tests were red at the end; a worker tried to fix them and they stayed red.');
  parts.push(
    'Write one `report` decision: { "kind": "report", "sections": { "delivered": "…", "checkByHand": "…", "risks": "…" } }, ' +
      'each a markdown string, per the pir-coordinator skill § The report. pir renders the decisions section and the branch footer itself.',
  );
  return parts.join('\n\n');
}

// handoffFor({ slug, reportPath, ready, report, base }) → the hand-off message (DESIGN §2.9 step 5): the report
// and the merge command, or, red, why no merge is offered. The agent presents it to the person in its reply.
// `finisher`: a ready branch the finisher takes over (finisher DESIGN §2.1): no merge line, because the
// merge is the finisher's after the person's go, and the agent is closed on pir's next pass.
export function handoffFor({ slug, reportPath, ready, report = null, base = 'main', finisher = false }) {
  const parts = [`The delivery report is committed on pir/${slug} as ${reportPath}.`];
  if (nonEmpty(report)) parts.push(`The report:\n\n${report.trim()}`);
  if (ready && finisher) {
    parts.push(
      'The branch is ready to merge. pir now closes you and starts the finisher, which prepares the merge and the ' +
        "project's after-merge steps and asks the person for their go. Do not offer a merge command.",
      'Present the report to the person in your reply, in one short turn.',
    );
    return parts.join('\n\n');
  }
  if (ready) {
    parts.push(`The branch is ready to merge. The person merges it themselves:\n\n  ${mergeLine(base, slug)}`);
  } else {
    parts.push(`The branch is not ready to merge: its tests are red or ${base} could not be merged in, as the report says. No merge is offered.`);
  }
  parts.push('Present the report and this to the person in your reply. The run now waits until they merge, or tell you to close it.');
  return parts.join('\n\n');
}

// resyncedFor({ slug, baseSha, base, tests, unresolved }) → the base moved while the run waited and pir re-synced
// the branch (DESIGN §2.10); the report's footer is updated. The agent tells the person in one line.
export function resyncedFor({ slug, baseSha, base = 'main', tests, unresolved = false }) {
  const sha = nonEmpty(baseSha) ? String(baseSha).slice(0, 12) : 'its new tip';
  const what = unresolved
    ? `merging it into pir/${slug} conflicted and was not resolved, so the branch is not ready to merge`
    : tests === 'green'
      ? `pir/${slug} now holds it and its tests are green; the merge command is unchanged: ${mergeLine(base, slug)}`
      : `pir/${slug} now holds it but its tests are red, so no merge is offered`;
  return `${base} moved to ${sha} while the run waited, and pir re-synced the branch: ${what}. The report's branch footer is updated. Tell the person in one line.`;
}
