// planbox.mjs — the decisions of the runs list's box (dashboard-plan-box DESIGN §2.2–§2.6; its grammar,
// completion contexts, notes and head line are box-commands DESIGN §2.1–§2.5, which wins where they differ).
//
// Pure: the box's text, the repo list and the key arrive as arguments, and what comes back is a
// decision the shell acts on (T04's list view, T05's submit). Every rule the person can trip over on
// this screen lives here so it is tested in milliseconds rather than through a pty (§2.3's last line).

// The text the box holds whenever the list opens, after a plan starts, and after a reset (§2.2).
export const BARE_TEXT = '@';

// Bare is exactly '@' or empty (§2.2). On a bare box the list keeps its whole key table (§2.3).
export function isBare(text) {
  return text === BARE_TEXT || text === '' || text == null;
}

// The box's two commands (box-commands DESIGN §2.1), in the order the command pop-up lists them: `plan`
// above `start`, so `@sk` ↵ ↓ ↵ reaches start with one ↓ (user, plan review 2026-09-28). Lower case, exact.
export const COMMANDS = [
  { name: 'plan', description: 'plan something new' },
  { name: 'start', description: 'build a reviewed plan' },
];
const COMMAND_NAMES = new Set(COMMANDS.map((c) => c.name));

// The notes Enter leaves when it starts nothing — box-commands DESIGN §2.4's table, verbatim. Exported so
// the shell's tests assert on the same strings rather than retyping them.
export const NOTES = {
  noAt: () => 'start with @repo/plan or @repo/start',
  unknownRepo: (name, roots) => `no repo @${name} in ${roots} — pick one from the list`,
  ambiguousRepo: (name, paths) => `@${name} is in more than one folder: ${paths.join(', ')}`,
  noCommand: (name) => `pick a command: @${name}/plan or @${name}/start`,
  unknownCommand: (name, cmd) => `@${name}/${cmd} is not a command — use /plan or /start`,
  emptyBrief: (name) => `say what to plan after @${name}/plan`,
  noSlug: (name) => `name a plan to build after @${name}/start`,
  extraWords: (name) => `@${name}/start takes one plan name`,
  unknownSlug: (name, slug) => `${slug} is not a reviewed, unfinished plan in ${name}`,
};

// startPlanRun's refusal codes in plain words, short enough that the note fits 80 columns (user, 2026-09-27,
// T06 drill: the raw `no-main` read as an internal code). A reason not listed, e.g. a thrown error's message,
// is shown as it came.
const START_REFUSALS = {
  'not-a-repo': 'it is not a git repository',
  'no-main': 'it has no local main branch',
  'empty-brief': 'the brief is empty',
};

// §2.4's `startPlanRun` row: startPlanRun refused or threw.
export function startFailedNote(name, reason) {
  return `Could not start planning in ${name}: ${START_REFUSALS[reason] ?? reason}`;
}

// startRun's refusal codes in plain words (box-commands DESIGN §2.4); anything else as it came.
const BUILD_REFUSALS = {
  'not-reviewed': 'it is not reviewed',
  'no-plan': 'there is no such plan',
  'no-test-block': 'no setup/test block', // user, 2026-09-28: the DESIGN wording overran 80 columns
};

// §2.4's `startRun` row: startRun refused or threw.
export function startBuildFailedNote(name, slug, reason) {
  return `Could not start ${slug} in ${name}: ${BUILD_REFUSALS[reason] ?? reason}`;
}

// The first line's head (§2.1): `@`, the name up to the first `/` or whitespace (a repo folder name never
// holds a `/`), then, if a `/` follows, the command up to the next whitespace. The rest is the argument.
// '@' followed by whitespace, '/' or nothing has no name, so `@ a brief` reads like a text with no '@'.
const HEAD = /^@([^\s/]+)(?:\/(\S*))?/;

// → null when there is no name; else { name, command (null with no '/'; '' for a bare '/'), rest }.
function readHead(text) {
  const s = String(text ?? '');
  const m = HEAD.exec(s);
  if (!m) return null;
  return { name: m[1], command: m[2] ?? null, rest: s.slice(m[0].length) };
}

// Exact names only (dashboard-plan-box §2.5, user 2026-09-26 reversing unique-prefix matching): `@ska` never
// means `skaut`.
function matching(repos, name) {
  return (repos ?? []).filter((r) => r.name === name);
}

// parseBoxText(text, repos, { roots, plansOf }) → what Enter would do with this text (§2.4).
// The checks run in §2.4's table order, so the first that applies wins (`@nope/bogus` is unknown-repo).
// A brief is the rest trimmed at both ends, its inner newlines kept. A slug must be exactly one of
// plansOf(repo)'s, never a prefix (§2.4, planner). plansOf is a scan of the disk, so it is called only for
// a /start text with a single word, after the repo resolved.
export function parseBoxText(text, repos, { roots, plansOf = () => [] } = {}) {
  const head = readHead(text);
  if (head === null) return { ok: false, reason: 'no-at', note: NOTES.noAt() };
  const { name, command, rest } = head;
  const found = matching(repos, name);
  if (found.length === 0) return { ok: false, reason: 'unknown-repo', name, note: NOTES.unknownRepo(name, roots) };
  if (found.length > 1) {
    const paths = found.map((r) => r.path);
    return { ok: false, reason: 'ambiguous-repo', name, paths, note: NOTES.ambiguousRepo(name, paths) };
  }
  const repo = found[0];
  if (!command) return { ok: false, reason: 'no-command', name, note: NOTES.noCommand(name) };
  if (!COMMAND_NAMES.has(command)) {
    return { ok: false, reason: 'unknown-command', name, command, note: NOTES.unknownCommand(name, command) };
  }
  const arg = rest.trim();
  if (command === 'plan') {
    if (arg === '') return { ok: false, reason: 'empty-brief', name, command, note: NOTES.emptyBrief(name) };
    return { ok: true, command, repo, brief: arg };
  }
  if (arg === '') return { ok: false, reason: 'no-slug', name, command, note: NOTES.noSlug(name) };
  if (/\s/.test(arg)) return { ok: false, reason: 'extra-words', name, command, note: NOTES.extraWords(name) };
  if (!(plansOf(repo) ?? []).some((p) => p.slug === arg)) {
    return { ok: false, reason: 'unknown-slug', name, command, slug: arg, note: NOTES.unknownSlug(name, arg) };
  }
  return { ok: true, command, repo, slug: arg };
}

// completionContext(line, col) → which pop-up the cursor is in (§2.2), from the first line's text before the
// cursor, or null outside the three contexts. The re-open rule (end of line, after which keys) is the list
// view's; this only says what a pop-up there would list.
//   repo:    `@` then name characters, no `/` yet          → query: the typed part of the name
//   command: `@name/` then letters                          → query: the typed letters
//   slug:    `@name/start`, whitespace, then one word or none → query: the typed part of the slug
const REPO_CTX = /^@([^\s/]*)$/;
const COMMAND_CTX = /^@([^\s/]+)\/([A-Za-z]*)$/;
const SLUG_CTX = /^@([^\s/]+)\/start\s+(\S*)$/;

export function completionContext(line, col) {
  const s = String(line ?? '');
  const before = s.slice(0, col ?? s.length);
  let m = REPO_CTX.exec(before);
  if (m) return { kind: 'repo', query: m[1] };
  m = COMMAND_CTX.exec(before);
  if (m) return { kind: 'command', name: m[1], query: m[2] };
  m = SLUG_CTX.exec(before);
  if (m) return { kind: 'slug', name: m[1], query: m[2] };
  return null;
}

// headLine(text, repos, { roots, plansOf }) → the words after the head line's label, and their style
// (§2.5). Amber (`your-go`) where Enter would refuse for a reason the person can see coming. A name in two
// roots still names a listed repo; Enter's note is what explains the clash. plansOf is read only in the
// /start rows, so typing a brief never pays for a plan scan (§2.5, planner).
export function headLine(text, repos, { roots, plansOf = () => [] } = {}) {
  if (isBare(text)) return { text: 'start with @repo', style: 'dim' };
  const head = readHead(text);
  if (head === null) return { text: 'start with @repo', style: 'your-go' };
  const { name, command } = head;
  const found = matching(repos, name);
  if (found.length === 0) return { text: `@${name} is not a repo in ${roots}`, style: 'your-go' };
  if (!command) return { text: `in ${name} — /plan or /start`, style: 'dim' };
  if (!COMMAND_NAMES.has(command)) return { text: `/${command} is not a command — /plan or /start`, style: 'your-go' };
  if (command === 'plan') return { text: `plan in ${name}`, style: 'dim' };
  const buildable = found.some((r) => (plansOf(r) ?? []).length > 0);
  return buildable ? { text: `build in ${name}`, style: 'dim' } : { text: `nothing to build in ${name}`, style: 'your-go' };
}

// rankRepos(repos) → a new array, most recently worked in first, the name as tie-break (§2.4).
export function rankRepos(repos) {
  return [...(repos ?? [])].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// The keys the list binds on a bare box (§2.3; pir-tui.mjs decodeKey's table). `left` is in it
// because the list binds it (a no-op there); `n` is not, since the list only reads it on a run's go
// question, so on the list it is a letter for the box. Esc and Ctrl+C are the list's quit, returned
// as 'quit' so the caller need not consult the list's table for them.
const LIST_KEYS = new Set(['up', 'down', 'left', 'right', 'enter', 'ctrl+s', 'ctrl+x', 'ctrl+r']);
const CHORDS = new Set(['ctrl+s', 'ctrl+x', 'ctrl+r']);
const RESET_KEYS = new Set(['escape', 'ctrl+c']);

// routeBoxKey({ text, key, completing, newLine }) → where a keypress goes (§2.3).
//   key: pi-tui's parseKey name, or null for text (a printable, a paste).
//   completing: the repo pop-up is open. newLine: the data matches tui.input.newLine.
//
// On a bare box the list's table is consulted first, newLine included: pi-tui parses a bare LF as
// 'enter' and also matches it to tui.input.newLine (ctrl+j), and the list opens on LF today, which §1
// keeps. The pop-up is ignored there too: §2.3 says none shows, so a stale one must not swallow the
// list's keys. Once the box is not bare a newLine key is the editor's, never a submit (Shift+Enter,
// Ctrl+J), and an open pop-up takes every key (§2.3's first row), chords included.
export function routeBoxKey({ text, key, completing = false, newLine = false } = {}) {
  if (isBare(text)) {
    if (RESET_KEYS.has(key)) return 'quit';
    if (LIST_KEYS.has(key)) return 'list';
    return 'box';
  }
  if (newLine) return 'box';
  if (completing) return 'box';
  if (key === 'enter') return 'submit';
  if (RESET_KEYS.has(key)) return 'reset';
  if (CHORDS.has(key)) return 'list';
  return 'box';
}

// absorbAt(text, data) → the data to hand the editor (§2.3). An '@' typed, or a paste starting with
// '@', into a box that is exactly '@' loses that leading '@', so `@skaut …` typed from habit reads the
// same as `skaut …`. An empty box keeps it: there the '@' is the one the brief needs.
export function absorbAt(text, data) {
  const s = String(data ?? '');
  return text === BARE_TEXT && s.startsWith('@') ? s.slice(1) : s;
}
