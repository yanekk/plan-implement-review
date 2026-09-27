// Every message the command sends the coordinator agent (pir-coordinator DESIGN §2.3, §2.4, §2.11,
// §3.4). Pure: text in, text out. The agent copies `worker` and `requestId` from these briefs into its
// decision files exactly (skills/pir-coordinator/SKILL.md § Writing a decision), so every brief names
// both on lines of their own, in backticks, with nothing else on the line to mis-copy.

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

  if (isObject(i.reserved)) {
    parts.push(
      `This one is the person's (${i.reserved.why}); add your note. Write a \`pass\` decision whose \`reason\` is your note ` +
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

// answeredElsewhereFor(item) → the person answered first (DESIGN §2.3): the agent drops the item.
export function answeredElsewhereFor(item) {
  const i = isObject(item) ? item : {};
  return `Already answered by the person:\n\n${header(i)}\n\nDrop this item; any decision for it will be refused.`;
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

const SYNC_WORDS = {
  'up-to-date': 'the branch already held the current main',
  merged: 'main merged in cleanly',
  resolved: 'main merged in; a worker resolved the conflicts',
  unresolved: 'merging main conflicted and was NOT resolved',
  unknown: 'unknown',
};

// endBriefFor(facts) → the end brief (DESIGN §2.9 step 2): the run's facts, from coordinator-report's
// endFacts, and what to write back — one `report` decision with three markdown sections.
export function endBriefFor(facts) {
  const f = isObject(facts) ? facts : {};
  const tasks = Array.isArray(f.tasks) ? f.tasks : [];
  const ledger = Array.isArray(f.ledger) ? f.ledger : [];
  const findings = Array.isArray(f.findings) ? f.findings : [];
  const unverified = Array.isArray(f.unverified) ? f.unverified : [];
  const sync = isObject(f.sync) ? f.sync : {};
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
  parts.push(`Sync with main: ${SYNC_WORDS[sync.state] ?? sync.state ?? 'unknown'}${sync.mainSha ? `, main at ${String(sync.mainSha).slice(0, 12)}` : ''}${files}.`);
  parts.push(`Tests on the feature branch: ${f.tests === 'green' ? 'green' : 'red'}.`);
  parts.push(
    'Write one `report` decision: { "kind": "report", "sections": { "delivered": "…", "checkByHand": "…", "risks": "…" } }, ' +
      'each a markdown string, per the pir-coordinator skill § The report. pir renders the decisions section and the branch footer itself.',
  );
  return parts.join('\n\n');
}

// handoffFor({ slug, reportPath, ready, report }) → the hand-off message (DESIGN §2.9 step 5): the report
// and the merge command, or, red, why no merge is offered. The agent presents it to the person in its reply.
export function handoffFor({ slug, reportPath, ready, report = null }) {
  const parts = [`The delivery report is committed on pir/${slug} as ${reportPath}.`];
  if (nonEmpty(report)) parts.push(`The report:\n\n${report.trim()}`);
  if (ready) {
    parts.push(`The branch is ready to merge. The person merges it themselves:\n\n  git merge pir/${slug}`);
  } else {
    parts.push('The branch is not ready to merge: its tests are red or main could not be merged in, as the report says. No merge is offered.');
  }
  parts.push('Present the report and this to the person in your reply. The run now waits until they merge, or tell you to close it.');
  return parts.join('\n\n');
}

// resyncedFor({ slug, mainSha, tests, unresolved }) → main moved while the run waited and pir re-synced
// the branch (DESIGN §2.10); the report's footer is updated. The agent tells the person in one line.
export function resyncedFor({ slug, mainSha, tests, unresolved = false }) {
  const sha = nonEmpty(mainSha) ? String(mainSha).slice(0, 12) : 'its new tip';
  const what = unresolved
    ? `merging it into pir/${slug} conflicted and was not resolved, so the branch is not ready to merge`
    : tests === 'green'
      ? `pir/${slug} now holds it and its tests are green; the merge command is unchanged: git merge pir/${slug}`
      : `pir/${slug} now holds it but its tests are red, so no merge is offered`;
  return `main moved to ${sha} while the run waited, and pir re-synced the branch: ${what}. The report's branch footer is updated. Tell the person in one line.`;
}
