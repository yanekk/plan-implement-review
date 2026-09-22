// Pure settings-merge logic (DESIGN §3.1, §7; T06).
//
// A worker is still an agentic session, so the auto-mode safety classifier can second-guess
// its ordinary git/npm commands. Two settings changes clear that: a narrow project-level
// `permissions.allow` of bare, prefix-matching commands (which resolve BEFORE the classifier
// runs), shipped with the framework; and a user-global `autoMode.allow` exception naming the
// worker's git on the run's own branches as trusted (the classifier ignores `autoMode` in a
// project file, by design, so it must live in ~/.claude/settings.json).
//
// These functions are the JSON-in/JSON-out core of both merges. They take the parsed settings
// as a parameter and return a new object; all file I/O lives in src/shell/settings-merge.mjs,
// which install.sh drives. Both merges are order-preserving, non-clobbering and idempotent:
// running them twice is a no-op, and neither drops a rule the target already had.

// The narrow worker permissions the framework ships in a project's .claude/settings.json.
// Bare and prefix-matched so a clean worker command resolves before the classifier at all.
// `Bash(git merge:*)` IS here: a worker's integrate step runs `git merge pir/{slug}` to fold
// the run's feature branch into its own task branch before it signals done (pir-worker SKILL.md,
// branch-model.md § Merges). That merge writes only the worker's own task branch, never a peer's
// and never main, so it is trusted like the worker's other git; without it the classifier gates
// the integrate as "Modify Shared Resources" and parks the worker at its finish line. The engine's
// own task→feature merge (worktree.mjs) is child-process git and never classifier-gated; that is a
// separate path, not the reason merge is listed here. Deliberately NOT here: `SendMessage` (the
// coordinator down-channel is gone, §2.2).
export const WORKER_PERMISSIONS = [
  'Bash(npm test:*)',
  'Bash(node --test:*)',
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git diff:*)',
  'Bash(git branch:*)',
  'Bash(git rev-parse:*)',
  'Bash(git merge-base:*)',
  'Bash(git merge:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
];

// The sentinel that stands for the built-in default auto-mode rules. Kept (or restored to the
// front if a target's list somehow lacks it) so merging pir's exception never disables the
// defaults — dropping it would silently widen what auto mode permits.
export const AUTO_MODE_DEFAULTS = '$defaults';

// The pir-specific auto-mode exception. Natural language, because auto-mode rules are judged by
// an LLM classifier (validate wording with `claude auto-mode critique`). It names only the
// worker's own git on the run's own branches, `merge` included — the integrate step is spelled
// out so the classifier reads the merge as touching only the worker's own task branch. This rule
// mirrors WORKER_PERMISSIONS. That `permissions.allow` alone may already clear these, making this
// rule belt-and-suspenders, is confirmed live in T09; the integrate merge is gated in practice, so
// merge is carried in both.
export const PIR_AUTOMODE_RULE =
  'A pir worker running git (add/commit/status/log/show/diff/rev-parse/merge-base/branch/merge) ' +
  "against the run's own branches pir/{slug} and pir/{slug}-T{nn} inside the session's " +
  'repository is trusted work on the session’s own branches, not Modify Shared Resources. This ' +
  'includes the integrate step, where the worker runs `git merge pir/{slug}` to fold the run’s ' +
  'feature branch into its own checked-out task branch pir/{slug}-T{nn}: the merge only writes ' +
  "the worker's own task branch, never main and never a branch another worker holds.";

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Merge the shipped worker permissions into a project's settings. Existing allow rules keep
// their order and position; only rules not already present are appended.
export function mergeProjectPermissions(existing, ship = WORKER_PERMISSIONS) {
  const base = asObject(existing);
  const permissions = asObject(base.permissions);
  const current = Array.isArray(permissions.allow) ? permissions.allow : [];
  const allow = [...current];
  for (const rule of ship) {
    if (!allow.includes(rule)) allow.push(rule);
  }
  return { ...base, permissions: { ...permissions, allow } };
}

// Merge pir's auto-mode exception into the user-global settings. `$defaults` is preserved (or
// restored to the front if absent), the rule is appended once, and every other setting the file
// holds is left untouched.
export function mergeUserAutoMode(existing, rule = PIR_AUTOMODE_RULE) {
  const base = asObject(existing);
  const autoMode = asObject(base.autoMode);
  const current = Array.isArray(autoMode.allow) ? autoMode.allow : [];
  const allow = [...current];
  if (!allow.includes(AUTO_MODE_DEFAULTS)) allow.unshift(AUTO_MODE_DEFAULTS);
  if (!allow.includes(rule)) allow.push(rule);
  return { ...base, autoMode: { ...autoMode, allow } };
}
