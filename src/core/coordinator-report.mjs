// The delivery report the run commits as plans/{slug}/REPORT.md at the end (pir-coordinator DESIGN §2.7,
// §2.9, §2.11). Pure: text and objects in, text out. The coordinator agent writes three sections; the
// command renders the rest itself — the "Decisions made for you" section from the ledger, and the branch
// footer from the sync — so no decision can drop out of the report and the footer can be rewritten when
// main moves without asking the agent again.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// The footer is always the report's last section, under this heading, so replaceFooter can find it.
export const FOOTER_HEADING = '## Branch';

// The line that stands in for the agent's three sections when it was given up (DESIGN §2.11).
export const AGENT_UNAVAILABLE =
  '_The coordinator agent was not available to write what was delivered, what to check by hand, and the risks. ' +
  'The decisions and the branch state below are complete._';

// notableDecisions(ledgerLines, adoptedTasks) → [{ question, answer, why, task }] (DESIGN §2.7).
// ledgerLines are coordinator/ledger.jsonl parsed; a line is notable when the agent flagged it, or when it
// records a task adopted into the plan (`kind: 'adopt'`), which only the agent or the person can have
// approved. adoptedTasks ([{ task, name? }]) are adoptions the shell saw this run; one already in the
// ledger is not listed twice.
export function notableDecisions(ledgerLines = [], adoptedTasks = []) {
  const out = [];
  const adopted = new Set();
  for (const l of Array.isArray(ledgerLines) ? ledgerLines : []) {
    if (!isObject(l)) continue;
    if (l.kind === 'adopt') {
      if (!nonEmpty(l.task) || adopted.has(l.task)) continue;
      adopted.add(l.task);
      out.push(adoptedEntry(l));
      continue;
    }
    if (l.notable !== true) continue;
    out.push({ question: oneLine(l.item) || 'a question', answer: oneLine(l.answer), why: oneLine(l.reason), task: l.task ?? null });
  }
  for (const a of Array.isArray(adoptedTasks) ? adoptedTasks : []) {
    if (!isObject(a) || !nonEmpty(a.task) || adopted.has(a.task)) continue;
    adopted.add(a.task);
    out.push(adoptedEntry(a));
  }
  return out;
}

function adoptedEntry({ task, name }) {
  return {
    question: `A new task, ${task}${nonEmpty(name) ? ` (${name})` : ''}, added to the plan by a worker`,
    answer: 'added to the plan and built',
    why: 'a worker proposed it during the build; the coordinator agent or you approved it in the worker\'s conversation',
    task,
  };
}

// decisionsSection(notable) → the "Decisions made for you" markdown, "None." when empty.
export function decisionsSection(notable = []) {
  const list = Array.isArray(notable) ? notable : [];
  const head = '## Decisions made for you\n\n';
  if (list.length === 0) return `${head}None.\n`;
  const items = list.map((d) => {
    const where = nonEmpty(d.task) ? `${d.task}: ` : '';
    const lines = [`- **${where}${oneLine(d.question)}**`, `  Answer: ${oneLine(d.answer) || '(none recorded)'}`];
    if (nonEmpty(d.why)) lines.push(`  Why: ${oneLine(d.why)}`);
    return lines.join('\n');
  });
  return `${head}${items.join('\n')}\n`;
}

// branchFooter({ mainSha, tests, syncedAt, unresolved, fix }) → the footer: which main the branch was synced
// against, when, and the tests result. Red or unresolved says the branch is not ready to merge. `fix` is
// the end-of-run test-fix worker's result (T10): null when none ran, else 'green' | 'red' after it.
export function branchFooter({ mainSha, tests, syncedAt, unresolved = false, fix = null } = {}) {
  const sha = nonEmpty(mainSha) ? `\`${mainSha.slice(0, 12)}\`` : 'an unknown commit';
  const when = nonEmpty(syncedAt) ? ` on ${syncedAt}` : '';
  const lines = [`${FOOTER_HEADING}\n`];
  if (unresolved) {
    lines.push(`Merging \`main\` (${sha}) into this branch conflicted and was not resolved${when}. The branch is not ready to merge.`);
  } else {
    lines.push(`Synced with \`main\` at ${sha}${when}.`);
  }
  if (fix === 'green') lines.push('The tests were red at the end; a worker fixed them.');
  else if (fix === 'red') lines.push('The tests were red at the end; a worker tried to fix them and they stayed red.');
  lines.push(tests === 'green' ? 'Tests: green.' : 'Tests: red. The branch is not ready to merge.');
  return lines.join('\n') + '\n';
}

// assembleReport({ slug, sections, notable, footer }) → REPORT.md text. sections is the agent's
// { delivered, checkByHand, risks }, or null when the agent was not available: one line stands in for
// the three. Order: delivered, decisions, check by hand, risks, footer (last, so replaceFooter finds it).
export function assembleReport({ slug, sections = null, notable = [], footer = '' } = {}) {
  const parts = [`# ${slug} — delivery report\n`];
  const s = isObject(sections) ? sections : null;
  if (s) parts.push(section('What was delivered', s.delivered));
  else parts.push(`${AGENT_UNAVAILABLE}\n`);
  parts.push(decisionsSection(notable));
  if (s) {
    parts.push(section('What to check by hand', s.checkByHand));
    parts.push(section('Risks and follow-ups', s.risks));
  }
  parts.push(nonEmpty(footer) ? footer.trimEnd() + '\n' : branchFooter({}));
  return parts.join('\n');
}

function section(title, body) {
  return `## ${title}\n\n${nonEmpty(body) ? body.trim() : 'None.'}\n`;
}

// replaceFooter(text, footer) → the report with its branch footer replaced (DESIGN §2.10: main moved and
// the branch was re-synced). The footer is the last `## Branch` section; a report without one gets it
// appended.
export function replaceFooter(text, footer) {
  const t = String(text ?? '');
  const at = t.lastIndexOf(`\n${FOOTER_HEADING}\n`);
  const head = at === -1 ? t.trimEnd() + '\n' : t.slice(0, at + 1);
  return `${head}${at === -1 ? '\n' : ''}${footer.trimEnd()}\n`;
}

// unverifiedTasks(progressText) → the task ids whose PROGRESS.md row says a hand-checked half is still
// unverified (CLAUDE.md: "mark it unverified, in PROGRESS.md"). A row counts when its text says
// "unverified".
export function unverifiedTasks(progressText) {
  const out = [];
  for (const line of String(progressText ?? '').split('\n')) {
    const m = /^\|\s*(T\d+)\s*\|/.exec(line.trim());
    if (m && /unverified/i.test(line)) out.push(m[1]);
  }
  return out;
}

// findingRows(findingsText) → the FINDINGS.md table's data rows, as their text, for the end brief. Which
// are still open is the agent's judgement; it reads them all.
export function findingRows(findingsText) {
  const rows = [];
  for (const line of String(findingsText ?? '').split('\n')) {
    const l = line.trim();
    if (!l.startsWith('|')) continue;
    if (/^\|\s*-/.test(l) || /^\|\s*Date\s*\|/i.test(l)) continue;
    rows.push(l);
  }
  return rows;
}

// endFacts({ tasks, ledger, findings, unverified, sync, tests }) → the end brief's facts, normalised
// (DESIGN §2.9 step 2). tasks are parsed PROGRESS rows ({ num, name, state }); ledger the ledger lines;
// findings the FINDINGS rows; unverified task ids; sync { state, mainSha, files? }; tests 'green'|'red';
// fix null when no test-fix worker ran (T10), else its result 'green'|'red'.
export function endFacts({ tasks = [], ledger = [], findings = [], unverified = [], sync = null, tests = 'red', fix = null } = {}) {
  return {
    tasks: (Array.isArray(tasks) ? tasks : []).filter(isObject).map((t) => ({ num: t.num, name: t.name ?? '', state: t.state ?? '' })),
    ledger: (Array.isArray(ledger) ? ledger : []).filter(isObject).map((l) => ({
      kind: l.kind, task: l.task ?? null, item: oneLine(l.item), answer: oneLine(l.answer), reason: oneLine(l.reason), notable: l.notable === true,
    })),
    findings: (Array.isArray(findings) ? findings : []).filter(nonEmpty),
    unverified: (Array.isArray(unverified) ? unverified : []).filter(nonEmpty),
    sync: isObject(sync) ? { state: sync.state ?? 'unknown', mainSha: sync.mainSha ?? null, files: Array.isArray(sync.files) ? sync.files : [] } : { state: 'unknown', mainSha: null, files: [] },
    tests: tests === 'green' ? 'green' : 'red',
    fix: fix === 'green' || fix === 'red' ? fix : null,
  };
}
