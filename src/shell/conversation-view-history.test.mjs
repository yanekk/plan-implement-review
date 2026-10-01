// The view opens on the whole conversation, not a 256 KB slice of it (single-run fix-empty-session-view).
// pir/single-e809's builder started four helpers and ended its turn; 490 KB of helper frames later the view
// opened blank. fixtures/single-e809-head.ndjson is that log's head, trimmed (long strings cut, noise keys
// and thinking/rate-limit frames dropped): the parent speaks, starts four helpers, ends its turn. Each test
// appends helper frames shaped like the real ones until the parent's last own frame is far behind the cut.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { carryHistory, carryPending, createConversationView } from './conversation-view.mjs';
import { buildConversation } from '../core/conversation.mjs';
import { workerActivity } from '../core/stream.mjs';

const TAIL = 262144; // followLog's default
const HEAD = readFileSync(new URL('./fixtures/single-e809-head.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean);
const LAST_WORDS = "Four helpers are working on the failing tests in parallel; I'll pick up again when they report.";
const HELPERS = HEAD.map((l) => JSON.parse(l).event)
  .filter((e) => e?.subtype === 'task_started' && e.task_type === 'local_agent')
  .map((e) => ({ id: e.task_id, call: e.tool_use_id, description: e.description }));

let T = 1790864750000;
const line = (event) => JSON.stringify({ t: T++, dir: 'in', event });
// One helper step as the CLI logs it: progress, the helper's tool use, its ~2 KB result.
const round = (h, n) => [
  line({ type: 'system', subtype: 'task_progress', task_id: h.id, tool_use_id: h.call, description: `Reading file ${n}`, usage: { total_tokens: 1000 * n, tool_uses: n, duration_ms: 1000 * n }, last_tool_name: 'Read' }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${h.id}_${n}`, name: 'Read', input: { file_path: `src/f${n}.mjs` } }] }, parent_tool_use_id: h.call }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${h.id}_${n}`, content: `helper inner output ${n} ${'x'.repeat(2000)}` }] }, parent_tool_use_id: h.call }),
];
// Helper frames until they alone fill more than the tail: rounds across `who`, in turn.
function padding(who, bytes = TAIL + 64 * 1024) {
  const out = [];
  let size = 0;
  for (let n = 1; size < bytes; n++) {
    for (const h of who) {
      for (const l of round(h, n)) {
        out.push(l);
        size += l.length + 1;
      }
    }
  }
  return out;
}
const finished = (h) => [
  line({ type: 'system', subtype: 'task_updated', task_id: h.id, patch: { status: 'completed', end_time: T } }),
  line({ type: 'system', subtype: 'task_notification', task_id: h.id, tool_use_id: h.call, status: 'completed', summary: h.description }),
];

function writeLog(lines) {
  const p = join(mkdtempSync(join(tmpdir(), 'pir-history-')), 'build-1.ndjson');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
function openView(logPath, { rows = 40, cols = 110 } = {}) {
  const v = createConversationView({
    run: { slug: 'single-e809', controlDir: '/nowhere' },
    worker: { taskId: 'build', workerId: 'w-1', logPath, live: true },
    tui: { requestRender() {}, terminal: { rows } },
    colour: false,
    followOptions: { watch: null, pollMs: 60_000 },
  });
  const text = v.render(cols).map((l) => stripTerminalSequences(l)).join('\n');
  v.dispose();
  return text;
}
// The skipped head and the tail exactly as followLog cuts a log of these lines.
function cut(lines) {
  // The tail is the longest run of whole lines at the end that fits in TAIL bytes (readTailBytes).
  let i = lines.length;
  for (let size = 0; i > 0 && size + Buffer.byteLength(lines[i - 1]) + 1 <= TAIL; i--) size += Buffer.byteLength(lines[i - 1]) + 1;
  return { skipped: lines.slice(0, i), tail: lines.slice(i) };
}

test('fixture: the parent ends its turn with four helpers running, and the padding pushes it all behind the cut', () => {
  assert.equal(HELPERS.length, 4);
  const lines = [...HEAD, ...padding(HELPERS)];
  const { tail } = cut(lines);
  assert.ok(tail.every((l) => JSON.parse(l).event?.parent_tool_use_id || JSON.parse(l).event?.subtype === 'task_progress'), 'the tail is nothing but helper frames and progress');
});

test('a view opened on a log whose tail is all helper frames shows the parent, every helper line and the running count', () => {
  const p = writeLog([...HEAD, ...padding(HELPERS)]);
  assert.ok(statSync(p).size > TAIL * 1.25);
  const text = openView(p);
  assert.match(text, /build ▸ Four helpers are working on the failing tests in parallel; I'll pick up again when they\s+report\./, "the parent's last text");
  for (const h of HELPERS) assert.match(text, new RegExp(`↳ helper · ${h.description.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} · `), `${h.description}'s line`);
  assert.match(text, /4 helpers running/);
  assert.doesNotMatch(text, /helper inner output/, "a helper's own frames stay out of the default view");
});

test('a helper that finished before the cut reads finished; the others still run', () => {
  const [a, b, ...rest] = HELPERS;
  const p = writeLog([...HEAD, ...padding([a]).slice(0, 30), ...finished(b), ...padding([a, ...rest])]);
  const text = openView(p);
  assert.match(text, new RegExp(`↳ helper finished · ${b.description.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  assert.match(text, new RegExp(`↳ helper · ${a.description.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} · `));
  assert.match(text, /3 helpers running/);
  assert.match(text, /Four helpers are working on the failing tests/);
});

test('the carried head plus the tail draws the same default conversation as the whole log', () => {
  const [a, b, ...rest] = HELPERS;
  const lines = [...HEAD, ...padding([a, b]).slice(0, 60), ...finished(b), ...padding([a, ...rest])];
  const { skipped, tail } = cut(lines);
  assert.ok(skipped.length > HEAD.length, 'the cut falls inside the padding');
  const carried = carryHistory(skipped, tail);
  assert.ok(carried.length < skipped.length / 2, 'most of the skipped helper frames are left behind');
  const draw = (entries) => buildConversation(entries, { width: 100, taskId: 'build' });
  const whole = draw(lines);
  const opened = draw([...carried, ...tail]);
  assert.deepEqual(opened.lines, whole.lines);
  assert.deepEqual(opened.pinned, whole.pinned);
  const act = (entries) => workerActivity(entries.map((l) => JSON.parse(l)));
  assert.deepEqual(act([...carried, ...tail]), act(lines));
});

test('carryHistory keeps what the folds read off helper frames and drops the rest', () => {
  const ev = (event) => JSON.stringify({ dir: 'in', event });
  const helperUse = (parent, id, name) => ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] }, parent_tool_use_id: parent });
  const nestedCall = helperUse('toolu_A', 'toolu_inner', 'Agent');
  const bgCall = helperUse('toolu_A', 'toolu_bg', 'Bash');
  const plainCall = helperUse('toolu_A', 'toolu_plain', 'Read');
  const innerFrame = ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_inner_x', content: 'x' }] }, parent_tool_use_id: 'toolu_inner' });
  const prog = (n, extra = {}) => ev({ type: 'system', subtype: 'task_progress', task_id: 'A', description: `step ${n}`, usage: { tool_uses: n, duration_ms: n }, ...extra });
  const p1 = prog(1);
  const p2 = prog(2);
  const p3 = ev({ type: 'system', subtype: 'task_progress', task_id: 'A', usage: { tool_uses: 3 } }); // no description, no duration
  const nestedStart = ev({ type: 'system', subtype: 'task_started', task_id: 'N', tool_use_id: 'toolu_inner', task_type: 'local_agent' });
  const bgStart = ev({ type: 'system', subtype: 'task_started', task_id: 'B', tool_use_id: 'toolu_bg', task_type: 'local_bash', is_backgrounded: true });
  const fgStart = ev({ type: 'system', subtype: 'task_started', task_id: 'F', tool_use_id: 'toolu_plain', task_type: 'local_bash', is_backgrounded: false });
  const parentSays = ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null });
  const answered = JSON.stringify({ dir: 'request', requestId: 'r0', toolName: 'Bash', input: {} });
  const reply = JSON.stringify({ dir: 'out', kind: 'reply', requestId: 'r0', result: { behavior: 'allow' } });
  const note = JSON.stringify({ dir: 'note', kind: 'remote-control' });
  const skipped = [parentSays, nestedCall, bgCall, plainCall, innerFrame, p1, p2, p3, bgStart, fgStart, answered, reply, note, 'not json'];
  assert.deepEqual(carryHistory(skipped, [nestedStart]), [parentSays, nestedCall, bgCall, p2, p3, bgStart, fgStart, answered, reply, note, 'not json']);
});

test('carryHistory brings back everything carryPending does', () => {
  const q = JSON.stringify({ dir: 'request', requestId: 'q9', toolName: 'AskUserQuestion', input: { questions: [] } });
  const said = JSON.stringify({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } });
  const interrupt = JSON.stringify({ dir: 'out', from: 'person', kind: 'interrupt' });
  for (const [skipped, tail] of [[[q, said], [said]], [[q], [interrupt]], [[q, said, 'not json'], []]]) {
    const carried = carryHistory(skipped, tail);
    for (const l of carryPending(skipped, tail)) assert.ok(carried.includes(l));
  }
});

test('a log under 256 KB opens exactly as the whole log draws', () => {
  const p = writeLog(HEAD);
  assert.ok(statSync(p).size < TAIL);
  const text = openView(p);
  assert.match(text, /Four helpers are working on the failing tests/);
  assert.match(text, /4 helpers running/);
  const whole = buildConversation(HEAD, { width: 110, taskId: 'build' }).lines.map((l) => l.map((s) => s.text).join('').trimEnd());
  const shown = text.split('\n').map((l) => l.trimEnd());
  // The conversation's last lines are on screen in order, above the status line and the box.
  const at = shown.findIndex((l) => l === whole.at(-2));
  assert.ok(at >= 0, 'the last conversation lines are on screen');
  assert.equal(shown[at + 1], whole.at(-1));
});

// Opening a long log reads the whole head once. The bound is loose on purpose: four `npm test` runs at once
// on a loaded machine must not trip it (prompts/fix-load-sensitive-tests.md); what it catches is a carry
// that went quadratic, which on this ~12 MB log takes minutes, not seconds.
test('opening a ~12 MB log stays fast', () => {
  const bytes = 12 * 1024 * 1024;
  const p = writeLog([...HEAD, ...padding(HELPERS, bytes)]);
  const started = process.hrtime.bigint();
  const text = openView(p);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.match(text, /4 helpers running/);
  assert.ok(ms < 20_000, `opened in ${Math.round(ms)} ms`);
});
