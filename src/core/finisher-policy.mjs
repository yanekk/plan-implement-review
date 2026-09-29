// The finisher's rulebook (finisher DESIGN §2.2–§2.7, §2.12). Pure: it decides which phase the finisher
// is in after an event, what each phase lets it do, which Bash commands only look, which answer is the
// person's go, which status files are valid, and which rules file is used. The shell (T04) reads files,
// canonicalises paths and applies what this returns; everything pir enforces about the finisher is
// decided and tested here.
//
// The fence is an allowlist (DESIGN §2.4): a missing harmless command costs the finisher one denied call,
// a missing harmful one would cost the fence. Every doubt here resolves to "not look-only".

import { join, basename } from 'node:path';
import { commandParts, reservedFor } from './coordinator-policy.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export const PHASES = ['preparing', 'awaiting-go', 'finishing', 'stuck', 'done'];
const LOOK_ONLY_PHASES = ['preparing', 'awaiting-go', 'stuck'];

// ---- The look-only list (DESIGN §2.4) ----

// A command part's words, quotes respected and removed. `commandParts` keeps quotes in its text, so a
// quoted path with a space (`git -C "/my repo" status`) is still one word here.
function words(part) {
  const out = [];
  let cur = '';
  let quote = null;
  let any = false;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < part.length) cur += part[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (c === '\\' && i + 1 < part.length) {
      cur += part[++i];
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) out.push(cur);
      cur = '';
      any = false;
    } else {
      cur += c;
      any = true;
    }
  }
  if (cur || any) out.push(cur);
  return out;
}

const exactly = (...want) => (w) => w.length === want.length && want.every((x, i) => w[i] === x);
const leads = (...want) => (w) => w.length >= want.length && want.every((x, i) => w[i] === x);

// `git branch` only in its listing forms: no argument but these flags (DESIGN §2.4). `--contains` takes
// a commit, and `--list` makes every positional a pattern to list, never a branch to create, so those
// are listing too. Anything else (`-D`, `-m`, a bare name) creates, moves or deletes.
const BRANCH_FLAGS = ['--list', '-a', '-v', '--show-current', '--contains'];
function branchListing(w) {
  if (w[0] !== 'git' || w[1] !== 'branch') return false;
  const rest = w.slice(2);
  const listing = rest.includes('--list');
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--contains=')) continue;
    if (a === '--contains') {
      if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) i++;
      continue;
    }
    if (BRANCH_FLAGS.includes(a)) continue;
    if (listing && !a.startsWith('-')) continue;
    return false;
  }
  return true;
}

// Each entry matches the words of one command part. A `git` part reaches these with its leading
// `-C <path>` pairs already removed (see `gitWords`).
export const LOOK_ONLY = [
  { name: 'git status', match: leads('git', 'status') },
  { name: 'git log', match: leads('git', 'log') },
  { name: 'git diff', match: leads('git', 'diff') },
  { name: 'git show', match: leads('git', 'show') },
  { name: 'git rev-parse', match: leads('git', 'rev-parse') },
  { name: 'git merge-base', match: leads('git', 'merge-base') },
  { name: 'git merge-tree', match: leads('git', 'merge-tree') },
  { name: 'git branch (listing)', match: branchListing },
  { name: 'git remote -v', match: exactly('git', 'remote', '-v') },
  { name: 'git worktree list', match: leads('git', 'worktree', 'list') },
  { name: 'git ls-files', match: leads('git', 'ls-files') },
  { name: 'git ls-tree', match: leads('git', 'ls-tree') },
  { name: 'git cat-file', match: leads('git', 'cat-file') },
  ...['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'diff', 'cmp', 'shasum', 'test', '[', 'which', 'pwd', 'echo']
    .map((cmd) => ({ name: cmd, match: leads(cmd) })),
  { name: 'command -v', match: (w) => w[0] === 'command' && (w[1] === '-v' || w[1] === '-V') },
  { name: 'node --version', match: exactly('node', '--version') },
  { name: 'npm --version', match: exactly('npm', '--version') },
  { name: 'gh auth status', match: leads('gh', 'auth', 'status') },
  { name: 'gh pr list', match: leads('gh', 'pr', 'list') },
  { name: 'gh pr view', match: leads('gh', 'pr', 'view') },
  { name: 'cd <path>', match: (w) => w[0] === 'cd' && w.length <= 2 },
];

// A git part with its leading `-C <path>` pairs removed, or null when git carries any other global
// option (`-c`, `--exec-path`, `--git-dir`, …) or an option that runs or writes something anywhere in
// the line (`--output`, `--ext-diff`). `git log -c` stays allowed: after the subcommand `-c` is a diff
// format, not configuration.
function gitWords(w) {
  if (w[0] !== 'git') return w;
  const out = ['git'];
  let i = 1;
  while (w[i] === '-C') {
    if (i + 1 >= w.length) return null;
    i += 2;
  }
  if (i >= w.length || w[i].startsWith('-')) return null;
  out.push(...w.slice(i));
  if (out.some((a) => a.startsWith('--output') || a === '--ext-diff')) return null;
  return out;
}

// True when the shell would expand something in this part before the command sees it: a `$` outside
// single quotes (a variable, `${X:=…}`, `$'…'`, `$_`, or the `$SUBSTITUTED` left by `flatten`) or an
// unquoted brace expansion (`{a,b}`, `{a..b}`). Its value can be any word, so it can carry a git option
// the word check never sees: `git log $(echo --output=/tmp/x)` wrote /tmp/x (review T01). `@{u}` and
// `HEAD@{1}` have no comma or `..` inside the braces, so bash leaves them alone and so does this.
function expands(part) {
  let quote = null;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') i++;
    else if (c === '$') return true;
    else if (quote === '"') {
      if (c === '"') quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '{') {
      const end = part.indexOf('}', i + 1);
      const body = end < 0 ? '' : part.slice(i + 1, end);
      if (body.includes(',') || body.includes('..')) return true;
    }
  }
  return false;
}

// A git part is judged on its words only when nothing in it expands; any other look-only command keeps
// its expansions, since none of them has an option that writes or runs something (DESIGN §2.4 list).
const partIsLookOnly = (part) => {
  const w = gitWords(words(part));
  if (!w || w.length === 0) return false;
  if (w[0] === 'git' && expands(part)) return false;
  return LOOK_ONLY.some((e) => e.match(w));
};

// Scan the raw command, quote-aware, before `commandParts` cuts redirects away. Returns the command with
// every `$(…)`/backtick body replaced by the word `$SUBSTITUTED` once that body has itself been found look-only, or
// null when the command redirects output, uses process substitution, or substitutes anything nested or
// not look-only.
function flatten(command) {
  let out = '';
  let quote = null; // "'" or '"'
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      out += c;
      if (c === "'") quote = null;
      continue;
    }
    if (c === '\\' && i + 1 < command.length) {
      out += c + command[++i];
      continue;
    }
    if (quote === '"' && c === '"') {
      quote = null;
      out += c;
      continue;
    }
    if (!quote && (c === "'" || c === '"')) {
      quote = c;
      out += c;
      continue;
    }
    if (c === '$' && command[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === '(') depth++;
        else if (command[j] === ')') depth--;
      }
      if (depth !== 0) return null;
      const body = command.slice(i + 2, j - 1);
      if (/[()]/.test(body) || !checkLine(body, false)) return null; // nested, arithmetic or acting
      out += '$SUBSTITUTED';
      i = j - 1;
      continue;
    }
    if (c === '`') {
      const j = command.indexOf('`', i + 1);
      if (j < 0) return null;
      const body = command.slice(i + 1, j);
      if (/[()]/.test(body) || !checkLine(body, false)) return null;
      out += '$SUBSTITUTED';
      i = j;
      continue;
    }
    if (!quote) {
      if (c === '>') return null; // `>`, `>>`, `2>&1`, `&>`, `<>` and `>(…)` all write or run
      if (c === '<' && command[i + 1] === '(') return null; // process substitution runs a command
    }
    out += c;
  }
  return quote ? null : out;
}

// A leading `NAME=value` on any simple command is refused: `commandParts` drops it silently, and
// `GIT_EXTERNAL_DIFF=…`, `GIT_PAGER=…` or `PAGER=…` would run a program from a look-only command.
const ASSIGNMENT = /(?:^|&&|\|\||[;|\n\r&(])\s*[A-Za-z_]\w*=/;

// isLookOnly(command) → boolean: every simple command in the line is on LOOK_ONLY, nothing is
// redirected to a file, and every command substitution is itself look-only and not nested.
export function isLookOnly(command) {
  return checkLine(command, true);
}

// `substitutions` is false for a `$(…)`/backtick body, so a nested one is refused outright.
function checkLine(command, substitutions) {
  if (!nonEmpty(command)) return false;
  if (!substitutions && /`|\$\(/.test(command)) return false;
  const flat = flatten(command);
  if (flat === null || ASSIGNMENT.test(flat)) return false;
  const parts = commandParts(flat);
  return parts.length > 0 && parts.every(partIsLookOnly);
}

// ---- The gate (DESIGN §2.4, §2.5) ----

const FILE_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Skill'];

// finisherVerdict({ phase, toolName, input, askRules, fileVerdict }) → 'allow' | 'deny' | 'person'
//   fileVerdict: the coordinator agent's `gateFor` answer for the file tools, computed by the shell,
//   which owns path canonicalising; this module does no path checks of its own (DESIGN §3.2).
// An unknown phase is treated as `done` (deny all): the shell reads a lost phase as `preparing`, so an
// unknown one here means a caller bug, and a bug must not open the fence.
export function finisherVerdict({ phase, toolName, input, askRules = [], fileVerdict } = {}) {
  if (toolName === 'AskUserQuestion' && phase !== 'done' && PHASES.includes(phase)) return 'person';
  if (LOOK_ONLY_PHASES.includes(phase)) {
    if (FILE_TOOLS.includes(toolName)) return fileVerdict === 'allow' ? 'allow' : 'deny';
    if (toolName === 'Bash') return isLookOnly(isObject(input) ? input.command : undefined) ? 'allow' : 'deny';
    return 'deny';
  }
  if (phase === 'finishing') {
    if (!nonEmpty(toolName)) return 'deny';
    return reservedFor({ toolName, input: isObject(input) ? input : {} }, askRules) ? 'person' : 'allow';
  }
  return 'deny';
}

// ---- Status files (DESIGN §2.6) ----

const STATUS_KINDS = ['ready', 'stuck', 'done', 'close'];

function readSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.every(nonEmpty) ? [...steps] : null;
}

// readStatus(obj) → { ok: true, status } | { ok: false, why }. Keeps only the fields its kind defines.
export function readStatus(obj) {
  if (!isObject(obj)) return { ok: false, why: 'a status must be a JSON object' };
  if (!STATUS_KINDS.includes(obj.kind)) {
    return { ok: false, why: `unknown kind ${JSON.stringify(obj.kind)}; expected one of ${STATUS_KINDS.join(', ')}` };
  }
  const need = (field, what) => (nonEmpty(obj[field]) ? null : { ok: false, why: `a ${obj.kind} status needs \`${field}\`: ${what}` });
  switch (obj.kind) {
    case 'ready': {
      const miss = need('rules', 'the path of the rules file used') ?? need('summary', 'what you checked and found');
      if (miss) return miss;
      const steps = readSteps(obj.steps);
      if (!steps) return { ok: false, why: 'a ready status needs `steps`: a non-empty list of non-empty strings' };
      return { ok: true, status: { kind: 'ready', rules: obj.rules, summary: obj.summary, steps } };
    }
    case 'stuck': {
      const miss = need('summary', 'what failed, what is done, what is not') ?? need('proposal', 'retry, fix or undo, in words');
      if (miss) return miss;
      const steps = readSteps(obj.steps);
      if (!steps) return { ok: false, why: 'a stuck status needs `steps`: a non-empty list of non-empty strings' };
      return { ok: true, status: { kind: 'stuck', summary: obj.summary, proposal: obj.proposal, steps } };
    }
    case 'done': {
      const miss = need('summary', 'what you did');
      return miss ?? { ok: true, status: { kind: 'done', summary: obj.summary } };
    }
    case 'close': {
      const miss = need('reason', "the person's words");
      return miss ?? { ok: true, status: { kind: 'close', reason: obj.reason } };
    }
  }
}

// Which phases accept each kind, and the phase after it. `close` keeps the phase; the shell ends the run.
const ACCEPTED = {
  ready: { in: ['preparing', 'awaiting-go'], next: () => 'awaiting-go' },
  stuck: { in: ['finishing', 'awaiting-go'], next: () => 'stuck' },
  done: { in: ['finishing'], next: () => 'done' },
  close: { in: PHASES, next: (phase) => phase },
};

// checkStatus(status, phase) → { ok: true, next } | { ok: false, why }
export function checkStatus(status, phase) {
  const rule = isObject(status) ? ACCEPTED[status.kind] : undefined;
  if (!rule) return { ok: false, why: 'not a status' };
  if (!PHASES.includes(phase)) return { ok: false, why: `unknown phase ${JSON.stringify(phase)}` };
  if (!rule.in.includes(phase)) {
    return { ok: false, why: `a ${status.kind} status is not accepted while the finisher is ${phase}; it is accepted in ${rule.in.join(' or ')}` };
  }
  return { ok: true, next: rule.next(phase) };
}

// ---- The go (DESIGN §2.7) ----

// isGoAnswer({ phase, toolName, input, answers }) → boolean. `answers` maps question text → the chosen
// answer, from pir's own reply or parsed from an `answered-remotely` tool result; the shell decides that
// the answer came from the person, this decides that it is the go.
export function isGoAnswer({ phase, toolName, input, answers } = {}) {
  if (phase !== 'awaiting-go' && phase !== 'stuck') return false;
  if (toolName !== 'AskUserQuestion' || !isObject(input) || !isObject(answers)) return false;
  const qs = Array.isArray(input.questions) ? input.questions : [];
  if (qs.length !== 1 || !isObject(qs[0]) || qs[0].header !== 'Go' || !nonEmpty(qs[0].question)) return false;
  return answers[qs[0].question] === 'Go';
}

// ---- Restart (DESIGN §2.12) ----

export const RESTARTED_MID_FINISH = 'the finisher restarted mid-finish; it will check what is already done';

// afterRestart(phase) → { phase, stuckSummary | null }. A go is never carried over unseen work.
export function afterRestart(phase) {
  if (phase === 'finishing') return { phase: 'stuck', stuckSummary: RESTARTED_MID_FINISH };
  if (!PHASES.includes(phase)) return { phase: 'preparing', stuckSummary: null };
  return { phase, stuckSummary: null };
}

// ---- The rules file (DESIGN §2.2) ----

const RULES_FILE = 'on-finish.md';

// chooseRules({ featurePath, home, repo, engineDir, exists }) → { path, source }
//   repo: the repo's name as pir uses it (`basename(repoRoot)`); a full path is reduced to its name.
//   exists(path) → boolean, supplied by the shell. The engine's own copy is the fallback and is not
//   checked: install ships it, and the finisher says in its summary that it ran on the built-in rules.
export function chooseRules({ featurePath, home, repo, engineDir, exists }) {
  const name = basename(String(repo));
  const candidates = [
    { path: join(featurePath, '.pir', 'rules', RULES_FILE), source: 'project' },
    { path: join(home, '.pir', name, 'rules', RULES_FILE), source: 'yours' },
    { path: join(home, '.pir', 'default', 'rules', RULES_FILE), source: 'default' },
  ];
  for (const c of candidates) if (exists(c.path)) return c;
  return { path: join(engineDir, 'rules', 'default', RULES_FILE), source: 'built-in' };
}
