// The platform wrapper's send/inbox half (DESIGN §3.2 platform.mjs, §2.2, §2.4). This is the
// PIR-specific glue over Claude Code's cross-session messaging: the wire format a worker and the
// coordinator pack their structured messages into, the same-repo rail that keeps a coordinator
// talking only to its own workers, and the parse of `claude agents --json`. Spawn / list / close —
// the live-session half — land here in T08; this task builds only what can be proven without a live
// agent, which is everything except the byte actually crossing the socket.
//
// Why the transport is injected, not called here. There is NO `claude` subcommand that sends a
// cross-session message: `claude` exposes agents / attach / logs / stop / rm, and the messaging is
// the `SendMessage` tool, which only an agent session invokes (confirmed against `claude --help`,
// 2.1.263). So a Node module cannot itself deliver a message. The transport — deliver one message,
// drain the received ones — is handed in: in production the coordinator skill (T09) backs it with
// the agent's SendMessage tool and its own inbox; in the dry run a fake backs it. This module owns
// the format and the addressing; the transport owns the wire. That `·` in a name is actually
// accepted by that wire is live behaviour the tests cannot reach — it is confirmed by hand the way
// T00 confirmed the `/` rejection (DESIGN §2.8, FINDINGS), and that check is T07's.
//
// The payload field is `text`, not the `body` the T07 interface sketch named. loop.mjs (T05,
// reviewed) and the fake platform both carry it as `text` (`m.text`), so the real inbox() must
// return `text` to be the drop-in the loop already consumes. The four logical fields — from, kind,
// task, text — are all present; only the name of the free-text one changed, to match built code.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAgentName } from '../core/naming.mjs';

// --- The wire format --------------------------------------------------------------------------
//
// SendMessage carries a single free-text field, so a structured { kind, task, text } is packed into
// one string with a header line and unpacked on receipt. The sender's identity (`from`) is supplied
// by the transport, not the header, because the messaging layer stamps it and it must not be
// forgeable from inside the body. The header version tag lets the format change later without a
// silent mis-parse. A message with no recognisable header is not dropped: it is read as a plain
// message (kind `message`) whose task is inferred from the sender's name, so a human note typed into
// a worker still arrives structured.

const HEADER = /^\[pir:v1 kind=(\S+) task=(\S+)\]$/;

// encodeMessage({ kind, task, text }) → the wire string. task is a full id ("T05") or absent; a
// missing task is written "-" and recovered from the sender's name at parse time.
export function encodeMessage({ kind, task, text = '' } = {}) {
  return `[pir:v1 kind=${kind} task=${task ?? '-'}]\n${text}`;
}

// parseMessage({ from, text }) → { from, kind, task, text }. The inverse of encodeMessage, with
// `from` (the transport's stamp) filled straight through and the task falling back to the sender's
// parsed name when the header carried none. A body that does not match the header is a plain
// message, never guessed into a wrong kind.
export function parseMessage({ from = null, text = '' } = {}) {
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? '' : text.slice(nl + 1);
  const m = head.match(HEADER);
  if (m) {
    const task = m[2] === '-' ? parseAgentName(from).task : m[2];
    return { from, kind: m[1], task, text: body };
  }
  return { from, kind: 'message', task: parseAgentName(from).task, text };
}

// --- Same-repo resolution (DESIGN §2.4) -------------------------------------------------------
//
// A coordinator talks only to workers in its own repo, for a tight blast radius. Workers live in
// linked worktrees, so "same repo" is not a path prefix: it is the shared git dir. Each agent's cwd
// is resolved with `git -C <cwd> rev-parse --git-common-dir` and compared to the coordinator's own.
// NOT `--cwd`: T00 found `claude agents --cwd` matches the repo root and returns nothing for a
// worktree (FINDINGS 2026-09-07), so filtering on it would silently drop every worker. The git
// runner is injected so a test can both drive a real scratch repo and assert `--cwd` is never used.

function defaultRun(dir, args) {
  try {
    const stdout = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '' };
  }
}

// The absolute, symlink-resolved common git dir of `dir`, or null if it is not a repo. `--git-common-dir`
// returns ".git" (relative) for a main worktree and an absolute path for a linked one, so it is
// resolved against `dir` and realpath'd before comparison — otherwise a repo reached through
// /tmp (a symlink to /private/tmp on macOS) would not compare equal to itself.
function commonDir(dir, run) {
  const r = run(dir, ['rev-parse', '--git-common-dir']);
  if (!r.ok) return null;
  const p = resolve(dir, r.stdout.trim());
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// resolveSameRepo(agents, { root, run }) → the agents whose cwd shares this repo's git dir. An agent
// with no cwd, or one git cannot resolve, is dropped rather than guessed in.
export function resolveSameRepo(agents, { root = process.cwd(), run = defaultRun } = {}) {
  const mine = commonDir(root, run);
  if (!mine) return [];
  return (agents ?? []).filter((a) => a && a.cwd && commonDir(a.cwd, run) === mine);
}

// --- claude agents --json ---------------------------------------------------------------------

// parseAgents(json) → [{ id, cwd, status, state, name }]. Accepts the raw JSON text or an
// already-parsed array. Keeps only the fields the loop needs (id, cwd, status, state) plus name,
// which naming.mjs parses back into repo/plan/task. Extra fields (pid, sessionId, startedAt) are
// dropped: they are not part of any decision and carrying them would invite a decision to grow one.
export function parseAgents(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  return arr.map((a) => ({
    id: a.id ?? null,
    cwd: a.cwd ?? null,
    status: a.status ?? null,
    state: a.state ?? null,
    name: a.name ?? null,
  }));
}

// --- The messaging surface the loop and skill call --------------------------------------------
//
// createMessaging({ transport }) → { send, inbox }, the send/inbox half of the platform object the
// loop injects. It binds the wire format to a transport:
//   transport.deliver(name, text) → { ok }   // hand one message to the messaging layer
//   transport.drain() → [{ from, text }]     // the messages received since the last drain
// so the byte-moving stays outside this module (the agent's SendMessage tool in production, a fake
// in the dry run) while the format and addressing stay in it. T08 composes this with spawn/list/close
// into the full platform object.
export function createMessaging({ transport } = {}) {
  return {
    // send(name, { kind, task, text }) → { ok }. Addressed by agent name (DESIGN §2.8); the worker
    // builds the coordinator's name itself and is never handed an id.
    send(name, msg = {}) {
      const r = transport.deliver(name, encodeMessage(msg));
      return { ok: r?.ok !== false };
    },
    // inbox() → the received messages, each parsed from the wire. Drop-in for the loop's
    // platform.inbox() (DESIGN §3.4): same { from, kind, task, text } shape as the fake.
    inbox() {
      const raw = transport.drain?.() ?? [];
      return raw.map(parseMessage);
    },
  };
}
