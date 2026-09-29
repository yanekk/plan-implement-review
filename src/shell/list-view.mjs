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
import { BARE_TEXT, absorbAt, headLine, isBare, routeBoxKey } from '../core/planbox.mjs';
import { initialUi } from '../core/dashboard.mjs';
import { buildListFrame, listFooter } from './pir-tui.mjs';
import { editorTheme, paintLine } from './pir-view.mjs';

const span = (text, style = null) => ({ text, style });

// Enough of pi-tui's TUI for an Editor outside a live screen (tests), as brief-box.mjs has.
const STUB_HOST = { requestRender() {}, terminal: { rows: 24, columns: 80 } };

export const TYPED_HINT = '↵ start planning · shift+↵ new line · esc clear';
export const BARE_HINT_SUFFIX = ' · type to plan (@repo)';

// At most five repos show in the pop-up at once (§2.4).
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

// The `@name` token at the start of the first line, and where it ends.
const FIRST_TOKEN = /^@\S*/;

// repoCompletion(currentRepos) → the Editor's autocomplete provider (§2.4). It suggests only while the text
// is not bare (§2.3: no pop-up on a bare box) and the cursor sits in the first line's first token, which
// starts with `@`; the repos whose name contains what is typed after the `@`, case-insensitive. Picking one
// replaces the whole token with `@name ` (a space the brief starts after).
export function repoCompletion(currentRepos, home = homedir()) {
  return {
    triggerCharacters: ['@'],
    async getSuggestions(lines, cursorLine, cursorCol) {
      if (isBare(lines.join('\n')) || cursorLine !== 0) return null;
      const token = FIRST_TOKEN.exec(lines[0] ?? '');
      if (!token || cursorCol < 1 || cursorCol > token[0].length) return null;
      const prefix = lines[0].slice(0, cursorCol);
      const q = prefix.slice(1).toLowerCase();
      const items = currentRepos()
        .filter((r) => r.name.toLowerCase().includes(q))
        .map((r) => ({ value: r.name, label: '@' + r.name, description: tildify(r.path, home) }));
      return items.length ? { items, prefix } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item) {
      const line = lines[0] ?? '';
      const tokenEnd = (FIRST_TOKEN.exec(line)?.[0] ?? '').length;
      const rest = line.slice(tokenEnd).replace(/^[ \t]+/, '');
      const out = [...lines];
      out[0] = `@${item.value} ${rest}`;
      return { lines: out, cursorLine: 0, cursorCol: item.value.length + 2 };
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
//   onListMouse(ev, frame) — a mouse event outside the box (and a wheel or pointer move the box did not take),
//                     with the list block's last-rendered lines as `frame`, so hitAt reads the lines on screen
//                     (mouse-navigation §3.2). Its result is this component's result.
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
  onListMouse = () => undefined,
  home = homedir(),
} = {}) {
  const editor = new Editor(tui, editorTheme(colour), { autocompleteMaxVisible: POPUP_ROWS });
  // A submit never reaches the Editor (routeBoxKey takes Enter first), but should one slip through, the
  // Editor must not clear the person's text on its own.
  editor.disableSubmit = true;
  editor.setText(BARE_TEXT);
  let state = { dashboard, ui, note: null, hoverY: null };
  // What the last render drew, for the mouse: the list block's lines (unpainted, carrying their row hits;
  // the block starts at screen row 0) and the rows the box took, from its top border down.
  let lastList = [];
  let boxTop = -1;
  let boxRows = 0;
  let cached = null;
  let focused = false;

  const currentRepos = () => {
    if (cached === null) cached = [...(repos() ?? [])];
    return cached;
  };
  editor.setAutocompleteProvider(repoCompletion(currentRepos, home));

  // Back to bare drops the cached scan, so the next typed stretch scans again (§2.4).
  const settle = () => {
    if (isBare(editor.getText())) cached = null;
  };

  function reset() {
    editor.setText(BARE_TEXT);
    state = { ...state, note: null };
    cached = null;
  }

  function toBox(data) {
    const text = editor.getText();
    let d = data;
    if (d.startsWith(PASTE_START)) d = PASTE_START + absorbAt(text, d.slice(PASTE_START.length));
    else d = absorbAt(text, d);
    if (d === '' || d === PASTE_START) return;
    editor.handleInput(d);
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

    const head = headLine(text, bare ? [] : currentRepos(), { roots: label });
    const noteText = state.note ?? state.ui?.note ?? null;
    const noteLine = noteText == null ? null : paint([span(noteText, state.note != null ? 'your-go' : 'dim')]);

    // A half-pressed chord shows its ⚠ line even over a typed brief (user, 2026-09-27, T06 drill): the chords
    // act on a typed box too (§2.3), and with the typing hint in its place the second press stopped a run
    // with nothing on screen having said so.
    let hint;
    if (!bare && !state.ui?.armed) hint = paint([span(TYPED_HINT, 'hint')]);
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
    const block = buildListFrame(state.dashboard, state.ui ?? initialUi(), { columns: w, rows: budget });
    // Only a row a click would open lights up under the pointer (§2.2); the selected band wins (paintLine).
    const list = block.map((spans, y) => paintLine(spans, w, colour, { hovered: y === state.hoverY && Boolean(spans.hit) }));
    while (list.length < budget) list.push('');
    lastList = block;
    boxTop = list.length + (noteLine ? 1 : 0) + 1;
    boxRows = box.length;

    return [...list, ...(noteLine ? [noteLine] : []), paint([span('new plan', 'head'), span('  ' + head.text, head.style)]), ...box, hint];
  }

  // A click in the box moves the Editor's caret, and one on the @repo pop-up picks the entry: the Editor does
  // both itself, given the event in its own rows (§2.6). Everything else — the list's rows, and a wheel or a
  // pointer move the box does not take — is the caller's: the wheel moves the list wherever the pointer is
  // (§2.3), and a move over the box still clears the hovered list row.
  function handleMouse(ev) {
    if (!ev) return undefined;
    if (boxTop >= 0 && ev.y >= boxTop && ev.y < boxTop + boxRows) {
      const r = editor.handleMouse({ ...ev, y: ev.y - boxTop });
      if (r) {
        settle();
        return r;
      }
      if (ev.type !== 'wheel' && ev.type !== 'move') return undefined;
    }
    return onListMouse(ev, lastList);
  }

  return {
    render,
    handleInput,
    handleMouse,
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
        hoverY: 'hoverY' in next ? next.hoverY : state.hoverY,
      };
    },
    get text() {
      return editor.getText();
    },
    get completing() {
      return editor.isShowingAutocomplete();
    },
    reset,
  };
}
