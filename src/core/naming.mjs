// The agent-name helpers (DESIGN §2.8). Pure string work: build a coordinator or worker
// name, and parse a name back to its repo, plan and task. No clock, no I/O — the loop
// reads `claude agents --json` in src/shell/ and hands the names here to identify workers
// (DESIGN §3.1, §3.2), so worker-to-task state comes from the names and cannot drift from
// separate bookkeeping.
//
// The convention (DESIGN §2.8):
//   coordinator  {repo} · {plan}
//   worker       {repo} · {plan} · T{nn} · {role}   role ∈ implement | review | verify
//
// Why the role is in the name: an implementer and the fresh reviewer of the same task used to share
// one name ({repo} · {plan} · T{nn}), so the coordinator told them apart by which session was spawned
// most recently — brittle, and it produced a genuine SendMessage ambiguity when the just-closed
// implementer still lingered in the list beside its reviewer (single live run 2026-09-12). Putting the
// role in the name makes each session addressable on its own: implement, review and verify are three
// distinct names, matched directly, never by age (user decision 2026-09-12).
//
// Why "·" (U+00B7) and not "/": T00 (FINDINGS 2026-09-07) found `SendMessage` rejects a name
// containing "/" ("to must be a bare teammate name") — the addressing layer reads "/" as
// structure. The user chose "·" as the separator (2026-09-07); it is decoration, so any char
// with no special meaning to the address parser will do. T07 confirmed live (2026-09-08) that
// "·" IS accepted — and, at the same time, that a leading "@" is NOT: SendMessage gives that same
// "bare teammate name" rejection for a "to" that starts with "@". So the name carries no "@"
// prefix; the user chose to drop it (2026-09-08). A name is the bare "{repo} · {plan}[ · T{nn}]".

const SEP = ' · ';
const SEP_CHAR = '·';

// coordinatorName({ repo, plan }) → "{repo} · {plan}".
export function coordinatorName({ repo, plan }) {
  return `${repo}${SEP}${plan}`;
}

// The three worker roles that a name may carry. The role is the last segment of a worker name and is
// how the coordinator addresses a specific session (implement vs its fresh reviewer) directly.
export const WORKER_ROLES = ['implement', 'review', 'verify'];

// workerName({ repo, plan, task, role }) → "{repo} · {plan} · {task} · {role}". task is a full id
// (e.g. "T05"); role is one of WORKER_ROLES. role is required: a name without it is the old ambiguous
// scheme, so we throw rather than silently build a name the loop will fail to match.
export function workerName({ repo, plan, task, role }) {
  if (!WORKER_ROLES.includes(role)) {
    throw new Error(`workerName: role must be one of ${WORKER_ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  }
  return `${repo}${SEP}${plan}${SEP}${task}${SEP}${role}`;
}

// parseAgentName(name) → { repo, plan, task, role, matches }.
//   a coordinator name  → { repo, plan, task: null, role: null, matches: true }
//   a worker name       → { repo, plan, task: "T05", role: "review", matches: true }
//   anything else       → { repo: null, plan: null, task: null, role: null, matches: false }
// It is the inverse of the builders and tolerates surrounding spaces and spaces around the
// "·" separators. A name that does not fit the convention is reported (matches: false), never
// guessed into a wrong task or role (DESIGN §2.8: identity must not drift from a mis-read name).
export function parseAgentName(name) {
  const nomatch = { repo: null, plan: null, task: null, role: null, matches: false };
  if (typeof name !== 'string') return nomatch;

  const parts = name.trim().split(SEP_CHAR).map((p) => p.trim());

  // The first segment is the repo, with no "@" prefix (SendMessage rejects a leading "@").
  const first = parts[0] ?? '';
  if (first === '') return nomatch;
  const repo = first;

  if (parts.length === 2) {
    const plan = parts[1];
    if (plan === '') return nomatch;
    return { repo, plan, task: null, role: null, matches: true };
  }

  if (parts.length === 4) {
    const plan = parts[1];
    const task = parts[2];
    const role = parts[3];
    // A name whose task segment is not a task id (T followed by digits) or whose role is not one of
    // the three known roles is reported, not parsed into a wrong identity (DESIGN §2.8).
    if (plan === '' || !/^T\d+$/.test(task) || !WORKER_ROLES.includes(role)) return nomatch;
    return { repo, plan, task, role, matches: true };
  }

  return nomatch;
}

// isWorkerOf(name, { repo, plan, role }) → true if `name` is a worker of THIS coordinator's run: it
// parses to a worker name (§2.8 says a worker's name carries a task and a role) with the given repo and
// plan. `role` is optional: omit it to match any of this run's workers (the ceiling count and teardown
// want all roles), pass it to match only that role. The coordinator identifies its workers from the
// name alone (DESIGN §2.8), so this is how it counts only its own workers against the ceiling. The
// coordinator's OWN session (`{repo} · {plan}`, no task) and any foreign agent share the repo git-dir
// and so appear in `claude agents --json`; without this filter they inflate the live count and the
// coordinator under-dispatches by one (T12 Problem 5, from the drill's `ceiling full: 2/1 busy`).
export function isWorkerOf(name, { repo, plan, role } = {}) {
  const p = parseAgentName(name);
  return (
    p.matches &&
    p.task != null &&
    p.repo === repo &&
    p.plan === plan &&
    (role == null || p.role === role)
  );
}
