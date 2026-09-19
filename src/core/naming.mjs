// The agent-name helpers (DESIGN §2.9). Pure string work: build a coordinator or worker
// name, and parse a name back to its repo, plan, task, slug and role. No clock, no I/O — the
// loop reads `claude agents --json` in src/shell/ and hands the names here to identify workers
// (DESIGN §3.1, §3.4), so worker-to-task state comes from the names and cannot drift from
// separate bookkeeping.
//
// The convention (DESIGN §2.9):
//   coordinator  {repo} · {plan}                          (legacy, removed in T05 — see below)
//   worker       {repo} / {plan} / {task} / {slug} / {role}   role ∈ implement | review | verify
//
// Why the role is in the name: an implementer and the fresh reviewer of the same task used to share
// one name, so the coordinator told them apart by which session was spawned most recently — brittle,
// and it produced a genuine SendMessage ambiguity when the just-closed implementer still lingered in
// the list beside its reviewer (single live run 2026-09-12). Putting the role in the name makes each
// session addressable on its own: implement, review and verify are distinct names (user decision
// 2026-09-12).
//
// Why the slug is in the name (DESIGN §2.9): today a worker's name carried only its number, so
// `claude agents` could not tell what T01 was doing. The slug (the kebab name from the task's doc
// filename and its PROGRESS.md Task cell) is carried as a readable label. The task NUMBER stays the
// identity the program matches on across a restart (`buildAssignments` keys on parseAgentName().task),
// so the slug never changes which task a worker resolves to.
//
// Why "/" and not "·": the down-channel is gone (DESIGN §2.2), so the one reason the separator was
// ever "·" — SendMessage rejecting a "/" in a name (T00, FINDINGS 2026-09-07) — is removed with it.
// The separator reverts to "/" (§2.9). Launch-time acceptance of a "/" in `claude --bg -n` is
// confirmed live in the capstone (T09); names with "/" already appear in `claude agents` here.
//
// The transition (DESIGN §3.2, sequenced across T02 and T05 to keep the suite green at each step):
// this task (T02) flips the WORKER name to the five-field "/" form and adds the slug. It deliberately
// leaves `coordinatorName` on the "·" separator and keeps the `verify` role, because the harness that
// still matches the coordinator by string equality (run.mjs `a.name === coordinatorName(...)`) and
// still builds "·" names is not reworked until T05. So `parseAgentName` accepts BOTH separators for
// the duration: a legacy "·" worker/coordinator name the un-migrated harness still emits round-trips,
// and the new "/" worker name round-trips with its slug. T05 removes `coordinatorName`, the `verify`
// role, and this dual-separator tolerance once the harness no longer produces "·" names.

// The worker-name separator (DESIGN §2.9). Coordinator names keep the legacy "·" until T05 (see the
// COORD_SEP literal on coordinatorName below), which is why this is not shared with it.
const SEP = ' / ';
const SEP_CHAR = '/';
// The legacy separator the un-migrated harness still produces (T05 removes every producer of it, and
// with them the acceptance of it in parseAgentName).
const LEGACY_SEP_CHAR = '·';

// coordinatorName({ repo, plan }) → "{repo} · {plan}". Kept on the legacy "·" separator until T05:
// the harness (run.mjs) matches the coordinator session by exact string equality against "·" names it
// still hardcodes, so flipping this to "/" now would break that match. Removed entirely in T05 — the
// coordinator is a plain process with no agent name (DESIGN §2.9).
export function coordinatorName({ repo, plan }) {
  const COORD_SEP = ' · ';
  return `${repo}${COORD_SEP}${plan}`;
}

// The three worker roles that a name may carry. The role is the last segment of a worker name and is
// how the coordinator addresses a specific session (implement vs its fresh reviewer) directly. `verify`
// is kept until T05 removes the verify path (DESIGN §2.5).
export const WORKER_ROLES = ['implement', 'review', 'verify'];

// workerName({ repo, plan, task, slug, role }) → "{repo} / {plan} / {task} / {slug} / {role}". task is
// a full id (e.g. "T05"); slug is the task's kebab label; role is one of WORKER_ROLES. role is required:
// a name without it is the old ambiguous scheme, so we throw rather than silently build a name the loop
// will fail to match. slug is tolerated as optional for this transition (T02): the un-migrated harness
// callers (run.mjs, the fake platform, the scratch drill) build worker names without a slug, so an
// omitted slug defaults to the task id — a valid, parseable segment that keeps their names round-tripping
// until T05 migrates them to pass a real slug.
export function workerName({ repo, plan, task, slug, role }) {
  if (!WORKER_ROLES.includes(role)) {
    throw new Error(`workerName: role must be one of ${WORKER_ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  }
  const label = slug == null || slug === '' ? task : slug;
  return `${repo}${SEP}${plan}${SEP}${task}${SEP}${label}${SEP}${role}`;
}

// parseAgentName(name) → { repo, plan, task, slug, role, matches }.
//   a coordinator name  → { repo, plan, task: null, slug: null, role: null, matches: true }
//   a worker name       → { repo, plan, task: "T05", slug: "budget-ledger", role: "review", matches: true }
//   a legacy "·" worker → { repo, plan, task: "T05", slug: null, role: "review", matches: true }
//   anything else       → all null, matches: false
// It is the inverse of the builders and tolerates surrounding spaces and spaces around the separators.
// It accepts BOTH separators for the T02→T05 transition (see the module header): a name carrying "/" is
// read as the new five-field worker form; otherwise it falls back to the legacy "·" form the harness
// still emits (a four-field worker or a two-field coordinator). A name that does not fit the convention
// is reported (matches: false), never guessed into a wrong task or role (DESIGN §2.9: identity must not
// drift from a mis-read name).
export function parseAgentName(name) {
  const nomatch = { repo: null, plan: null, task: null, slug: null, role: null, matches: false };
  if (typeof name !== 'string') return nomatch;

  // Pick the separator per name: the new "/" form if the name carries a "/", else the legacy "·". A name
  // never mixes the two — each is produced whole by one builder (or is a foreign default name).
  const sep = name.includes(SEP_CHAR) ? SEP_CHAR : LEGACY_SEP_CHAR;
  const parts = name.trim().split(sep).map((p) => p.trim());

  // The first segment is the repo, with no "@" prefix (SendMessage rejects a leading "@").
  const first = parts[0] ?? '';
  if (first === '') return nomatch;
  const repo = first;

  if (parts.length === 2) {
    // A coordinator name: {repo} · {plan} (legacy), or a "/" default agent name that happens to split in
    // two. Either way it carries no task, so isWorkerOf never counts it as a worker (task must be non-null).
    const plan = parts[1];
    if (plan === '') return nomatch;
    return { repo, plan, task: null, slug: null, role: null, matches: true };
  }

  if (parts.length === 4) {
    // The legacy "·" worker form the un-migrated harness still emits: {repo} · {plan} · T{nn} · {role},
    // no slug. Removed in T05 with the last producer of it.
    const plan = parts[1];
    const task = parts[2];
    const role = parts[3];
    if (plan === '' || !/^T\d+$/.test(task) || !WORKER_ROLES.includes(role)) return nomatch;
    return { repo, plan, task, slug: null, role, matches: true };
  }

  if (parts.length === 5) {
    // The new "/" worker form: {repo} / {plan} / {task} / {slug} / {role}. The slug is carried but is not
    // the identity — the task number is (DESIGN §2.9), so a name whose task segment is not a task id, or
    // whose role is unknown, or whose slug is empty, is reported rather than parsed into a wrong identity.
    const plan = parts[1];
    const task = parts[2];
    const slug = parts[3];
    const role = parts[4];
    if (plan === '' || !/^T\d+$/.test(task) || slug === '' || !WORKER_ROLES.includes(role)) return nomatch;
    return { repo, plan, task, slug, role, matches: true };
  }

  return nomatch;
}

// isWorkerOf(name, { repo, plan, role }) → true if `name` is a worker of THIS coordinator's run: it
// parses to a worker name (§2.9 says a worker's name carries a task and a role) with the given repo and
// plan. `role` is optional: omit it to match any of this run's workers (the ceiling count and teardown
// want all roles), pass it to match only that role. The coordinator identifies its workers from the
// name alone (DESIGN §2.9), so this is how it counts only its own workers against the ceiling. The
// coordinator's OWN session ({repo} · {plan}, no task) and any foreign agent share the repo git-dir
// and so appear in `claude agents --json`; without this filter they inflate the live count and the
// coordinator under-dispatches by one (T12 Problem 5, from the drill's `ceiling full: 2/1 busy`). The
// slug never enters the match — matching is by repo/plan/task-number/role — so a worker resolves to the
// same task regardless of its label.
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
