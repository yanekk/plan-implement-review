import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_OUTPUT_CAP, LOG_OUTPUT_CAP, LEAD_RAN, LEAD_HANDED, LEAD_EDITED,
  parseBang, capForAgent, shellStatusLine, bangMessage, shellId,
} from './bang.mjs';
import { plainText } from './text.mjs';

// ---- parseBang ----

test('parseBang: a leading ! is command mode, the command trimmed', () => {
  assert.deepEqual(parseBang('!ls'), { command: 'ls' });
  assert.deepEqual(parseBang('! ls -la '), { command: 'ls -la' });
  assert.deepEqual(parseBang('!'), { command: '' });
  assert.deepEqual(parseBang('!   '), { command: '' });
});

test('parseBang: no leading ! is not command mode, a leading space included', () => {
  assert.equal(parseBang('ls'), null);
  assert.equal(parseBang(' !ls'), null);
  assert.equal(parseBang(''), null);
  assert.equal(parseBang('say !this'), null);
  assert.equal(parseBang(undefined), null);
  assert.equal(parseBang(42), null);
});

test('parseBang: a multi-line command is kept whole', () => {
  assert.deepEqual(parseBang('!echo a\necho b\n'), { command: 'echo a\necho b' });
  assert.deepEqual(parseBang('!for i in 1 2; do\n  echo $i\ndone'), { command: 'for i in 1 2; do\n  echo $i\ndone' });
});

// ---- plainText, reused, on a streamed command's output (DESIGN §2.2) ----

// What T03 does when a chunk boundary may split an escape or a `\r` line: hold the unfinished line back
// and clean each completed one.
function perLine(chunks) {
  let buf = '';
  let out = '';
  for (const c of chunks) {
    buf += c;
    const nl = buf.lastIndexOf('\n');
    if (nl >= 0) {
      out += plainText(buf.slice(0, nl + 1));
      buf = buf.slice(nl + 1);
    }
  }
  return out + plainText(buf);
}

const COLOUR = '\x1b[32mok\x1b[0m 3 passed\n';
const LINK = 'see \x1b]8;;https://example.com\x07the docs\x1b]8;;\x07 now\n';
const BAR = 'fetch  10%\rfetch  50%\rfetch 100%\ndone\n';
const CLEAN = 'ok 3 passed\nsee the docs now\nfetch 100%\ndone\n';

test('plainText per coalesced chunk: colour, OSC 8 links and \\r overwrites come out plain', () => {
  assert.equal(plainText(COLOUR), 'ok 3 passed\n');
  assert.equal(plainText(LINK), 'see the docs now\n');
  assert.equal(plainText(BAR), 'fetch 100%\ndone\n');
  // Chunks that end on line boundaries clean the same applied one at a time.
  assert.equal([COLOUR, LINK, BAR].map(plainText).join(''), CLEAN);
});

test('plainText per chunk breaks on a split escape or a split \\r line; per completed line it holds', () => {
  const whole = COLOUR + LINK + BAR;
  const splitEscape = [whole.slice(0, 3), whole.slice(3)]; // inside `\x1b[32m`
  const splitBar = [whole.indexOf('50%') + 3].map((i) => [whole.slice(0, i), whole.slice(i)])[0]; // between two `\r` segments
  assert.notEqual(splitEscape.map(plainText).join(''), CLEAN);
  assert.notEqual(splitBar.map(plainText).join(''), CLEAN);
  assert.equal(perLine(splitEscape), CLEAN);
  assert.equal(perLine(splitBar), CLEAN);
  // Every split point at once: one character per chunk.
  assert.equal(perLine([...whole]), CLEAN);
});

// ---- capForAgent ----

test('capForAgent: under and at the cap nothing is cut', () => {
  assert.deepEqual(capForAgent('hello', 10), { text: 'hello', cut: 0 });
  assert.deepEqual(capForAgent('0123456789', 10), { text: '0123456789', cut: 0 });
  assert.deepEqual(capForAgent('', 10), { text: '', cut: 0 });
  const atCap = 'x'.repeat(AGENT_OUTPUT_CAP);
  assert.deepEqual(capForAgent(atCap), { text: atCap, cut: 0 });
});

test('capForAgent: over the cap keeps the tail and reports how much was cut', () => {
  assert.deepEqual(capForAgent('0123456789abc', 10), { text: '3456789abc', cut: 3 });
  const big = 'a'.repeat(5) + 'b'.repeat(AGENT_OUTPUT_CAP);
  assert.deepEqual(capForAgent(big), { text: 'b'.repeat(AGENT_OUTPUT_CAP), cut: 5 });
});

test('capForAgent: counts by code point, never splitting an emoji', () => {
  // Four emoji are eight UTF-16 units but four characters: at a cap of four nothing is cut.
  assert.deepEqual(capForAgent('😀😀😀😀', 4), { text: '😀😀😀😀', cut: 0 });
  assert.deepEqual(capForAgent('a😀b😀', 3), { text: '😀b😀', cut: 1 });
});

test('the caps are Claude Code\'s 30 000 for the agent and 1 MB for the log', () => {
  assert.equal(AGENT_OUTPUT_CAP, 30000);
  assert.equal(LOG_OUTPUT_CAP, 1048576);
});

// ---- shellStatusLine ----

test('shellStatusLine: exit, signal and stop, each with its time', () => {
  assert.equal(shellStatusLine({ code: 0, signal: null, stopped: null, ms: 6000 }), 'exit 0 · 6s');
  assert.equal(shellStatusLine({ code: 1, signal: null, stopped: null, ms: 2000 }), 'exit 1 · 2s');
  assert.equal(shellStatusLine({ code: null, signal: 'SIGTERM', stopped: null, ms: 2000 }), 'killed by SIGTERM · 2s');
  // A stop arrives as SIGTERM, and is named as the person's.
  assert.equal(shellStatusLine({ code: null, signal: 'SIGTERM', stopped: 'person', ms: 72000 }), 'stopped by the person · 1m 12s');
});

test('shellStatusLine: durations through helperTime', () => {
  const at = (ms) => shellStatusLine({ code: 0, ms });
  assert.equal(at(400), 'exit 0 · 0s');
  assert.equal(at(6000), 'exit 0 · 6s');
  assert.equal(at(72000), 'exit 0 · 1m 12s');
  assert.equal(at(72 * 60 * 1000), 'exit 0 · 72m 0s');
  assert.equal(at(undefined), 'exit 0');
});

// ---- bangMessage ----

test('bangMessage matches DESIGN §2.3\'s example byte for byte', () => {
  const msg = bangMessage({
    command: 'gsutil ls gs://acme-staging/ledger', output: 'gs://acme-staging/ledger/2026-09.csv\n',
    code: 0, signal: null, stopped: null, ms: 6000,
  });
  assert.equal(msg, [
    '[pir] The person ran a command in your working folder:',
    '$ gsutil ls gs://acme-staging/ledger',
    'exit 0 · 6s',
    'gs://acme-staging/ledger/2026-09.csv',
  ].join('\n'));
});

test('bangMessage: a failure, empty output, a stop and a signal', () => {
  assert.equal(bangMessage({ command: 'false', output: 'nope\n', code: 1, ms: 2000 }),
    '[pir] The person ran a command in your working folder:\n$ false\nexit 1 · 2s\nnope');
  assert.equal(bangMessage({ command: 'true', output: '', code: 0, ms: 100 }),
    '[pir] The person ran a command in your working folder:\n$ true\nexit 0 · 0s\n(no output)');
  assert.equal(bangMessage({ command: 'true', output: '\n\n', code: 0, ms: 100 }).split('\n').at(-1), '(no output)');
  assert.equal(bangMessage({ command: 'tail -f x', output: 'line 1\nline 2\n', code: null, signal: 'SIGTERM', stopped: 'person', ms: 72000 }),
    '[pir] The person ran a command in your working folder:\n$ tail -f x\nstopped by the person · 1m 12s\nline 1\nline 2');
  assert.equal(bangMessage({ command: 'x', output: '', code: null, signal: 'SIGKILL', ms: 1000 }),
    '[pir] The person ran a command in your working folder:\n$ x\nkilled by SIGKILL · 1s\n(no output)');
});

test('bangMessage: output over the cap keeps its tail under the cut note', () => {
  const output = 'HEAD'.repeat(10) + 'z'.repeat(AGENT_OUTPUT_CAP);
  const lines = bangMessage({ command: 'big', output, code: 0, ms: 1000 }).split('\n');
  assert.equal(lines[3], '(output cut: the first 40 characters are not shown)');
  assert.equal(lines[4], 'z'.repeat(AGENT_OUTPUT_CAP));
  assert.equal(lines.length, 5);
});

test('bangMessage: output is cleaned by plainText', () => {
  const msg = bangMessage({ command: 'npm test', output: '\x1b[32mok\x1b[0m\r\n 10%\r100%\n', code: 0, ms: 1000 });
  assert.equal(msg.split('\n').slice(3).join('\n'), 'ok\n100%');
});

test('bangMessage: each lead, the ran-a-command one by default', () => {
  const first = (lead) => bangMessage({ command: 'ls', output: 'a', code: 0, ms: 0, lead }).split('\n')[0];
  assert.equal(first(undefined), '[pir] The person ran a command in your working folder:');
  assert.equal(first(LEAD_RAN), '[pir] The person ran a command in your working folder:');
  assert.equal(first(LEAD_HANDED), '[pir] The person ran your command:');
  assert.equal(first(LEAD_EDITED), '[pir] The person edited your command and ran it:');
});

test('bangMessage: a multi-line command is shown whole after the $', () => {
  const msg = bangMessage({ command: 'echo a\necho b', output: 'a\nb\n', code: 0, ms: 0 });
  assert.equal(msg, '[pir] The person ran a command in your working folder:\n$ echo a\necho b\nexit 0 · 0s\na\nb');
});

// ---- shellId ----

test('shellId: sh-{now}-{rand4}, from the arguments only', () => {
  assert.equal(shellId(1700000000000, 'k3f9zz'), 'sh-1700000000000-k3f9');
  assert.match(shellId(1700000000000, 0.123456), /^sh-1700000000000-[0-9a-z]{4}$/);
  assert.equal(shellId(5, 0), 'sh-5-0000');
  assert.equal(shellId(5, 0.5), shellId(5, 0.5));
  assert.notEqual(shellId(5, 0.25), shellId(5, 0.75));
  assert.match(shellId(5, 0.999999999), /^sh-5-[0-9a-z]{4}$/);
});
