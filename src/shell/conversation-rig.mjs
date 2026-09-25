#!/usr/bin/env node
// The conversation-view rig (plans/live-workers T19): the real `pir` screen in front of a pretend run whose
// worker behaves like a live one, so the conversation view (T13) can be driven end to end with no paid
// worker. Nothing here calls a model: the worker is the real Agent SDK talking to fake/claude-stream.mjs.
//
//   node src/shell/conversation-rig.mjs [--into <scratch>] [--scenario tour|long] [--keep]
//
// It stays in the foreground until Ctrl+C, SIGTERM (pir's Ctrl+S stop sends one to the run's pid) or a
// HALT file in the run's control folder. While it runs, open the screen from another terminal:
//
//   node src/shell/pir.mjs            the dashboard: the rig's run is listed `running`
//   cd <scratch> && node <repo>/src/shell/pir.mjs rig     straight into the run's live view
//
// then → on task T01 opens its worker's conversation.
//
// What it stands up (all of it the real code, bar the `claude` executable):
//   - a scratch repo (`--into`, else a fresh temp folder) holding a reviewed one-task plan `rig`, so
//     `pir rig` from there opens the run instead of starting a coordinator;
//   - an index record whose pid and start time are the rig's own, so pir classifies the run `running`
//     and lets the person's input through (§2.5);
//   - createPlatform with one worker spawned through the SDK on fake/claude-stream.mjs, its conversation
//     log under control/conversations/, and startPersonInbox forwarding the screen's drops to it;
//   - status.json, rewritten every half second from buildRunState and platform.workers(), as the
//     coordinator writes it each pass, so the live view shows T01 and → opens its worker.
//
// Scenarios (the fake's script):
//   tour  the opening message; tool steps with results, one failed; a permission request with an
//         `addRules` suggestion; one flagged defaultToNo; one flagged suppressAlwaysAllowRule; a question
//         set of two (one single-select, one multi-select); then a reply to every typed message, each
//         turn working for `workMs` so Esc can interrupt it. `init.slash_commands` carries `context` and
//         the four terminal commands, which the box must not offer (§2.9).
//   long  the same opening, then enough tool steps to put the log over 256 KB (§2.14), then chat.
//
// Teardown on exit: the worker closed, the inbox stopped, the index record removed, and the scratch
// folder deleted unless --keep.
//
// driveScreen, below, is the other half: it runs pir.mjs under a real pseudo-terminal (python3's `pty`,
// no npm package, DESIGN §5), sends keys and returns the screen as text after each one.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleWidth } from '@earendil-works/pi-tui';
import { buildRunState, writeRunSnapshot } from './coordinate.mjs';
import { fakeClaudeSpawner, initEvent, assistantText, resultEvent, canUseTool, toolUse, toolResult } from './fake/claude-stream.mjs';
import { startTimeOf } from './identity.mjs';
import { indexDir, removeRecord, writeRecord } from './index-store.mjs';
import { createGrants, startPersonInbox } from './person-inbox.mjs';
import { createPlatform } from './platform.mjs';
import { startWorker } from './worker-proc.mjs';

export const RIG_SLUG = 'rig';
export const RIG_TASK = 'T01';
const PIR = fileURLToPath(new URL('./pir.mjs', import.meta.url));

// The commands Claude Code lists as terminal-only (DESIGN §2.9): the box drops them from its offer.
const TERMINAL_COMMANDS = ['doctor', 'color', 'focus', 'reload-plugins'];
const RIG_INIT = { ...initEvent(), slash_commands: ['context', 'model', 'compact', ...TERMINAL_COMMANDS], terminal_slash_commands: TERMINAL_COMMANDS };

const rule = (toolName, ruleContent) => ({ type: 'addRules', rules: [{ toolName, ruleContent }], behavior: 'allow', destination: 'localSettings' });

// One tool step: the use, a pause, its result.
function step(id, name, input, result, { isError = false, paceMs = 0 } = {}) {
  const out = [{ emit: toolUse(`toolu_${id}`, name, input) }];
  if (paceMs) out.push({ sleep: paceMs });
  out.push({ emit: toolResult(`toolu_${id}`, result, isError) });
  return out;
}

// One `canUseTool` ask as the CLI makes it: the tool_use, the control request, the wait for pir's answer,
// then what the tool returned.
function ask(id, name, input, extra, allowed) {
  return [
    { emit: toolUse(`toolu_${id}`, name, input) },
    { emit: canUseTool(id, name, input, extra) },
    { await: 'control_response' },
    { resultFor: id, allowed },
  ];
}

const QUESTIONS = [
  {
    question: 'Which name should the rig command have?',
    header: 'Name',
    multiSelect: false,
    options: [
      { label: 'pir-rig', description: 'short, next to pir' },
      { label: 'conversation-rig', description: 'says what it stands up' },
    ],
  },
  {
    question: 'Which scenarios should it ship with?',
    header: 'Scenarios',
    multiSelect: true,
    options: [
      { label: 'tour', description: 'every kind of line once' },
      { label: 'long', description: 'a log over 256 KB' },
      { label: 'crash', description: 'a worker that dies mid-turn' },
    ],
  },
];

// scenarioScript(name, { paceMs, workMs }) → the fake's script (fake/claude-stream.mjs). paceMs spaces the
// opening steps so a person sees them arrive; workMs is how long each chat reply works before answering.
export function scenarioScript(name = 'tour', { paceMs = 300, workMs = 4000 } = {}) {
  const pace = paceMs ? [{ sleep: paceMs }] : [];
  const opening = [
    { emit: RIG_INIT },
    { await: 'user' },
    { emit: assistantText("I'm the pretend worker of the conversation-view rig. I'll read the task, run a few steps, then ask you for a few things.") },
    ...pace,
    ...step('read1', 'Read', { file_path: 'plans/rig/tasks/T01-tour.md' }, '# T01 — tour\n\nWalk every kind of line the conversation view draws.', { paceMs }),
    ...pace,
    ...step('grep1', 'Grep', { pattern: 'createConversationView', path: 'src' }, 'src/shell/conversation-view.mjs:84:export function createConversationView({', { paceMs }),
    ...pace,
    ...step('bash1', 'Bash', { command: 'npm test', description: 'Run the test suite' }, '✖ conversation-view › hint fits at 80 columns\n  expected 80, got 90\n1 failing', { isError: true, paceMs }),
    ...pace,
    ...step('edit1', 'Edit', { file_path: 'src/shell/conversation-view.mjs', old_string: 'PgUp/PgDn scroll', new_string: 'PgUp/PgDn' }, 'The file src/shell/conversation-view.mjs has been updated.', { paceMs }),
    ...pace,
  ];
  if (name === 'tour') {
    return [
      ...opening,
      { emit: assistantText('One test failed and I fixed it. Now I need your permission for a few things.') },
      ...ask('perm-rules', 'Bash', { command: 'git push origin pir/rig-T01', description: 'Push the task branch' }, { description: 'Push the task branch', permission_suggestions: [rule('Bash', 'git push:*')] }, 'Everything up-to-date'),
      ...ask('perm-no', 'Bash', { command: 'rm -rf build/', description: 'Delete the build folder' }, { description: 'Delete the build folder', default_to_no: true, decision_reason: 'Deleting files outside the task is risky', permission_suggestions: [rule('Bash', 'rm -rf build/')] }, ''),
      ...ask('perm-suppress', 'Write', { file_path: '.claude/settings.json', content: '{}\n' }, { suppress_always_allow_rule: true, permission_suggestions: [rule('Write', '.claude/settings.json')] }, 'File created successfully at: .claude/settings.json'),
      { emit: toolUse('toolu_ask-1', 'AskUserQuestion', { questions: QUESTIONS }) },
      { emit: canUseTool('ask-1', 'AskUserQuestion', { questions: QUESTIONS }, { requires_user_interaction: true }) },
      { await: 'control_response' },
      { resultFor: 'ask-1' },
      { emit: assistantText("Thanks, that's the tour. Type me a message and I'll answer it; press Esc while I'm working to interrupt me.") },
      { emit: resultEvent('success', 'tour done') },
      { chat: { workMs, init: RIG_INIT } },
    ];
  }
  if (name === 'long') {
    // Each step's result is about 1.2 KB, and the log keeps both the use and the whole result event:
    // 300 steps put it well past the 256 KB the view reads on open (§2.14).
    const filler = Array.from({ length: 24 }, (_, i) => `line ${i + 1} of a long result that pads the log out`).join('\n');
    const many = [];
    for (let i = 1; i <= 300; i++) many.push(...step(`long${i}`, 'Bash', { command: `echo step ${i}` }, `${filler}\nstep ${i} done`));
    return [
      ...opening,
      ...many,
      { emit: assistantText('That was 300 steps; the log is now over 256 KB. Type me a message.') },
      { emit: resultEvent('success', 'long done') },
      { chat: { workMs, init: RIG_INIT } },
    ];
  }
  throw new Error(`unknown scenario "${name}" (tour, long)`);
}

// The one-task plan: reviewed and with a test block, so `pir rig` from the scratch repo passes its
// pre-flight and, the run being `running`, opens it instead of starting a coordinator (launch.mjs).
function writePlan(repoRoot, scenario) {
  const plan = join(repoRoot, 'plans', RIG_SLUG);
  mkdirSync(join(plan, 'tasks'), { recursive: true });
  writeFileSync(
    join(plan, 'PROGRESS.md'),
    `# Progress\n\n**Plan reviewed:** rig — a scratch plan for the conversation-view rig\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| ${RIG_TASK} | ${scenario} | — | ⬜ | |\n`,
  );
  writeFileSync(join(plan, 'DESIGN.md'), '---\nsetup:\n  - true\ntest:\n  - true\n---\n\n# Rig\n\nA scratch plan; nothing here is built.\n');
  writeFileSync(join(plan, 'tasks', `${RIG_TASK}-${scenario}.md`), `# ${RIG_TASK} — ${scenario}\n\nThe rig's pretend task.\n`);
}

// startRig({ into, scenario, keep, env, paceMs, workMs, snapshotMs }) → the running rig:
//   { repoRoot, repo, slug, controlDir, workerId, logPath, received, platform, pid, stop() }
// `env` supplies PIR_HOME (the index folder, indexDir's rule), so a test points the index at a scratch
// folder. stop() is the teardown, idempotent; it resolves once the worker has exited.
export function startRig({ into = null, scenario = 'tour', keep = false, env = process.env, paceMs, workMs, snapshotMs = 500 } = {}) {
  const script = scenarioScript(scenario, { paceMs, workMs });
  let repoRoot;
  if (into) {
    repoRoot = resolve(into);
    if (existsSync(repoRoot) && readdirSync(repoRoot).length) throw new Error(`--into ${repoRoot}: not empty; the rig deletes what it made, so it wants an empty or new folder`);
    mkdirSync(repoRoot, { recursive: true });
  } else {
    repoRoot = mkdtempSync(join(tmpdir(), 'pir-rig-'));
  }
  const repo = basename(repoRoot);
  const controlDir = join(repoRoot, 'plans', RIG_SLUG, '.parallel', 'control');
  mkdirSync(controlDir, { recursive: true });
  writePlan(repoRoot, scenario);
  const scriptPath = join(controlDir, 'fake-script.json');
  writeFileSync(scriptPath, JSON.stringify(script));
  const received = join(controlDir, 'fake-received.ndjson');

  const dir = indexDir({ env });
  const branch = `pir/${RIG_SLUG}`;
  const startTime = startTimeOf(process.pid);
  const startedAt = new Date().toISOString();
  writeRecord({ version: 1, slug: RIG_SLUG, repo, repoPath: repoRoot, controlDir, pid: process.pid, startTime, startedAt, branch, finalState: null, updatedAt: null }, { dir });

  const spawnProcess = fakeClaudeSpawner({ script: scriptPath, received });
  const grants = createGrants();
  const platform = createPlatform({
    controlDir,
    transport: { drain: () => [] },
    claudePath: 'claude-fake', // never run: the spawner below launches the fake whatever it is asked for
    grants,
    startWorker: (opts) => startWorker({ ...opts, spawnProcess }),
  });
  const workerId = platform.spawn({ cwd: repoRoot, name: `${repo} / ${RIG_SLUG} / ${RIG_TASK} / ${scenario} / implement`, phase: 'implement' });
  const logPath = platform.logPathOf(workerId);
  const inbox = startPersonInbox({ controlDir, platform, grants });

  const proc = { pid: process.pid, startTime, slug: RIG_SLUG, repo, branch, startedAt };
  const since = Date.now();
  const passTasks = [{ num: RIG_TASK, name: scenario, deps: [], state: '⬜' }];
  const snapshot = () => {
    try {
      const runState = buildRunState({ passTasks, stateTasks: { [RIG_TASK]: { role: 'implement', phase: 'running' } }, workers: platform.workers(), branch, ceiling: 1, sinceByTask: { [RIG_TASK]: since } });
      writeRunSnapshot({ controlDir, proc, runState });
    } catch {
      // a failed write is retried on the next tick
    }
  };
  snapshot();
  const timer = setInterval(snapshot, snapshotMs);
  timer.unref?.();

  let stopping = null;
  function stop() {
    stopping ??= (async () => {
      clearInterval(timer);
      inbox.stop();
      removeRecord({ repo, slug: RIG_SLUG }, { dir });
      const rec = platform.workers().find((w) => w.id === workerId);
      // A pretend worker has nothing to finish, so it gets its SIGTERM now rather than after the 5 s grace.
      if (rec?.live) platform.close(workerId, { immediate: true });
      await waitGone(platform, workerId);
      if (!keep) rmSync(repoRoot, { recursive: true, force: true });
    })();
    return stopping;
  }

  const pid = platform.list().find((w) => w.id === workerId)?.pid ?? null;
  return { repoRoot, repo, slug: RIG_SLUG, controlDir, workerId, logPath, received, platform, pid, stop };
}

// Resolves once the worker has left platform.list(), which it does the moment its process has exited.
async function waitGone(platform, id, { timeoutMs = 15000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (platform.list().some((w) => w.id === id) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
}

// ---- The driver: pir.mjs under a real pseudo-terminal. ----

// A byte relay between this process's pipes and a child on a pty. Python's `pty` is the one standard way
// to get a pseudo-terminal without an npm package (DESIGN §5). The window size is set on the child's side
// before exec, so pir reads it from its first frame. Our stdin closing (EOF) ends the child.
const PTY_RELAY = String.raw`
import os, pty, sys, struct, fcntl, termios, select, signal
rows, cols = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.execvp(sys.argv[3], sys.argv[3:])
inp = sys.stdin.buffer.raw
out = sys.stdout.buffer.raw
open_in = True
while True:
    fds = [fd] + ([inp] if open_in else [])
    r, _, _ = select.select(fds, [], [], 0.5)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        out.write(data)
    if open_in and inp in r:
        data = os.read(inp.fileno(), 65536)
        if not data:
            open_in = False
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
        else:
            os.write(fd, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) & 0xff)
`;

// createScreenModel({ rows, cols }) → { write(text), rows() }: a minimal terminal for what pi-tui writes.
// pi-tui's alternate screen addresses every row absolutely (`CSI row;1H`, then `CSI 2K` and the line) and
// parks the cursor with `CSI row;colH`; everything else it writes is colour, mode switches, queries,
// hyperlinks (OSC) and Kitty graphics (APC). The model keeps a grid of cells and applies cursor moves,
// erases and printable text, and ignores the rest. It starts from pir-tui.test.mjs's `drawnRows`, which
// splits the stream at row addresses, but that split misreads the cursor park at column 1 (an empty box)
// as a blank row write, so the model tracks the cursor instead. Autowrap is off (pi-tui turns it off), so
// text past the last column is dropped.
export function createScreenModel({ rows = 24, cols = 80 } = {}) {
  const blank = () => Array.from({ length: cols }, () => ' ');
  let grid = Array.from({ length: rows }, blank);
  let r = 0;
  let c = 0;
  let pending = ''; // an escape sequence split across two writes
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function csi(params, final) {
    const nums = params.replace(/^[?<>=]/, '').split(';').map((x) => (x === '' ? NaN : Number(x)));
    const n = (i, d) => (Number.isFinite(nums[i]) ? nums[i] : d);
    if (/^[?<>=]/.test(params)) return; // private modes and queries
    switch (final) {
      case 'H':
      case 'f':
        r = clamp(n(0, 1) - 1, 0, rows - 1);
        c = clamp(n(1, 1) - 1, 0, cols - 1);
        break;
      case 'A': r = clamp(r - n(0, 1), 0, rows - 1); break;
      case 'B': r = clamp(r + n(0, 1), 0, rows - 1); break;
      case 'C': c = clamp(c + n(0, 1), 0, cols - 1); break;
      case 'D': c = clamp(c - n(0, 1), 0, cols - 1); break;
      case 'G': c = clamp(n(0, 1) - 1, 0, cols - 1); break;
      case 'K': {
        const mode = n(0, 0);
        for (let i = 0; i < cols; i++) if (mode === 2 || (mode === 0 && i >= c) || (mode === 1 && i <= c)) grid[r][i] = ' ';
        break;
      }
      case 'J': {
        const mode = n(0, 0);
        if (mode === 2 || mode === 3) grid = Array.from({ length: rows }, blank);
        else if (mode === 0) for (let y = r; y < rows; y++) for (let i = y === r ? c : 0; i < cols; i++) grid[y][i] = ' ';
        break;
      }
      default:
        break; // colour (m) and anything else leaves the cells alone
    }
  }

  function write(text) {
    const s = pending + text;
    pending = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\x1b') {
        const next = s[i + 1];
        if (next === undefined) { pending = s.slice(i); return; }
        if (next === '[') {
          const m = /^\x1b\[([0-9;?<>=]*)[ -\/]*([@-~])/.exec(s.slice(i));
          if (!m) { pending = s.slice(i); return; }
          csi(m[1], m[2]);
          i += m[0].length;
        } else if (next === ']' || next === '_' || next === 'P') {
          // OSC ends at BEL or ST; APC and DCS at ST.
          const rest = s.slice(i + 2);
          const bel = next === ']' ? rest.indexOf('\x07') : -1;
          const st = rest.indexOf('\x1b\\');
          const ends = [bel, st].filter((x) => x >= 0);
          if (!ends.length) { pending = s.slice(i); return; }
          const end = Math.min(...ends);
          i += 2 + end + (end === st ? 2 : 1);
        } else {
          i += 2; // a two-byte escape (ESC 7, ESC =, …)
        }
        continue;
      }
      if (ch === '\r') c = 0;
      else if (ch === '\n') {
        if (r === rows - 1) grid = [...grid.slice(1), blank()];
        else r += 1;
      } else if (ch === '\b') c = Math.max(0, c - 1);
      else if (ch >= ' ') {
        const cp = String.fromCodePoint(s.codePointAt(i));
        const w = visibleWidth(cp);
        if (w > 0 && c + w <= cols) {
          grid[r][c] = cp;
          if (w === 2) grid[r][c + 1] = '';
          c += w;
        }
        i += cp.length;
        continue;
      }
      i += 1;
    }
  }

  return {
    write,
    rows: () => grid.map((row) => row.join('').replace(/\s+$/, '')),
  };
}

// driveScreen({ cols, rows, keys, args, cwd, env, settleMs, timeoutMs }) → { screens, exitCode }.
// Runs `node pir.mjs ...args` under a pty of cols×rows, waits for its first frame, then sends each key in
// turn and captures the screen once output has been quiet for settleMs. A key is a string (the bytes to
// send) or { keys, until, timeoutMs }: `until` (a RegExp or a function of the screen text) holds the
// capture until the screen shows it, and throws, with the screen, if it never does. The first entry of
// `screens` is the opening frame ({ keys: null }). After the last key the input is closed, which ends pir.
export async function driveScreen({ cols = 100, rows = 30, keys = [], args = [], cwd = process.cwd(), env = process.env, settleMs = 250, timeoutMs = 15000, first = null } = {}) {
  const child = spawn('python3', ['-c', PTY_RELAY, String(rows), String(cols), process.execPath, PIR, ...args], {
    cwd,
    env: { TERM: 'xterm-256color', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const model = createScreenModel({ rows, cols });
  let lastOutput = Date.now();
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    model.write(d);
    lastOutput = Date.now();
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((res) => child.once('exit', (code) => res(code)));
  let gone = false;
  exited.then(() => (gone = true));

  const text = () => model.rows().join('\n');
  const holds = (until) => !until || (typeof until === 'function' ? until(text()) : until.test(text()));
  async function capture(until, limit) {
    const deadline = Date.now() + limit;
    for (;;) {
      await new Promise((r) => setTimeout(r, 25));
      const quiet = Date.now() - lastOutput >= settleMs;
      if (quiet && holds(until)) return model.rows();
      if (gone && !holds(until)) throw new Error(`pir exited before the screen showed ${until}\n${stderr}\n${text()}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${until} after ${limit} ms; the screen:\n${text()}\n${stderr}`);
    }
  }

  const screens = [];
  try {
    screens.push({ keys: null, rows: await capture(first ?? ((t) => t.trim() !== ''), timeoutMs) });
    for (const k of keys) {
      const { keys: bytes, until = null, timeoutMs: limit = timeoutMs } = typeof k === 'string' ? { keys: k } : k;
      child.stdin.write(bytes);
      lastOutput = Date.now();
      screens.push({ keys: bytes, rows: await capture(until, limit) });
    }
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  return { screens, exitCode: child.exitCode };
}

// ---- The command. ----

function parseArgs(argv) {
  const opts = { into: null, scenario: 'tour', keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--into') opts.into = argv[++i];
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else throw new Error(`unknown argument ${a}\nusage: conversation-rig.mjs [--into <scratch>] [--scenario tour|long] [--keep]`);
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const rig = startRig(opts);
  console.log(`rig running: scenario ${opts.scenario}, run "${rig.slug}" in ${rig.repoRoot}`);
  console.log(`open it:     node ${PIR}              (the dashboard)`);
  console.log(`         or  cd ${rig.repoRoot} && node ${PIR} ${rig.slug}`);
  console.log('stop it:     Ctrl+C here, Ctrl+S twice in pir, or touch its control/HALT');
  let done = false;
  const finish = async (why) => {
    if (done) return;
    done = true;
    console.log(`stopping (${why})…`);
    await rig.stop();
    console.log(opts.keep ? `kept ${rig.repoRoot}` : 'torn down');
    process.exit(0);
  };
  process.on('SIGINT', () => finish('Ctrl+C'));
  process.on('SIGTERM', () => finish('SIGTERM'));
  const halt = setInterval(() => existsSync(join(rig.controlDir, 'HALT')) && finish('HALT'), 500);
  void halt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
