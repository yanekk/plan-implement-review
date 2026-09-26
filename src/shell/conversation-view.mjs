// The conversation view: the third view of the `pir` screen, one worker's conversation (plans/live-workers
// DESIGN §2.5–§2.9, §2.11, §2.14; T13). It reads the worker's log (log-follow.mjs: the last 256 KB, then
// every append), paints core/conversation.mjs's lines, and turns the person's keys into inbox drops
// (person-inbox.mjs's dropPersonInput). Every rule about what a line says is core's; this file decides
// only layout and which key does what, after §2.11's key table.
//
// Layout, top to bottom, exactly the terminal's rows: a header, the scrollback (following the end until the
// person scrolls up), the pinned prompt (a pending permission or question set), a one-shot status line, the
// typing box (pi-tui's Editor, with slash-command autocomplete) and the key hint. A read-only view (the
// worker is not live, or its log says it exited) has no box and takes only ←, scrolling and Tab.

import { Editor, CombinedAutocompleteProvider, isKeyRelease, parseKey } from '@earendil-works/pi-tui';
import { buildConversation, gateReducer, pickerReducer, promptLines } from '../core/conversation.mjs';
import { readEntry, workerActivity } from '../core/stream.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { followLog } from './log-follow.mjs';
import { paintLine, SGR, RESET } from './pir-view.mjs';

const span = (text, style = null) => ({ text, style });

// Enough of pi-tui's TUI for an Editor outside a live screen (tests, a non-TTY): it asks for a repaint
// and reads the terminal's rows to size itself.
const STUB_HOST = { requestRender() {}, terminal: { rows: 24, columns: 80 } };

// slashCommandsOf(activity) → the command names the box offers: the worker's last `init.slash_commands`
// minus its `init.terminal_slash_commands` (`/doctor`, `/color`, `/focus`, `/reload-plugins`), which do
// not work over the line (DESIGN §2.9).
export function slashCommandsOf(entries) {
  let offered = [];
  let terminal = [];
  for (const entry of entries) {
    for (const ev of readEntry(entry)) {
      if (ev.kind !== 'init') continue;
      offered = ev.slashCommands;
      terminal = ev.terminalSlashCommands;
    }
  }
  const drop = new Set(terminal);
  return offered.filter((name) => !drop.has(name));
}

// slashProvider(names) → the box's AutocompleteProvider: pi-tui's own slash-command completion over
// `names`, and nothing else. Its `@file` and forced path completion would list files from pir's own
// directory, not the worker's worktree, so those return no suggestions.
export function slashProvider(names) {
  const inner = new CombinedAutocompleteProvider(names.map((name) => ({ name })), process.cwd());
  return {
    triggerCharacters: ['/'],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const before = (lines[cursorLine] ?? '').slice(0, cursorCol);
      if (cursorLine !== 0 || !before.startsWith('/') || before.includes(' ') || options?.force) return null;
      return inner.getSuggestions(lines, cursorLine, cursorCol, { ...options, force: false });
    },
    applyCompletion: (...args) => inner.applyCompletion(...args),
    shouldTriggerFileCompletion: () => false,
  };
}

// Parse one log line; one that does not parse stays a string, which core reads as `raw` (§2.3).
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
}

// Why the view says nothing went: dropPersonInput's `not-running`, or its own words.
function refusal(reason, what) {
  if (reason === 'not-running') return `the run is not running — ${what} was not sent`;
  return `${what} was not sent: ${reason}`;
}

// createConversationView({ run, worker, follow, drop, alive, onBack, tui, colour, followOptions })
//   → a pi-tui Component (render, handleInput, invalidate, focused) plus dispose() and a read-only `state`.
//   run    — { slug, controlDir }: the open run; drops land in its controlDir's inbox.
//   worker — dashboard's openWorker: { taskId, workerId, logPath, live }.
//   follow — followLog's signature; drop — dropPersonInput's; alive() — the open run is `running` (§2.5).
//   onBack — called on ← with an empty box: the caller steps back to the run's live view.
//   tui    — the pi-tui screen (requestRender, terminal.rows); a stub when there is none.
export function createConversationView({
  run,
  worker,
  follow = followLog,
  drop = dropPersonInput,
  alive = () => false,
  onBack = () => {},
  tui = STUB_HOST,
  colour = true,
  followOptions = {},
}) {
  const taskId = worker?.taskId ?? 'worker';
  const entries = [];
  let built = null; // { key, conv, activity, ended } — rebuilt when the log, the width or the detail changes
  let version = 0;
  let full = false;
  let scrollBack = 0; // lines scrolled up from the end; 0 follows new lines
  let lastPage = 10;
  let lastHeight = null; // the scrollback's height at the last paint
  let prompt = null; // the pinned request's gate or picker, as the person has driven it
  const answered = new Set(); // requestIds this view dropped an answer for, until the log shows the reply
  let status = null; // a one-shot { text, style } line
  let focused = false;

  const paint = (spans, width) => paintLine(spans, width, colour);
  const style = (s, text) => (colour && SGR[s] ? `${SGR[s]}${text}${RESET}` : text);

  const editor = worker?.live
    ? new Editor(tui, {
        borderColor: (s) => style('dim', s),
        selectList: {
          selectedPrefix: (s) => style('prompt', s),
          selectedText: (s) => style('prompt', s),
          description: (s) => style('dim', s),
          scrollInfo: (s) => style('dim', s),
          noMatch: (s) => style('dim', s),
        },
      })
    : null;
  let offered = null; // the slash commands the provider was built from
  if (editor) editor.onSubmit = (text) => submit(text);

  const follower = worker?.logPath
    ? follow(worker.logPath, {
        ...followOptions,
        onEntries(lines) {
          for (const l of lines) entries.push(parseLine(l));
          version += 1;
          tui.requestRender();
        },
      })
    : null;

  function model(width) {
    const key = `${version}|${width}|${full}`;
    if (built?.key === key) return built;
    const activity = workerActivity(entries);
    const ended = entries.some((e) => e?.dir === 'note' && (e.kind === 'exited' || e.kind === 'sdk-error'));
    const readOnly = !editor || ended;
    const conv = buildConversation(entries, { full, width, taskId, readOnly });
    // Scrolled up, new lines at the end must not move what the person is reading: the offset from the end
    // grows by what arrived. Following the end (0), it stays 0.
    if (scrollBack > 0 && built && built.width === width && built.full === full) scrollBack += Math.max(0, conv.lines.length - built.conv.lines.length);
    built = { key, conv, activity, ended, readOnly, width, full };
    // Keep the person's half-driven prompt while the same request is pinned; a new one starts fresh.
    const pinned = conv.pinned;
    if (!pinned) prompt = null;
    else if (pinned.requestId !== prompt?.requestId) prompt = pinned;
    for (const id of [...answered]) if (!activity.pending.some((r) => r.requestId === id)) answered.delete(id);
    if (editor && !readOnly) {
      const names = slashCommandsOf(entries);
      if (names.join('\n') !== offered) {
        offered = names.join('\n');
        editor.setAutocompleteProvider(slashProvider(names));
      }
    }
    return built;
  }

  let lastWidth = 80;
  const livePrompt = () => (prompt && !answered.has(prompt.requestId) ? prompt : null);

  function send(input, what) {
    const r = drop(run.controlDir, { to: worker.workerId, ...input }, { coordinatorAlive: alive });
    if (!r?.ok) status = { text: refusal(r?.reason ?? 'unknown', what), style: 'bad' };
    return !!r?.ok;
  }

  function interrupt() {
    if (send({ kind: 'interrupt' }, 'the interrupt')) status = { text: 'interrupt sent', style: 'dim' };
  }

  // The box's Enter. Typed text refuses a pending permission with the text (§2.6), answers the question
  // on screen of a pending question set (user 2026-09-26, T18 drill: it replaced declining the set), or is
  // a message. A drop that fails puts the text back in the box and the picker back where it was.
  function submit(text) {
    if (!text) return;
    const p = livePrompt();
    if (p?.kind === 'questions') {
      const r = pickerReducer(p, { type: 'typed', text });
      prompt = r.picker;
      if (!r.send) return;
      if (send({ kind: 'answers', requestId: p.requestId, answers: r.send.answers }, 'your answers')) answered.add(p.requestId);
      else {
        prompt = p;
        editor.setText(text);
      }
      return;
    }
    let ok;
    if (p?.kind === 'permission') ok = send({ kind: 'permission', requestId: p.requestId, decision: 'deny', text }, 'your reply');
    else ok = send({ kind: 'message', text }, 'your message');
    if (!ok) {
      editor.setText(text);
      return;
    }
    if (p) answered.add(p.requestId);
    editor.addToHistory(text);
  }

  function scroll(by) {
    scrollBack = Math.max(0, scrollBack + by);
  }

  // A key while the box is empty and a request is pinned: Enter/n/a for a permission, ↑↓ space Enter for a
  // question set. true when the prompt took the key.
  function promptKey(key) {
    const p = livePrompt();
    if (!p) return false;
    if (p.kind === 'permission') {
      const { gate, send: decision } = gateReducer(p, key);
      prompt = gate;
      if (!decision) return key === 'enter' || key === 'n' || key === 'a';
      if (send({ kind: 'permission', requestId: p.requestId, decision }, 'your answer')) answered.add(p.requestId);
      return true;
    }
    const event = { up: 'up', down: 'down', space: 'toggle', enter: 'next' }[key];
    if (!event) return false;
    const r = pickerReducer(p, { type: event });
    prompt = r.picker;
    if (r.send && send({ kind: 'answers', requestId: p.requestId, answers: r.send.answers }, 'your answers')) answered.add(p.requestId);
    return true;
  }

  function handleInput(data) {
    if (isKeyRelease(data)) return;
    const key = parseKey(data);
    status = null;
    const m = model(lastWidth); // entries may have arrived since the last paint: sync the pinned prompt first
    if (key === 'pageUp' || key === 'pageDown') {
      scroll(key === 'pageUp' ? lastPage : -lastPage);
    } else if (m.readOnly) {
      if (key === 'left') return onBack();
      if (key === 'up' || key === 'down') scroll(key === 'up' ? 1 : -1);
      else if (key === 'tab') full = !full;
    } else {
      const empty = editor.getText() === '';
      const completing = editor.isShowingAutocomplete();
      if (key === 'escape' && !completing) interrupt();
      else if (key === 'ctrl+c') {
        if (empty) interrupt();
        else editor.setText('');
      } else if (key === 'tab' && !completing) full = !full;
      else if (key === 'left' && empty) return onBack();
      else if (empty && !completing && promptKey(key)) {
        /* the pinned prompt took it */
      } else {
        // Any other key disarms an armed permission gate (§2.6) and goes to the box.
        const p = livePrompt();
        if (p?.kind === 'permission' && p.armed) prompt = gateReducer(p, 'other').gate;
        editor.handleInput(data);
      }
    }
    tui.requestRender();
  }

  // Every state's hint fits one line at 80 columns (user 2026-09-26, T20): `Tab detail` names the key both
  // ways, and with a request pending the scroll key is only `PgUp/PgDn`.
  // Scrolled up, `↓ N more below · ` leads the hint, so the live hints shed a phrase to keep it within 80
  // (user 2026-09-26, T20 review): the pending request is pinned in view, and the person has just used PgUp.
  function hint(m, scrolled) {
    if (m.readOnly) return `← back · PgUp/PgDn scroll · Tab detail · ${m.ended ? 'exited' : 'finished'}, read only`;
    // ← goes back only with an empty box, and Enter/n/a answer only then.
    if (livePrompt()) return `${scrolled ? '' : 'answer above or type a reply · '}esc interrupt · ← back · Tab detail · PgUp/PgDn`;
    return `↵ send · esc interrupt · ← back · Tab detail · PgUp/PgDn${scrolled ? '' : ' scroll'}`;
  }

  function render(width) {
    const w = Math.max(20, width | 0);
    lastWidth = w;
    const rows = Math.max(8, tui.terminal?.rows || 24);
    const m = model(w);
    const out = [];

    const where = m.readOnly ? (m.ended ? 'exited, read only' : 'finished, read only') : 'live';
    out.push(paint([span(`${taskId}`, 'head'), span(`  worker ${String(worker?.workerId ?? '?').slice(0, 8)} · ${where}`, 'dim'), span(`  · ${run?.slug ?? ''}`, 'dim')], w));
    out.push(paint([span('─'.repeat(w), 'dim')], w));

    const bottom = [];
    const p = m.readOnly ? null : prompt;
    if (p && answered.has(p.requestId)) bottom.push(paint([span('⚑ answer sent — waiting for pir to deliver it', 'prompt')], w));
    else if (p) for (const l of promptLines(p, { width: w, taskId })) bottom.push(paint(l, w));
    else if (!m.readOnly) {
      // A worker waiting on background work is not idle (user 2026-09-26, T18 drill): say how much is running.
      const bg = m.conv.background ? `${m.conv.background} running in the background` : '';
      if (m.activity.state === 'busy') bottom.push(paint([span('● working…', 'active'), ...(bg ? [span(` · ${bg}`, 'dim')] : [])], w));
      else if (bg) bottom.push(paint([span(`◌ ${bg}`, 'dim')], w));
    }
    if (status) bottom.push(paint([span(status.text, status.style)], w));
    if (!m.readOnly) bottom.push(...editor.render(w));

    const height = Math.max(1, rows - out.length - bottom.length - 1); // the last 1 is the hint line
    // Scrolled up, the scrollback losing rows to a prompt or `● working…` below it (or getting them back)
    // must not move what the person is reading: keep the top line fixed by moving the offset from the end.
    if (scrollBack > 0 && lastHeight !== null) scrollBack = Math.max(0, scrollBack + lastHeight - height);
    lastHeight = height;
    lastPage = Math.max(1, height - 1);
    const lines = worker?.logPath ? m.conv.lines : [[span('  no conversation log was recorded for this worker', 'dim')]];
    scrollBack = Math.min(scrollBack, Math.max(0, lines.length - height));
    const end = lines.length - scrollBack;
    const shown = lines.slice(Math.max(0, end - height), end).map((l) => paint(l, w));
    while (shown.length < height) shown.push('');
    // Painted after the offset settled, so the count is the one this frame shows (T20 review).
    const more = scrollBack > 0 ? `↓ ${scrollBack} more below · ` : '';
    out.push(...shown, ...bottom, paint([span(more + hint(m, scrollBack > 0), 'hint')], w));
    return out.slice(0, rows);
  }

  return {
    render,
    handleInput,
    invalidate() {
      built = null;
      editor?.invalidate();
    },
    get focused() {
      return focused;
    },
    set focused(v) {
      focused = !!v;
      if (editor) editor.focused = focused;
    },
    dispose() {
      follower?.stop();
    },
    // For the tests: what the view holds right now.
    get state() {
      return { text: editor?.getText() ?? null, prompt, status, full, scrollBack, entries: entries.length, readOnly: model(lastWidth).readOnly };
    },
  };
}
