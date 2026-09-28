// The runs list with its new-plan box (dashboard-plan-box DESIGN §2.1–§2.7, §3.2; T04). One mounted pi-tui
// component: the list block (buildListFrame, windowed to the rows the box leaves) above the one-shot note,
// the box's head line, the box itself (pi-tui's Editor, the one the brief box and the conversation view type
// into) and the hint line.
//
// It is a mounted component rather than a painted frame because the box needs a cursor, the focus and
// pi-tui's asynchronous autocomplete, which TuiAltScreen gives only to a mounted component (§3.2); the
// conversation view is the precedent. buildListFrame stays the one place list rows are drawn.
//
// Every routing decision is core/planbox.mjs's (routeBoxKey, absorbAt, headLine): this file only carries it
// out. What a list key or a submit then does is the caller's (T05's runTui), through the callbacks.

import { homedir } from 'node:os';
import { Editor, getKeybindings, isKeyRelease, parseKey } from '@earendil-works/pi-tui';
import { BARE_TEXT, COMMANDS, absorbAt, completionContext, headLine, isBare, routeBoxKey } from '../core/planbox.mjs';
import { initialUi } from '../core/dashboard.mjs';
import { buildListFrame, listFooter } from './pir-tui.mjs';
import { editorTheme, paintLine } from './pir-view.mjs';

const span = (text, style = null) => ({ text, style });

// Enough of pi-tui's TUI for an Editor outside a live screen (tests), as brief-box.mjs has.
const STUB_HOST = { requestRender() {}, terminal: { rows: 24, columns: 80 } };

export const TYPED_HINT = '↵ start planning · shift+↵ new line · esc clear';
export const START_HINT = '↵ start the build · esc clear';
export const BARE_HINT_SUFFIX = ' · type @repo to plan or build';

// The head line's label (box-commands §2.5): `new plan` no longer fits a box that also builds.
export const HEAD_LABEL = 'new';

// A typed box whose command is `start` (§2.1): its hint is START_HINT (§2.5).
const START_TEXT = /^@[^\s/]+\/start(?:\s|$)/;

// At most five rows show in the pop-up at once (§2.4).
const POPUP_ROWS = 5;

// Bracketed paste: a terminal wraps a paste in these, so absorbAt must look inside them (§2.3: a paste
// starting with `@` into a bare `@` loses that `@`, as a typed one does).
const PASTE_START = '\x1b[200~';

// tildify(path) → the path with the home folder as `~`, the way the person would type it (§2.4, §2.5).
export function tildify(path, home = homedir()) {
  const p = String(path ?? '');
  if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length);
  return p;
}

// rootsLabel(roots) → `{roots}` in §2.5/§2.6's texts: the roots as the person would type them, joined.
export function rootsLabel(roots, home = homedir()) {
  if (Array.isArray(roots)) return roots.map((r) => tildify(r, home)).join(', ');
  return tildify(roots ?? '', home);
}

// The name token after the `@` (a repo folder name never holds a `/`, box-commands §2.1), the command token
// after it, and a word (the slug) around the cursor.
const NAME_TOKEN = /^@[^\s/]*/;
const COMMAND_TOKEN = /^@[^\s/]+\/\S*/;

// The one listed repo called exactly `name` (§2.4: exact, never a prefix), or null when none or two.
function repoNamed(repos, name) {
  const found = (repos ?? []).filter((r) => r.name === name);
  return found.length === 1 ? found[0] : null;
}

// boxCompletion({ currentRepos, plansOf, building, home }) → the Editor's autocomplete provider for the box's
// three contexts (box-commands DESIGN §2.2). Which context the cursor is in is core's completionContext; this
// only builds its rows and writes a pick. Nothing is suggested on a bare box (dashboard-plan-box §2.3) or off
// the first line.
//   repo    rows: repos whose name contains the typed part, case-insensitive  → pick writes `@name/`
//   command rows: COMMANDS starting with the typed letters                     → pick writes `@name/{cmd} `
//   slug    rows: the repo's buildable plans containing the typed part, by slug → pick writes the slug
// The `prefix` handed back is the whole text before the cursor, which starts with `@`: pi-tui makes an Enter
// pick fall through to submit when the prefix starts with `/` (editor.js, the select.confirm branch), and a
// slug query could.
export function boxCompletion({ currentRepos, plansOf = () => [], building = () => false, home = homedir() }) {
  const rowsFor = (ctx) => {
    if (ctx.kind === 'repo') {
      const q = ctx.query.toLowerCase();
      return currentRepos()
        .filter((r) => r.name.toLowerCase().includes(q))
        .map((r) => ({ value: r.name, label: '@' + r.name, description: tildify(r.path, home) }));
    }
    if (ctx.kind === 'command') {
      const q = ctx.query.toLowerCase();
      return COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({ value: c.name, label: c.name, description: c.description }));
    }
    const repo = repoNamed(currentRepos(), ctx.name);
    if (!repo) return [];
    const q = ctx.query.toLowerCase();
    return [...(plansOf(repo) ?? [])]
      .filter((p) => p.slug.toLowerCase().includes(q))
      .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .map((p) => ({
        value: p.slug,
        label: p.slug,
        description: `${p.done}/${p.total} done` + (building(repo, p.slug) ? ' · building' : ''),
      }));
  };

  return {
    triggerCharacters: ['@'],
    async getSuggestions(lines, cursorLine, cursorCol) {
      if (isBare(lines.join('\n')) || cursorLine !== 0) return null;
      const line = lines[0] ?? '';
      const ctx = completionContext(line, cursorCol);
      if (!ctx) return null;
      const items = rowsFor(ctx);
      return items.length ? { items, prefix: line.slice(0, cursorCol) } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item) {
      const line = lines[0] ?? '';
      const ctx = completionContext(line, cursorCol);
      const out = [...lines];
      if (ctx?.kind === 'repo') {
        // Keep whatever followed the name (`/plan brief` survives a changed repo); add `/` only if missing.
        const after = line.slice(NAME_TOKEN.exec(line)[0].length);
        out[0] = `@${item.value}` + (after.startsWith('/') ? after : '/' + after);
        return { lines: out, cursorLine: 0, cursorCol: item.value.length + 2 };
      }
      if (ctx?.kind === 'command') {
        const head = `@${ctx.name}/${item.value} `;
        out[0] = head + line.slice(COMMAND_TOKEN.exec(line)[0].length).replace(/^[ \t]+/, '');
        return { lines: out, cursorLine: 0, cursorCol: head.length };
      }
      if (ctx?.kind === 'slug') {
        // Replace the whole word the cursor is in, including any part of it after the cursor; no space after.
        const start = cursorCol - ctx.query.length;
        const end = cursorCol + (/^\S*/.exec(line.slice(cursorCol))?.[0].length ?? 0);
        out[0] = line.slice(0, start) + item.value + line.slice(end);
        return { lines: out, cursorLine: 0, cursorCol: start + item.value.length };
      }
      return { lines, cursorLine, cursorCol };
    },
  };
}

// createListView({ tui, colour, repos, roots, dashboard, ui, onSubmit, onListKey, onQuit, home }) → a pi-tui
// Component (render, handleInput, invalidate, focused) plus update, text and reset.
//   repos()         — the scanned repo list [{ name, path }], called when the box leaves bare and reused until
//                     it is bare again (§2.4), so a person only watching runs never pays for the scan.
//   roots           — the scan's roots (array of paths, or a ready label), for the head line's texts.
//   onSubmit(text)  — routeBoxKey said 'submit'; the caller parses and starts (T05).
//   onListKey(data) — routeBoxKey said 'list'; the caller runs the list's decodeKey/reducer path with it.
//   onQuit()        — 'quit'.
//   plansOf(repo)   — the repo's buildable plans [{ slug, done, total }] (T02's scanPlans), called the first time
//                     a repo's plans are needed and reused until the box is bare again (box-commands §2.3).
//   building(repo, slug) — true when a build of that slug in that repo is running now (the slug rows, §2.2).
//   home            — the folder written as `~` (the person's home; a test passes its own).
export function createListView({
  tui = STUB_HOST,
  colour = false,
  repos = () => [],
  roots = [],
  dashboard = { rows: [], counts: undefined },
  ui = initialUi(),
  onSubmit = () => {},
  onListKey = () => {},
  onQuit = () => {},
  plansOf = () => [],
  building = () => false,
  home = homedir(),
} = {}) {
  const editor = new Editor(tui, editorTheme(colour), { autocompleteMaxVisible: POPUP_ROWS });
  // A submit never reaches the Editor (routeBoxKey takes Enter first), but should one slip through, the
  // Editor must not clear the person's text on its own.
  editor.disableSubmit = true;
  editor.setText(BARE_TEXT);
  let state = { dashboard, ui, note: null };
  let cached = null;
  // The plan scan per repo path, kept for the typed stretch as the repo scan is (box-commands §2.3).
  let plans = new Map();
  let focused = false;

  const currentRepos = () => {
    if (cached === null) cached = [...(repos() ?? [])];
    return cached;
  };
  const cachedPlansOf = (repo) => {
    if (!plans.has(repo.path)) plans.set(repo.path, [...(plansOf(repo) ?? [])]);
    return plans.get(repo.path);
  };
  editor.setAutocompleteProvider(boxCompletion({ currentRepos, plansOf: cachedPlansOf, building, home }));

  // Back to bare drops both cached scans, so the next typed stretch scans again (§2.4).
  const settle = () => {
    if (isBare(editor.getText())) {
      cached = null;
      plans = new Map();
    }
  };

  function reset() {
    editor.setText(BARE_TEXT);
    state = { ...state, note: null };
    cached = null;
    plans = new Map();
  }

  // pi-tui 0.87.1 closes the pop-up on a pick and never reopens it, and triggers only on `@`, `#` and a leading
  // `/`, so neither `@skaut/` nor `@skaut/start ` opens one by itself (box-commands §3.3). This reopens it after
  // a typed character, a deletion or a repo or command pick, when the cursor is at the end of the first line and
  // the text is in one of the three contexts (§2.2). Not after Esc or a cursor move (the text did not change), and
  // not after a slug pick: that would reopen a one-row list of the slug just picked. tryTriggerAutocomplete is
  // private in pi-tui's types but a plain method at runtime; a test pins it.
  function reopen({ before, wasShowing, ctxBefore }) {
    const text = editor.getText();
    if (text === before || editor.isShowingAutocomplete()) return;
    // Showing before and not now, with the text changed: a Tab or Enter pick (a typed key keeps it showing
    // while pi-tui re-queries).
    if (wasShowing && ctxBefore?.kind === 'slug') return;
    const { line, col } = editor.getCursor();
    const first = editor.getLines()[0] ?? '';
    if (line !== 0 || col !== first.length) return;
    if (completionContext(first, col) === null) return;
    editor.tryTriggerAutocomplete();
  }

  function toBox(data) {
    const text = editor.getText();
    let d = data;
    if (d.startsWith(PASTE_START)) d = PASTE_START + absorbAt(text, d.slice(PASTE_START.length));
    else d = absorbAt(text, d);
    if (d === '' || d === PASTE_START) return;
    const before = editor.getText();
    const wasShowing = editor.isShowingAutocomplete();
    const { line, col } = editor.getCursor();
    const ctxBefore = line === 0 ? completionContext(editor.getLines()[0] ?? '', col) : null;
    editor.handleInput(d);
    reopen({ before, wasShowing, ctxBefore });
  }

  function handleInput(data) {
    const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
    if (s === '' || isKeyRelease(s)) return;
    const route = routeBoxKey({
      text: editor.getText(),
      key: parseKey(s) ?? null,
      completing: editor.isShowingAutocomplete(),
      newLine: getKeybindings().matches(s, 'tui.input.newLine'),
    });
    if (route === 'quit') return onQuit();
    if (route === 'list') return onListKey(s);
    if (route === 'submit') return onSubmit(editor.getText());
    if (route === 'reset') reset();
    else toBox(s);
    settle();
    tui.requestRender?.();
  }

  function render(width) {
    const w = Math.max(20, width | 0);
    const paint = (spans) => paintLine(spans, w, colour);
    const text = editor.getText();
    const bare = isBare(text);
    const label = rootsLabel(roots, home);

    const head = headLine(text, bare ? [] : currentRepos(), { roots: label, plansOf: cachedPlansOf });
    const noteText = state.note ?? state.ui?.note ?? null;
    const noteLine = noteText == null ? null : paint([span(noteText, state.note != null ? 'your-go' : 'dim')]);

    // A half-pressed chord shows its ⚠ line even over a typed brief (user, 2026-09-27, T06 drill): the chords
    // act on a typed box too (§2.3), and with the typing hint in its place the second press stopped a run
    // with nothing on screen having said so.
    let hint;
    if (!bare && !state.ui?.armed) hint = paint([span(START_TEXT.test(text) ? START_HINT : TYPED_HINT, 'hint')]);
    else {
      const footer = listFooter(state.ui, state.dashboard?.rows ?? []);
      // The suffix joins the plain key hint only, and only when it fits: an armed line is a warning, not a hint.
      const plain = footer.length === 1 && footer[0].style === 'hint';
      const fits = plain && [...(footer[0].text + BARE_HINT_SUFFIX)].length <= w;
      hint = paint(fits ? [span(footer[0].text + BARE_HINT_SUFFIX, 'hint')] : footer);
    }

    const box = editor.render(w);
    const termRows = tui.terminal?.rows || 24;
    const budget = Math.max(0, termRows - box.length - 2 - (noteLine ? 1 : 0));
    const list = buildListFrame(state.dashboard, state.ui ?? initialUi(), { columns: w, rows: budget }).map(paint);
    while (list.length < budget) list.push('');

    return [...list, ...(noteLine ? [noteLine] : []), paint([span(HEAD_LABEL, 'head'), span('  ' + head.text, head.style)]), ...box, hint];
  }

  return {
    render,
    handleInput,
    invalidate() {
      editor.invalidate();
    },
    get focused() {
      return focused;
    },
    set focused(v) {
      focused = !!v;
      editor.focused = focused;
    },
    // runTui calls this on every refresh and keypress. A key left out keeps its value; `note: null` clears it.
    update(next = {}) {
      state = {
        dashboard: 'dashboard' in next ? next.dashboard : state.dashboard,
        ui: 'ui' in next ? next.ui : state.ui,
        note: 'note' in next ? next.note : state.note,
      };
    },
    get text() {
      return editor.getText();
    },
    get completing() {
      return editor.isShowingAutocomplete();
    },
    // The cached plan scan, so the caller's submit (T04's parseBoxText) reads the same plans the pop-up listed.
    plansOf: cachedPlansOf,
    reset,
  };
}
