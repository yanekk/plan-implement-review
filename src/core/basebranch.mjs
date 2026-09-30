// The pure rules of the base branch (plans/base-branch DESIGN §2.1–§2.3, §2.9, §3.3): parse and merge
// the two settings files, validate a branch name, decide from facts the shell gathered which commit is
// the base and what to do with the local branch, and word every refusal and hold. Pure: text and plain
// data in, decisions and strings out; the files, git and the fetch live in src/shell/base-branch.mjs
// (T02). Enforced by boundary.test.mjs (DESIGN §3.1).

// parseSettings(text, source) → { ok: true, settings } | { ok: false, reason: 'bad-settings', file, why }.
// text is the file's contents, or null when the file does not exist. A missing file is fine (§2.2); a
// file that exists must be a JSON object, and a present baseBranch must be a valid branch name. Unknown
// keys are ignored so a later pir can add settings without breaking this one (§2.1).
// settings may also hold the single run's commands (single-runs DESIGN §2.2): `setup`, a list of shell
// lines where [] means "no setup", and `test`, a list that must name at least one line, since a run
// with no test has nothing to call green. A key that is absent stays absent, so the merge can tell a
// key this file does not set apart (the other file's value stands) and an empty setup (a value).
export function parseSettings(text, source) {
  if (text === null || text === undefined) return { ok: true, settings: {} };
  const bad = (why) => ({ ok: false, reason: 'bad-settings', file: source, why });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return bad('it is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return bad('it is not a JSON object');
  const settings = {};
  if ('baseBranch' in data) {
    const name = data.baseBranch;
    if (typeof name !== 'string') return bad('baseBranch must be a string');
    if (name === '') return bad('baseBranch is empty');
    if (!validBranchName(name)) return bad(`baseBranch ${JSON.stringify(name)} is not a valid branch name`);
    settings.baseBranch = name;
  }
  if ('setup' in data) {
    if (!commandList(data.setup)) return bad('"setup" must be a list of commands');
    settings.setup = [...data.setup];
  }
  if ('test' in data) {
    if (!commandList(data.test) || data.test.length === 0) return bad('"test" must be a non-empty list of commands');
    settings.test = [...data.test];
  }
  return { ok: true, settings };
}

// A list of shell lines: an array whose every entry is a string with something in it. A blank line
// would run as a no-op that always passes, which is never what the person meant.
function commandList(value) {
  return Array.isArray(value) && value.every((line) => typeof line === 'string' && line.trim() !== '');
}

// effectiveBase({ repo, user, repoFile, userFile }) → { ok: true, base, file } | refusal.
// repo and user are parseSettings results. A broken file refuses even when the other would have
// supplied a good value (§2.2: a mistake the person should see), the repo file checked first. The user
// file overrides the repo file key by key (§2.1); `file` is the one the winning value came from, so a
// later refusal can say where the base was set.
export function effectiveBase({ repo, user, repoFile, userFile }) {
  if (!repo.ok) return repo;
  if (!user.ok) return user;
  if (user.settings.baseBranch !== undefined) return { ok: true, base: user.settings.baseBranch, file: userFile };
  if (repo.settings.baseBranch !== undefined) return { ok: true, base: repo.settings.baseBranch, file: repoFile };
  return { ok: false, reason: 'no-base-setting' };
}

// effectiveCommands({ repo, user, repoFile, userFile }) →
//   { ok: true, setup, test } | { ok: false, reason: 'no-commands', missing } | a bad-settings result.
// The setup and test lines a single run uses (single-runs DESIGN §2.2). repo and user are parseSettings
// results, merged as effectiveBase merges them: a broken file refuses first, the repo file checked
// first, and the user file overrides key by key, so `setup` and `test` are taken independently. Both
// keys are required; `missing` lists the absent ones in the order setup, test. repoFile and userFile
// are accepted for symmetry with effectiveBase; the refusal text takes them from its own ctx.
export function effectiveCommands({ repo, user }) {
  if (!repo.ok) return repo;
  if (!user.ok) return user;
  const setup = user.settings.setup ?? repo.settings.setup;
  const test = user.settings.test ?? repo.settings.test;
  const missing = [];
  if (setup === undefined) missing.push('setup');
  if (test === undefined) missing.push('test');
  if (missing.length) return { ok: false, reason: 'no-commands', missing };
  return { ok: true, setup, test };
}

// validBranchName(name) → boolean. `git check-ref-format --branch` rules in pure code (§2.2), plus the
// pir/ namespace, which holds pir's own branches: a base there would collide with a feature branch.
// `@` and `HEAD` pass or nearly pass git's check only as shorthands for the current branch, never as a
// branch anyone can be based on, so they are refused too.
export function validBranchName(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (name === '@' || name === 'HEAD') return false;
  if (name.startsWith('-')) return false;
  // Whitespace, ASCII control characters and DEL.
  if (/[\s\x00-\x1f\x7f]/.test(name)) return false;
  if (/[~^:?*[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  // Per component, as git does: none may start with `.` or end with `.lock`.
  for (const part of name.split('/')) {
    if (part.startsWith('.') || part.endsWith('.lock')) return false;
  }
  if (name.startsWith('pir/')) return false;
  return true;
}

// decideBase(facts) → { ok: true, use, local: 'keep'|'create'|'ff' } | { ok: false, reason, ... }.
// The whole of the §2.3 table. facts, gathered by T02:
//   remote: string|null, reached: bool, remoteHas: bool, fetchError: string|null,
//   local: sha|null, tracking: sha|null, localInTracking: bool, trackingInLocal: bool,
//   checkout: null | { path, clean }, aheadBehind: { local, remote } | null
// Behind-and-unsafe still uses the tracking commit: the person asked for work to start from the newest
// commit, and for their own copy to move only when that cannot disturb them (§2.3).
export function decideBase(facts) {
  const { remote, local } = facts;
  const noBase = { ok: false, reason: 'no-base-branch', remote: remote ?? null };
  if (!remote) return local ? { ok: true, use: local, local: 'keep' } : noBase;
  if (!facts.reached) return { ok: false, reason: 'fetch-failed', remote, error: facts.fetchError ?? null };
  if (!facts.remoteHas) return local ? { ok: true, use: local, local: 'keep' } : noBase;
  if (facts.fetchError) return { ok: false, reason: 'fetch-failed', remote, error: facts.fetchError };
  const tracking = facts.tracking;
  if (!local) return { ok: true, use: tracking, local: 'create' };
  if (local === tracking || (facts.localInTracking && facts.trackingInLocal)) return { ok: true, use: tracking, local: 'keep' };
  if (facts.localInTracking) {
    const safe = facts.checkout === null || facts.checkout === undefined || facts.checkout.clean === true;
    return { ok: true, use: tracking, local: safe ? 'ff' : 'keep' };
  }
  if (facts.trackingInLocal) return { ok: true, use: local, local: 'keep' };
  const ab = facts.aheadBehind ?? { local: null, remote: null };
  return { ok: false, reason: 'diverged', remote, ahead: ab.local, behind: ab.remote };
}

// The fix line for a missing setting names both files (§2.1, §2.9).
const SETTING_LINE = '{"baseBranch": "<branch>"}';

// refusalText(result, { repo, base, file, remote }) → the §2.9 refusal for a failed effectiveBase or
// decideBase result. ctx fills what the result does not carry; the result's own remote wins.
export function refusalText(result, ctx = {}) {
  const remote = result.remote ?? ctx.remote ?? null;
  const base = ctx.base;
  switch (result.reason) {
    case 'no-base-setting':
      return `pir: no base branch is set for ${ctx.repo}. Add .pir/settings.json with ${SETTING_LINE} (committed, for everyone), or ~/.pir/${ctx.repo}/settings.json (this machine only).`;
    case 'bad-settings':
      return `pir: ${result.file ?? ctx.file} is not usable: ${result.why}.`;
    case 'no-base-branch':
      return remote
        ? `pir: the base branch ${base} (set in ${ctx.file}) exists neither locally nor on ${remote}.`
        : `pir: the base branch ${base} (set in ${ctx.file}) does not exist locally, and this repo has no remote.`;
    case 'fetch-failed':
      return `pir: could not fetch ${base} from ${remote}: ${lastLine(result.error)}. Nothing was created; try again when ${remote} is reachable.`;
    case 'diverged':
      return `pir: your ${base} and ${remote}/${base} have split apart (${count(result.ahead)} local, ${count(result.behind)} remote commits not in the other). Pull or push to reconcile them, then try again.`;
    default:
      return `pir: cannot prepare the base branch ${base}: ${result.reason}.`;
  }
}

// The line to add for each missing command key, as the person would type it into the settings file.
const COMMAND_LINES = { setup: '"setup": ["<install command>"]', test: '"test": ["<test command>"]' };

// commandsRefusalText(result, { repo, repoFile, userFile }) → the refusal for a failed
// effectiveCommands result (single-runs DESIGN §2.2): both files and the exact line to add, naming only
// the keys that are missing. `repo` is the repo's name.
export function commandsRefusalText(result, ctx = {}) {
  switch (result.reason) {
    case 'no-commands': {
      const missing = result.missing ?? ['setup', 'test'];
      const lines = missing.map((key) => COMMAND_LINES[key]).join(', ');
      return `${ctx.repo} has no ${missing.join('/')} commands for a single run. Add to ${ctx.repoFile} (or ${ctx.userFile}): ${lines}`;
    }
    case 'bad-settings':
      return `${result.file}: ${result.why}`;
    default:
      return `${ctx.repo}: cannot read the single run's commands: ${result.reason}`;
  }
}

// holdText(result, { base, remote }) → the short reason an end-of-run hold shows (§2.8), without a
// prefix: the live view writes it after `preparing: `, the one alert after `{slug} · waiting: `.
export function holdText(result, ctx = {}) {
  const remote = result.remote ?? ctx.remote ?? null;
  const base = ctx.base;
  switch (result.reason) {
    case 'fetch-failed':
      return `can't reach ${remote}, retrying`;
    case 'diverged':
      return `your ${base} and ${remote}/${base} have split apart`;
    case 'no-base-branch':
      return remote ? `${base} exists neither locally nor on ${remote}` : `${base} does not exist`;
    default:
      return `can't prepare ${base}: ${result.reason}`;
  }
}

// git's last non-blank line is the one that names the cause (`fatal: …`); the rest is progress noise.
function lastLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.length ? lines[lines.length - 1] : 'no error output';
  return line.replace(/\.$/, '');
}

function count(n) {
  return Number.isInteger(n) ? String(n) : '?';
}
