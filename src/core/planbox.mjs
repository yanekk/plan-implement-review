// planbox.mjs — the decisions of the runs list's new-plan box (dashboard-plan-box DESIGN §2.2–§2.6).
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

// The notes Enter leaves when it starts nothing — §2.5's table, verbatim. Exported so the shell's
// tests (T04, T05) assert on the same strings rather than retyping them.
export const NOTES = {
  noAt: () => 'start with @repo, then say what to plan',
  unknownRepo: (name, roots) => `no repo @${name} in ${roots} — pick one from the list`,
  ambiguousRepo: (name, paths) => `@${name} is in more than one folder: ${paths.join(', ')}`,
  emptyBrief: (name) => `say what to plan after @${name}`,
};

// §2.5's last row: startPlanRun refused or threw.
export function startFailedNote(name, reason) {
  return `Could not start planning in ${name}: ${reason}`;
}

// The `@name` token: an '@' at the very start, then a run of non-whitespace. '@' followed by
// whitespace or nothing has no name (§2.5 row 1), so `@ a brief` reads like a text with no '@'.
const NAME = /^@(\S+)/;

function nameOf(text) {
  const m = NAME.exec(String(text ?? ''));
  return m ? m[1] : null;
}

// Exact names only (§2.5, user 2026-09-26 reversing unique-prefix matching): `@ska` never means `skaut`.
function matching(repos, name) {
  return (repos ?? []).filter((r) => r.name === name);
}

// parseBoxText(text, repos, { roots }) → what Enter would do with this text (§2.5).
// The brief is everything after the name, trimmed at both ends; newlines inside it are kept.
// The checks run in §2.5's table order, so `@nope` alone is unknown-repo, not empty-brief.
export function parseBoxText(text, repos, { roots } = {}) {
  const s = String(text ?? '');
  const name = nameOf(s);
  if (name === null) return { ok: false, reason: 'no-at', note: NOTES.noAt() };
  const found = matching(repos, name);
  if (found.length === 0) return { ok: false, reason: 'unknown-repo', name, note: NOTES.unknownRepo(name, roots) };
  if (found.length > 1) {
    const paths = found.map((r) => r.path);
    return { ok: false, reason: 'ambiguous-repo', name, paths, note: NOTES.ambiguousRepo(name, paths) };
  }
  const brief = s.slice(1 + name.length).trim();
  if (brief === '') return { ok: false, reason: 'empty-brief', name, note: NOTES.emptyBrief(name) };
  return { ok: true, repo: found[0], brief };
}

// headLine(text, repos, { roots }) → the words after the head line's `new plan ` label, and their
// style (§2.6). Dim when the text is bare or names a listed repo; amber (`your-go`) when it names
// anything else, or has no name at all. A name in two roots still names a listed repo, so it reads
// `in {name}`; Enter's note is what explains the clash.
export function headLine(text, repos, { roots } = {}) {
  if (isBare(text)) return { text: 'start with @repo', style: 'dim' };
  const name = nameOf(text);
  if (name === null) return { text: 'start with @repo', style: 'your-go' };
  if (matching(repos, name).length > 0) return { text: `in ${name}`, style: 'dim' };
  return { text: `@${name} is not a repo in ${roots}`, style: 'your-go' };
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
// A newLine key is always the editor's, never a submit (§2.3: Shift+Enter, Ctrl+J). On a bare box
// the pop-up is ignored: §2.3 says none shows there, so a stale one must not swallow the list's keys.
// Once the box is not bare an open pop-up takes every key (§2.3's first row), chords included.
export function routeBoxKey({ text, key, completing = false, newLine = false } = {}) {
  if (newLine) return 'box';
  if (isBare(text)) {
    if (RESET_KEYS.has(key)) return 'quit';
    if (LIST_KEYS.has(key)) return 'list';
    return 'box';
  }
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
