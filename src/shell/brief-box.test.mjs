// The brief box (pir-plan-command §2.13, T13): the component alone, keys in, callbacks out, no terminal.
// The box on a real terminal, reached through `pir plan`, is plan-rig-brief-box.test.mjs's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createBriefBox, openBriefBox, BRIEF_PROMPT, BRIEF_HINT } from './brief-box.mjs';

const ENTER = '\r';
const ESC = '\x1b';
const CTRL_J = '\n';

function box() {
  const sent = [];
  let cancelled = 0;
  const b = createBriefBox({ repo: 'shop', colour: false, onSubmit: (t) => sent.push(t), onCancel: () => (cancelled += 1) });
  b.focused = true;
  const type = (s) => {
    for (const ch of s) b.handleInput(ch);
  };
  return { b, sent, type, cancelled: () => cancelled };
}

test('the box paints its title with the repo, the prompt line, an editor and the hint', () => {
  const { b } = box();
  const lines = b.render(80);
  assert.match(lines[0], /^pir plan {2}new plan in shop/);
  assert.equal(lines[2], BRIEF_PROMPT);
  assert.equal(lines.at(-1), BRIEF_HINT);
  assert.ok(lines.length >= 5, 'an editor between the prompt and the hint');
  for (const l of b.render(20)) assert.ok([...l.replace(/\x1b\[[0-9;]*m|\x1b_[^\x07]*\x07/g, '')].length <= 20, 'nothing wider than the terminal');
});

test('enter on an empty box sends nothing', () => {
  const { b, sent, cancelled } = box();
  b.handleInput(ENTER);
  assert.deepEqual(sent, []);
  assert.equal(cancelled(), 0);
});

test('enter on a whitespace-only box sends nothing and leaves the box as it was', () => {
  const { b, sent, type } = box();
  type('   ');
  b.handleInput(CTRL_J);
  type('  ');
  b.handleInput(ENTER);
  assert.deepEqual(sent, []);
  assert.equal(b.text, '   \n  ');
});

test('a multi-line brief is sent trimmed, with its newlines, once', () => {
  const { b, sent, type } = box();
  type('  Export orders as CSV.');
  b.handleInput(CTRL_J); // ctrl+j, pi-tui's tui.input.newLine
  type('Filters apply.');
  b.handleInput('\x1b[13;2u'); // shift+enter as a Kitty terminal sends it
  type('Big shops too.  ');
  b.handleInput(ENTER);
  assert.deepEqual(sent, ['Export orders as CSV.\nFilters apply.\nBig shops too.']);
  b.handleInput(ENTER);
  type('more');
  b.handleInput(ENTER);
  assert.equal(sent.length, 1, 'the box takes no keys after it sent');
});

test('esc cancels, and nothing is sent', () => {
  const { b, sent, type, cancelled } = box();
  type('half a brief');
  b.handleInput(ESC);
  assert.equal(cancelled(), 1);
  assert.deepEqual(sent, []);
  b.handleInput(ENTER);
  assert.deepEqual(sent, [], 'nothing after the cancel');
});

test('ctrl+c cancels as esc does', () => {
  const { b, cancelled } = box();
  b.handleInput('\x03');
  assert.equal(cancelled(), 1);
});

// A screen shaped like createScreen's, recording what happens to it.
function fakeScreen() {
  const events = [];
  let onInput = null;
  return {
    events,
    colour: false,
    host: { requestRender() {}, terminal: { rows: 24, columns: 80 } },
    mount: (c) => events.push(c ? 'mount' : 'unmount'),
    renderNow: () => events.push('render'),
    listen: (fn) => {
      onInput = fn;
    },
    close: () => events.push('close'),
    press: (s) => onInput(s),
  };
}

test('openBriefBox closes its screen before calling onSubmit, and settles when onSubmit does', async () => {
  const screen = fakeScreen();
  const seen = [];
  let release;
  const p = openBriefBox({
    repo: 'shop',
    tui: screen,
    onSubmit: (brief) => {
      seen.push([brief, screen.events.includes('close')]);
      return new Promise((r) => (release = r));
    },
    onCancel: () => seen.push('cancel'),
  });
  for (const ch of 'hi') screen.press(ch);
  screen.press(ENTER);
  let settled = false;
  p.then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [['hi', true]]);
  assert.equal(settled, false, 'still waiting on the view onSubmit opened');
  release();
  await p;
});

test('openBriefBox on esc closes the screen and calls onCancel only', async () => {
  const screen = fakeScreen();
  const seen = [];
  const p = openBriefBox({ repo: 'shop', tui: screen, onSubmit: () => seen.push('submit'), onCancel: () => seen.push('cancel') });
  screen.press(ESC);
  await p;
  assert.deepEqual(seen, ['cancel']);
  assert.ok(screen.events.includes('close'));
});

test('openBriefBox without a listening screen reads stdin itself, and lets it go after', async () => {
  const stdin = new EventEmitter();
  const raw = [];
  stdin.setRawMode = (v) => raw.push(v);
  stdin.resume = () => {};
  stdin.pause = () => raw.push('paused');
  const screen = { ...fakeScreen(), listen: undefined };
  const sent = [];
  const p = openBriefBox({ repo: 'shop', tui: screen, stdin, onSubmit: (b) => sent.push(b) });
  stdin.emit('data', Buffer.from('x'));
  stdin.emit('data', Buffer.from(ENTER));
  await p;
  assert.deepEqual(sent, ['x']);
  assert.deepEqual(raw, [true, false, 'paused']);
  assert.equal(stdin.listenerCount('data'), 0);
});
