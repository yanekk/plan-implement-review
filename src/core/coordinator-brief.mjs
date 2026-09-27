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
