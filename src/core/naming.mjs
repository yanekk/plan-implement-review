// The agent-name helpers (DESIGN §2.9). Pure string work: build a worker name, and parse a name back
// to its repo, plan, task, slug and role. No clock, no I/O — the loop reads `claude agents --json` in
// src/shell/ and hands the names here to identify workers (DESIGN §3.1, §3.4), so worker-to-task state
// comes from the names and cannot drift from separate bookkeeping.
//
// The convention (DESIGN §2.9):
//   worker  {repo} / {plan} / {task} / {slug} / {role}   role ∈ implement | review
//
// There is NO coordinator name. The coordinator is a plain foreground process (`node
// src/shell/coordinate.mjs {slug}`), never a session, so it never appears in `claude agents` and needs
// no addressable name (DESIGN §2.1, §2.9). The `coordinatorName` helper and the `verify` role that the
// removed hands-on/`you` path used were both retired in T05, once their last callers — in the loop, the
// platform and the live-scenario harness — were gone (DESIGN §3.2, §2.5).
//
// Why the role is in the name: an implementer and the fresh reviewer of the same task used to share one
// name, so the coordinator told them apart by which session was spawned most recently — brittle, and it
// produced a genuine SendMessage ambiguity when the just-closed implementer still lingered in the list
// beside its reviewer (single live run 2026-09-12). Putting the role in the name makes each session
// addressable on its own: implement and review are distinct names (user decision 2026-09-12).
//
// Why the slug is in the name (DESIGN §2.9): a worker's name used to carry only its number, so `claude
// agents` could not tell what T01 was doing. The slug (the kebab name from the task's doc filename and
// its PROGRESS.md Task cell) is carried as a readable label. The task NUMBER stays the identity the
// program matches on across a restart (`buildAssignments` keys on parseAgentName().task), so the slug
// never changes which task a worker resolves to.
//
// Why "/" and not "·": the down-channel is gone (DESIGN §2.2), so the one reason the separator was ever
// "·" — SendMessage rejecting a "/" in a name (T00, FINDINGS 2026-09-07) — is removed with it. The
// separator is "/" (§2.9). Launch-time acceptance of a "/" in `claude --bg -n` is confirmed live in the
// capstone (T09); names with "/" already appear in `claude agents` here.

// The worker-name separator (DESIGN §2.9).
const SEP = ' / ';
const SEP_CHAR = '/';

// The two worker roles a name may carry. The role is the last segment of a worker name and is how a
// specific session (implement vs its fresh reviewer) is addressed directly.
export const WORKER_ROLES = ['implement', 'review'];

// workerName({ repo, plan, task, slug, role }) → "{repo} / {plan} / {task} / {slug} / {role}". task is
// a full id (e.g. "T05"); slug is the task's kebab label; role is one of WORKER_ROLES. role is required:
// a name without it is the old ambiguous scheme, so we throw rather than silently build a name the loop
// will fail to match. slug is likewise required — every task carries a slug (DESIGN §2.9), so an
// omitted slug is a caller bug, not a state to paper over with a default.
export function workerName({ repo, plan, task, slug, role }) {
  if (!WORKER_ROLES.includes(role)) {
    throw new Error(`workerName: role must be one of ${WORKER_ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  }
  if (slug == null || slug === '') {
    throw new Error(`workerName: a slug is required (DESIGN §2.9), got ${JSON.stringify(slug)}`);
  }
  return `${repo}${SEP}${plan}${SEP}${task}${SEP}${slug}${SEP}${role}`;
}

// parseAgentName(name) → { repo, plan, task, slug, role, matches }.
//   a worker name  → { repo, plan, task: "T05", slug: "budget-ledger", role: "review", matches: true }
//   anything else  → all null, matches: false
// It is the inverse of workerName and tolerates surrounding spaces and spaces around the separators. A
// worker name is strictly the five-field "/" form (§2.9); anything that does not fit — a foreign agent,
// a name with the wrong field count, a non-task-id task segment, an unknown role, an empty slug — is
// reported (matches: false), never guessed into a wrong task or role (DESIGN §2.9: identity must not
// drift from a mis-read name).
export function parseAgentName(name) {
  const nomatch = { repo: null, plan: null, task: null, slug: null, role: null, matches: false };
  if (typeof name !== 'string') return nomatch;

  const parts = name.trim().split(SEP_CHAR).map((p) => p.trim());
  if (parts.length !== 5) return nomatch;

  const [repo, plan, task, slug, role] = parts;
  // The repo carries no "@" prefix (SendMessage rejects a leading "@"); an empty repo/plan/slug, a task
  // segment that is not a task id, or an unknown role, is reported rather than parsed into a wrong identity.
  if (repo === '' || plan === '' || slug === '' || !/^T\d+$/.test(task) || !WORKER_ROLES.includes(role)) {
    return nomatch;
  }
  return { repo, plan, task, slug, role, matches: true };
}

// isWorkerOf(name, { repo, plan, role }) → true if `name` is a worker of THIS coordinator's run: it
// parses to a worker name (§2.9 says a worker's name carries a task and a role) with the given repo and
// plan. `role` is optional: omit it to match any of this run's workers (the ceiling count and teardown
// want all roles), pass it to match only that role. The coordinator identifies its workers from the
// name alone (DESIGN §2.9), so this is how it counts only its own workers against the ceiling. A foreign
// agent, or a worker of a sibling plan in the same repo (they share the git-dir and so appear in
// `claude agents --json`), is filtered out — without this filter they inflate the live count and the
// coordinator under-dispatches by one (T12 Problem 5). The slug never enters the match — matching is by
// repo/plan/task-number/role — so a worker resolves to the same task regardless of its label.
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
