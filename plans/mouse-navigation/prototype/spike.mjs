#!/usr/bin/env node
// THROWAWAY spike + mock for plans/mouse-navigation (planning session, 2026-09-28). Not product code.
//
// Question it answers: on this machine, in the person's own terminal, does pi-tui (the library `pir`
// paints with) deliver pointer-move events so a hovered row can be highlighted, alongside click, wheel and
// pi-tui's own drag-to-select-and-copy? Under tmux/screen/zellij pi-tui turns all-motion tracking off
// (tui-alt-screen.js: ENABLE_BUTTON_MOTION_MOUSE), so this spike re-enables it (`\x1b[?1003h`) after start
// to see whether hover then works there too. pi-tui's stop() writes `?1003l`, so the mode is cleaned up.
//
// Run from the repo root:  node plans/mouse-navigation/prototype/spike.mjs      (q or Esc quits)
//
// Mock behaviour (the agreed direction): a click on a row opens it; the hovered row is brighter text,
// distinct from the selected grey band; the wheel moves the selection; ← steps back (keyboard only);
// drag selects text and copies it on release. The status line counts the mouse events that arrived.

import { execFileSync } from 'node:child_process';
import { ProcessTerminal, TuiAltScreen, parseKey, visibleWidth } from '@earendil-works/pi-tui';

const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
const rgb = (hex, bgr = false) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[${bgr ? 48 : 38};2;${r};${g};${b}m`;
};
const C = truecolor
  ? { dim: rgb('#7f849c'), dimHover: rgb('#bac2de'), green: rgb('#a6e3a1'), red: rgb('#f38ba8'), blue: rgb('#89b4fa'), sel: rgb('#313244', true) }
  : { dim: '\x1b[2m', dimHover: '', green: '\x1b[32m', red: '\x1b[31m', blue: '\x1b[34m', sel: '\x1b[48;5;236m' };
const BOLD = '\x1b[1m';
const R = '\x1b[0m';

const RUNS = [
  ['screen-time', 'build', 'running', 'green', '▰▰▰▰▰▱▱▱ 5/8'],
  ['"invoice import"', 'plan', 'asking you', 'green', ''],
  ['auth-rewrite', 'build', 'crashed', 'red', '▰▰▱▱▱▱▱▱ 2/9'],
  ['mouse-navigation', 'plan', 'running', 'green', ''],
  ['dashboard-plan-box', 'build', 'finished', 'dim', '▰▰▰▰▰▰▰▰ 8/8'],
  ['live-workers', 'build', 'finished', 'dim', '▰▰▰▰▰▰▰▰ 20/20'],
  ['reliable-notifications', 'build', 'stopped', 'dim', '▰▰▰▱▱▱▱▱ 3/7'],
  ['detached-runs', 'build', 'finished', 'dim', '▰▰▰▰▰▰▰▰ 11/11'],
  ['dynamic-tasks', 'build', 'finished', 'dim', '▰▰▰▰▰▰▰▰ 6/6'],
  ['resume-dead-worker', 'build', 'finished', 'dim', '▰▰▰▰▰▰▰▰ 4/4'],
];
const TASKS = ['T00 spike: pointer events', 'T01 hit-map for list rows', 'T02 hover style', 'T03 wheel', 'T04 conversation scroll', 'T05 drill'];

const state = { view: 'list', sel: 0, taskSel: 0, open: null, hover: null, note: '', counts: { move: 0, click: 0, wheel: 0 }, tmuxForced: false };

// Each row is a list of [text, colourKey] spans.
function listLines() {
  const lines = [[[`pir — ${RUNS.length} runs`, 'bold']], [], [[pad('  RUN', 26) + pad('TYPE', 7) + pad('STATE', 13) + 'PROGRESS', 'dim']]];
  const rowAt = {};
  RUNS.forEach(([slug, type, st, col, prog], i) => {
    rowAt[lines.length] = i;
    lines.push({ i, spans: [['  ' + pad(slug, 24), null], [pad(type, 7), 'dim'], [pad(st, 13), col], [prog, col === 'dim' ? 'dim' : 'blue']] });
  });
  return { lines, rowAt, sel: state.sel };
}
function watchLines() {
  const lines = [[[`${RUNS[state.open][0]} — live view`, 'bold']], []];
  const rowAt = {};
  TASKS.forEach((t, i) => {
    rowAt[lines.length] = i;
    lines.push({ i, spans: [['  ' + t, i < 2 ? 'green' : null]] });
  });
  return { lines, rowAt, sel: state.taskSel };
}
function pad(s, n) {
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length);
}

function paint(spans, width, { selected = false, hovered = false } = {}) {
  let used = 0;
  let out = '';
  for (const [text, key] of spans) {
    let code = key === 'bold' ? BOLD : key ? C[key] ?? '' : '';
    if (hovered) code = key === 'dim' ? `${BOLD}${C.dimHover}` : `${BOLD}${code}`;
    if (selected && key === 'dim') code = ''; // dim on the grey band is brightened, as pir's paintSelected does
    out += `${selected ? C.sel : ''}${code}${text}${R}`;
    used += visibleWidth(text);
  }
  if (selected && used < width) out += `${C.sel}${' '.repeat(width - used)}${R}`;
  return out;
}

function frame() {
  return state.view === 'list' ? listLines() : watchLines();
}

const root = {
  render(width) {
    const { lines, sel } = frame();
    const out = lines.map((l) => (Array.isArray(l) ? paint(l, width) : paint(l.spans, width, { selected: l.i === sel, hovered: l.i === state.hover && l.i !== sel })));
    out.push('');
    if (state.note) out.push(paint([[state.note, 'green']], width));
    const { move, click, wheel } = state.counts;
    out.push(paint([[`mouse events seen — move ${move} · click ${click} · wheel ${wheel}${state.tmuxForced ? ' · tmux: hover forced on' : ''}`, 'dim']], width));
    out.push(paint([[state.view === 'list' ? 'click a run to open it · wheel moves · drag to copy · q quit' : 'click a task · wheel moves · ← back (keys only) · drag to copy · q quit', 'dim']], width));
    return out;
  },
  // Only move/click/wheel are handled. press/drag/release are left unhandled on purpose: that is what lets
  // pi-tui start its own text selection on a drag, and turn a press+release in place into a `click`.
  handleMouse(ev) {
    const { rowAt } = frame();
    const row = rowAt[ev.y];
    if (ev.type === 'move') {
      state.counts.move++;
      state.hover = row ?? null;
      return { handled: true, render: true };
    }
    if (ev.type === 'wheel') {
      state.counts.wheel++;
      const n = state.view === 'list' ? RUNS.length : TASKS.length;
      const d = Math.sign(ev.wheelDelta ?? 0);
      if (state.view === 'list') state.sel = Math.max(0, Math.min(n - 1, state.sel + d));
      else state.taskSel = Math.max(0, Math.min(n - 1, state.taskSel + d));
      return { handled: true, render: true };
    }
    if (ev.type === 'click' && ev.button === 'left') {
      state.counts.click++;
      if (row == null) return undefined;
      if (state.view === 'list') {
        state.sel = row;
        state.open = row;
        state.view = 'watch';
        state.taskSel = 0;
        state.hover = null;
        state.note = '';
      } else {
        state.taskSel = row;
        state.note = `(would open ${TASKS[row].split(' ')[0]}'s worker conversation)`;
      }
      return { handled: true, render: true };
    }
    return undefined;
  },
  invalidate() {},
};

// Copy with pbcopy on macOS so the clipboard is reached whatever the terminal allows for OSC 52.
async function copySelection(text) {
  try {
    if (process.platform === 'darwin') execFileSync('pbcopy', { input: text });
    else return false;
    state.note = `copied ${text.length} characters`;
    tui.requestRender();
    return true;
  } catch (e) {
    return String(e.message);
  }
}

const tui = new TuiAltScreen(new ProcessTerminal(), false, undefined, { mouse: true, copySelection });
tui.setLayoutRoot(root);
tui.addInputListener((data) => {
  const k = parseKey(data);
  if (k === 'q' || k === 'escape' || k === 'ctrl+c') {
    tui.stop();
    process.exit(0);
  }
  if (k === 'left' && state.view === 'watch') {
    state.view = 'list';
    state.note = '';
    state.hover = null;
  } else if (k === 'up' || k === 'down') {
    const d = k === 'up' ? -1 : 1;
    if (state.view === 'list') state.sel = Math.max(0, Math.min(RUNS.length - 1, state.sel + d));
    else state.taskSel = Math.max(0, Math.min(TASKS.length - 1, state.taskSel + d));
  }
  tui.requestRender();
  return { consume: true };
});
tui.start();
const term = (process.env.TERM ?? '').toLowerCase();
if (process.env.TMUX !== undefined || process.env.ZELLIJ !== undefined || process.env.STY !== undefined || term.startsWith('tmux') || term.startsWith('screen')) {
  process.stdout.write('\x1b[?1003h');
  state.tmuxForced = true;
}
tui.requestRender();
