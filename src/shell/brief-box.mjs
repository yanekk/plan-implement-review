// The brief box (pir-plan-command DESIGN §2.13, prototype scene 1; T13): what bare `pir plan` opens. A
// full-screen pi-tui component — a title, one prompt line, the same pi-tui Editor the conversation view
// types into, and a hint line — so writing a brief feels like writing a prompt to Claude.
//
// Keys: enter sends the brief; shift+enter or ctrl+j adds a line (pi-tui's `tui.input.newLine`, handled by
// the Editor itself); esc cancels. An empty or whitespace-only brief sends nothing: enter is not even handed
// to the Editor then, because the Editor clears its text on submit and "nothing happens" should leave the
// box as the person left it. Ctrl+C cancels as esc does: in raw mode nothing else would let the person out,
// and everywhere else on pir's screen Ctrl+C leaves.
//
// The pre-flight (§2.2) is the caller's and runs before this opens, so a brief is never written only to be
// refused. The box creates nothing: its caller starts the run with what it sends.

import { Editor, getKeybindings, isKeyRelease, parseKey } from '@earendil-works/pi-tui';
import { editorTheme, paintLine } from './pir-view.mjs';
import { typeInto } from './paste.mjs';
import { createScreen } from './pir-tui.mjs';

const span = (text, style = null) => ({ text, style });

// Enough of pi-tui's TUI for an Editor outside a live screen (tests, a non-TTY).
const STUB_HOST = { requestRender() {}, terminal: { rows: 24, columns: 80 } };

export const BRIEF_PROMPT = 'What do you want to build? Write it the way you would brief a colleague.';
export const BRIEF_HINT = '↵ start planning · shift+↵ new line · esc cancel';

// createBriefBox({ repo, tui, colour, onSubmit, onCancel }) → a pi-tui Component (render, handleInput,
// invalidate, focused) plus a read-only `text` for the tests. onSubmit(brief) gets the trimmed text, newlines
// kept; it and onCancel() are each called at most once, and after either the box takes no more keys.
export function createBriefBox({ repo, tui = STUB_HOST, colour = true, onSubmit = () => {}, onCancel = () => {} }) {
  const editor = new Editor(tui, editorTheme(colour));
  let done = false;
  let focused = false;
  editor.onSubmit = (text) => {
    // Guarded again here for the Editor's own submit paths (a trailing `\` + enter).
    const brief = String(text ?? '').trim();
    if (done || brief === '') return;
    done = true;
    onSubmit(brief);
  };

  function handleInput(data) {
    if (done || isKeyRelease(data)) return;
    const key = parseKey(data);
    if (key === 'escape' || key === 'ctrl+c') {
      done = true;
      onCancel();
      return;
    }
    // A lone LF parses as enter too, but it is ctrl+j, the new-line key: only a real submit is held back.
    const kb = getKeybindings();
    if (kb.matches(data, 'tui.input.submit') && !kb.matches(data, 'tui.input.newLine') && editor.getText().trim() === '') return;
    typeInto(editor, data);
    tui.requestRender();
  }

  function render(width) {
    const w = Math.max(20, width | 0);
    const paint = (spans) => paintLine(spans, w, colour);
    return [
      paint([span('pir plan', 'head'), span(`  new plan in ${repo ?? ''}`, 'dim')]),
      '',
      paint([span(BRIEF_PROMPT, 'dim')]),
      ...editor.render(w),
      paint([span(BRIEF_HINT, 'hint')]),
    ];
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
    get text() {
      return editor.getText();
    },
  };
}

// openBriefBox({ repo, tui, onSubmit, onCancel, stdin, stdout }) → Promise<void>
//   tui — a screen shaped like pir-tui's createScreen (mount, renderNow, listen?, close, host, colour); made
//         from stdout when absent. It is closed before either callback runs, so what comes next — the
//         planner's conversation on a screen of its own, or a refusal on stderr — starts on a clean terminal.
// The promise settles once the callback's own promise does (onSubmit usually opens the planner's view).
export function openBriefBox({ repo, tui, onSubmit = () => {}, onCancel = () => {}, stdin = process.stdin, stdout = process.stdout } = {}) {
  const screen = tui ?? createScreen({ stream: stdout });
  const ownInput = typeof screen.listen !== 'function';
  return new Promise((resolve, reject) => {
    let settled = false;
    const onData = (data) => {
      try {
        box.handleInput(Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? ''));
        if (!settled) screen.renderNow?.();
      } catch (err) {
        fail(err);
      }
    };
    const release = () => {
      if (ownInput) {
        stdin.off?.('data', onData);
        if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
        stdin.pause?.();
      }
      screen.close();
    };
    const end = (fn) => {
      if (settled) return;
      settled = true;
      release();
      Promise.resolve()
        .then(fn)
        .then(() => resolve(), reject);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      release();
      reject(err);
    };
    const box = createBriefBox({
      repo,
      tui: screen.host ?? STUB_HOST,
      colour: screen.colour ?? false,
      onSubmit: (brief) => end(() => onSubmit(brief)),
      onCancel: () => end(() => onCancel()),
    });
    try {
      screen.mount?.(box);
      screen.renderNow?.();
      if (ownInput) {
        if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
        stdin.resume?.();
        stdin.on('data', onData);
      } else {
        screen.listen(onData, fail);
      }
    } catch (err) {
      fail(err);
    }
  });
}
