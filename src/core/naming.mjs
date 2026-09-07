// The agent-name helpers (DESIGN §2.8). Pure string work: build a coordinator or worker
// name, and parse a name back to its repo, plan and task. No clock, no I/O — the loop
// reads `claude agents --json` in src/shell/ and hands the names here to identify workers
// (DESIGN §3.1, §3.2), so worker-to-task state comes from the names and cannot drift from
// separate bookkeeping.
//
// The convention (DESIGN §2.8):
//   coordinator  @{repo} / {plan}
//   worker       @{repo} / {plan} / T{nn}
//
// NOTE (T00, FINDINGS 2026-09-07): `SendMessage` addresses a teammate by NAME and rejects a
// name containing "/". The §2.8 form above therefore cannot be the literal name a worker is
// addressed by; reconciling that (a slash-free address vs. this display/parse form) is T07's
// job, flagged there. These helpers build and parse the §2.8 form the design specifies; they
// do not decide the addressing scheme.

const SEP = ' / ';

// coordinatorName({ repo, plan }) → "@{repo} / {plan}".
export function coordinatorName({ repo, plan }) {
  return `@${repo}${SEP}${plan}`;
}

// workerName({ repo, plan, task }) → "@{repo} / {plan} / {task}". task is a full id, e.g. "T05".
export function workerName({ repo, plan, task }) {
  return `@${repo}${SEP}${plan}${SEP}${task}`;
}

// parseAgentName(name) → { repo, plan, task, matches }.
//   a coordinator name  → { repo, plan, task: null, matches: true }
//   a worker name       → { repo, plan, task: "T05", matches: true }
//   anything else       → { repo: null, plan: null, task: null, matches: false }
// It is the inverse of the builders and tolerates surrounding spaces and spaces around the
// "/" separators. A name that does not fit the convention is reported (matches: false), never
// guessed into a wrong task (DESIGN §2.8: identity must not drift from a mis-read name).
export function parseAgentName(name) {
  const nomatch = { repo: null, plan: null, task: null, matches: false };
  if (typeof name !== 'string') return nomatch;

  const parts = name.trim().split('/').map((p) => p.trim());

  // The first segment is "@{repo}": it must start with "@" and have a repo after it.
  const first = parts[0] ?? '';
  if (!first.startsWith('@') || first.length === 1) return nomatch;
  const repo = first.slice(1);

  if (parts.length === 2) {
    const plan = parts[1];
    if (plan === '') return nomatch;
    return { repo, plan, task: null, matches: true };
  }

  if (parts.length === 3) {
    const plan = parts[1];
    const task = parts[2];
    // A third segment that is not a task id (T followed by digits) is reported, not parsed
    // into a wrong task — the whole point of not guessing (DESIGN §2.8).
    if (plan === '' || !/^T\d+$/.test(task)) return nomatch;
    return { repo, plan, task, matches: true };
  }

  return nomatch;
}
