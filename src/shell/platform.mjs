// The platform wrapper's inbox half (DESIGN §3.2 platform.mjs, §2.2). This is the PIR-specific glue
// over the worker up-channel: the wire format a worker packs its structured report into, the same-repo
// rail that keeps a coordinator counting only its own workers, and the parse of `claude agents --json`.
// Spawn / list / close — the live-session half — landed in T08 at the foot of this file. Every part of
// them short of the process actually starting is unit-tested (argv, json parsing, same-repo filtering);
// the live spawn / list / close is hand-verified (DESIGN §5.1, spawn-one-scratch.mjs).
//
// There is no down-channel any more (DESIGN §2.2, T03). The coordinator used to relay a worker's
// question up to the person and the person's answer back down; the person now talks to a blocked
// worker directly in its own session, so nothing is routed. Only the UP-channel remains: a worker
// drops a one-line report into the control folder's `reports/` drop-dir, and the injected transport
// drains it — no `claude` subcommand can send a cross-session message (that is the `SendMessage`
// agent tool), and none is needed to read a plain file drop. This module owns the format and the
// addressing; the transport owns the file-moving (a fake in the dry run, the reports drain in the bin).
//
// The payload field is `text`, not the `body` the T07 interface sketch named. loop.mjs and the fake
// platform both carry it as `text` (`m.text`), so inbox() returns `text` to be the drop-in the loop
// already consumes. The four logical fields — from, kind, task, text — are all present.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAgentName } from '../core/naming.mjs';

// --- The wire format --------------------------------------------------------------------------
//
// A worker's report is a single free-text field, so a structured { kind, task, text } is packed into
// one string with a header line and unpacked on receipt. The sender's identity (`from`) is supplied
// by the transport (the drop-dir filename / stamp), not the header, because it must not be forgeable
// from inside the body. The header version tag lets the format change later without a silent
// mis-parse. A report with no recognisable header is not dropped: it is read as a plain message (kind
// `message`) whose task is inferred from the sender's name, so a human note still arrives structured.
// encodeMessage is the canonical spec of what a worker writes into a report; inbox() is the reader.

const HEADER = /^\[pir:v1 kind=(\S+) task=(\S+)\]$/;

// The message kinds the coordinator loop's state machine acts on (loop.mjs applyMessages): a worker
// signals `implemented` / `done` to advance a task, or `question` / `decision` / `conflict` to park it
// and surface it to the user (DESIGN §2.5). `pir-worker` is taught to send exactly these as the
// [pir:v1 …] header; PROSE_KIND below is the safety net for a worker that forgets the header.
const KINDS = ['question', 'decision', 'implemented', 'done', 'conflict'];

// The header is the contract (pir-worker emits it), but a real `claude` worker is a language model and
// may still send natural language — the T10 drill's worker wrote "T01 question (kind: question) — …"
// instead of the header, and parseMessage read it as a plain `message` the loop then ignored (T12
// Problem 3). So when there is no valid header, look for an EXPLICIT kind marker (`kind: question`,
// `kind=question`) anywhere in the text. Only an explicit `kind` token counts — a bare word like
// "done" in prose must not be mistaken for a state signal — so a plain human note still parses as
// `message`, never guessed into a wrong kind.
const PROSE_KIND = new RegExp(`\\bkind\\s*[:=]\\s*["']?(${KINDS.join('|')})\\b`, 'i');

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
  // No header: the safety net (T12 Problem 3). An explicit `kind:` / `kind=` marker in the prose is
  // honoured; the task falls back to any T-id in the text, then to the sender's parsed name. The
  // whole text is kept as the body since there was no header line to strip.
  const prose = text.match(PROSE_KIND);
  if (prose) {
    const idInText = text.match(/\bT\d+\b/);
    const task = idInText ? idInText[0] : parseAgentName(from).task;
    return { from, kind: prose[1].toLowerCase(), task, text };
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
// pid is kept because `claude stop` only interrupts a session's turn — it does NOT remove it (T08
// live run 2026-09-09: a stopped session stays listed as `state:working`) — so close terminates the
// worker by sending its process SIGTERM, and that needs the pid.
export function parseAgents(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  return arr.map((a) => ({
    id: a.id ?? null,
    pid: a.pid ?? null,
    cwd: a.cwd ?? null,
    status: a.status ?? null,
    state: a.state ?? null,
    name: a.name ?? null,
  }));
}

// --- The inbox surface the loop calls ---------------------------------------------------------
//
// createMessaging({ transport }) → { inbox }, the up-channel half of the platform object the loop
// injects (DESIGN §2.2, §3.4). It binds the wire format to a transport that only reads:
//   transport.drain() → [{ from, text }]     // the worker reports received since the last drain
// so the file-moving stays outside this module (the reports drop-dir drain in the bin, a fake in the
// dry run) while the format and addressing stay in it. There is no `send` — the down-channel is gone
// (DESIGN §2.2, T03); a blocked worker is answered by the person directly, not routed.
export function createMessaging({ transport } = {}) {
  return {
    // inbox() → the received reports, each parsed from the wire. Drop-in for the loop's
    // platform.inbox() (DESIGN §3.4): same { from, kind, task, text } shape as the fake.
    inbox() {
      const raw = transport.drain?.() ?? [];
      return raw.map(parseMessage);
    },
  };
}

// --- The live session half: spawn / list / close (DESIGN §2.1, §2.3, §3.2, T08) ---------------
//
// The three operations that actually touch a real `claude` process, built on the T00 spike's
// confirmed mechanics (FINDINGS 2026-09-07):
//   - `claude --bg` prints the new session id to stdout and takes the opening turn POSITIONALLY,
//     not with `-p` (`--bg`+`--print` conflict and exit 1). `-n "<name>"` sets the name verbatim,
//     which is what `claude agents --json` shows and what messaging addresses by (§2.8).
//   - `claude agents --json` lists sessions across every repo; same-repo filtering is by shared git
//     dir, never `--cwd` (resolveSameRepo above).
//   - `claude stop <id>` ends a session. It does NOT remove the worktree — that is worktree.remove's
//     job (T06). Keeping close() session-only is deliberate: an implementer is closed as its reviewer
//     spawns on the SAME worktree, so close must not tear the worktree down (FINDINGS 2026-09-08,
//     DESIGN §2.3). This is why the T08.md `close → remove the worktree` sketch is not followed.
//
// The `claude` runner is injected (runClaude) exactly as the git runner is, so argv construction and
// json parsing — everything short of the process actually starting — are unit-tested, and the one
// thing the tests cannot reach (a real agent spawning) is hand-verified (DESIGN §5.1, spawn-one-scratch).

// Which stock skill the coordinator's opening instruction names, per the phase the loop hands spawn.
// The loop passes 'implement' | 'review' | 'verify' (loop.mjs); the worker runs exactly that under
// the pir-worker contract (§2.6, skills/pir-worker).
const SKILL_FOR = { implement: 'pir-implement', review: 'pir-review', verify: 'pir-verify' };

// openingInstruction(phase, task) → the first-turn prompt a freshly spawned worker reads. It engages
// the pir-worker contract (so the fresh session knows it is coordinator-driven, never runs pir-work
// and never self-selects a task, §2.1) and names the single phase+task it must carry out. This exact
// string is what T08's hand-verified run tests: whether a live worker acts on it (DESIGN §5.1).
export function openingInstruction(phase, task) {
  const skill = SKILL_FOR[phase];
  if (!skill) throw new Error(`openingInstruction: unknown phase "${phase}"`);
  if (!task) throw new Error('openingInstruction: no task (the name did not parse to a task id)');
  return (
    'You are a worker session in a parallel PIR run, spawned and driven by a coordinator — not by a ' +
    'person. Do not run pir-work and do not pick your own task. Invoke the pir-worker skill and follow ' +
    `its contract, then carry out exactly this instruction and nothing else: ${skill} ${task}`
  );
}

// argv builders, exported so the tests assert them without a live process (DESIGN §5.1). The name
// carries the `·` separator from naming.mjs; execFile passes each element as one argument, so the
// spaces in the name and the instruction never need shell quoting.
export function spawnArgv({ name, instruction }) {
  return ['--bg', '-n', name, instruction];
}
export function listArgv() {
  return ['agents', '--json'];
}
export function closeArgv(id) {
  return ['stop', id];
}
// `claude rm <id>` clears a session's leftover record from `claude agents` (DESIGN §2.3). It is the
// cleanup for the `stopped` entry a close leaves behind — `stop`+SIGTERM ends the process but the list
// record lingers — so the coordinator runs it right after close on every normal finish path (T41).
export function removeArgv(id) {
  return ['rm', id];
}

// The default `claude` runner, mirroring defaultRun (git) above: a value on success or failure, never
// a throw, so a failed spawn or a `claude` that is absent is something the caller inspects.
function defaultRunClaude(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('claude', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// createPlatform({ root, transport, runClaude, sameRepoRun }) → the full platform object the loop
// injects (DESIGN §3.2, §3.4): spawn / list / close over real `claude`, and inbox over the messaging
// bound to `transport`. The two runners (claude, git-for-same-repo) are injected so the whole surface
// is testable and a scratch entry can drive it. In the bin `transport` is backed by the `reports/`
// drop-dir drain (coordinate.mjs); there is no down-channel to back, because the person answers a
// blocked worker directly (DESIGN §2.2).
export function createPlatform({
  root = process.cwd(),
  transport,
  runClaude = defaultRunClaude,
  sameRepoRun,
  kill = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const messaging = createMessaging({ transport });
  return {
    // spawn({ cwd, name, phase }) → id. Matches the loop's call and the fake's signature (NOT the
    // T08.md `spawn(cwd, task, phase)` sketch): the loop builds the name with naming.mjs and passes it
    // in, and the task is recovered from the name so list() can report it. The opening instruction is
    // the positional turn; `-n` sets the name. Returns the id `claude --bg` prints.
    spawn({ cwd, name, phase }) {
      const task = parseAgentName(name).task;
      const instruction = openingInstruction(phase, task);
      const r = runClaude(spawnArgv({ name, instruction }), { cwd });
      if (!r.ok) throw new Error(`spawn failed for ${name}: ${r.stderr || r.stdout || 'unknown error'}`);
      const id = (r.stdout ?? '').trim();
      if (!id) throw new Error(`spawn returned no id for ${name}`);
      return id;
    },

    // list() → [{ id, name, cwd, status, state, live }], only this repo's sessions. `claude agents
    // --json` lists every repo's sessions; resolveSameRepo keeps the ones sharing this git dir. A
    // listed session is live by definition (a crashed worker vanishes from the list — DESIGN §2.5), so
    // live is always true here; the loop treats absence from the list as death.
    list() {
      const r = runClaude(listArgv());
      if (!r.ok) return [];
      const agents = parseAgents(r.stdout);
      return resolveSameRepo(agents, { root, run: sameRepoRun }).map((a) => ({
        id: a.id,
        pid: a.pid,
        name: a.name,
        cwd: a.cwd,
        status: a.status,
        state: a.state,
        live: true,
      }));
    },

    // close(id) → { ok }. Terminates the session; the worktree and branch are torn down separately by
    // worktree.remove (T06). Two steps, because `claude stop` alone does NOT remove a session — it only
    // interrupts the current turn and the session stays alive and listed (T08 live run 2026-09-09,
    // FINDINGS; both stopped workers stayed `state:working`, which made the loop over-count and never
    // free a slot). So: `claude stop <id>` to interrupt any in-flight work, then look the session up in
    // the live list to get its pid and send that process SIGTERM, which is what actually removes it.
    // Identity is the `id` field (unique per session), the same one list() reports. Safe on an
    // already-gone id: the stop is a swallowed no-op and the pid lookup simply finds nothing.
    close(id) {
      runClaude(closeArgv(id));
      const listing = runClaude(listArgv());
      const agent = listing.ok ? parseAgents(listing.stdout).find((a) => a.id === id) : null;
      if (agent?.pid) {
        try {
          kill(agent.pid, 'SIGTERM');
        } catch {
          // the process is already gone — nothing to terminate
        }
      }
      return { ok: true };
    },

    // remove(id) → { ok }. Clears a FINISHED worker's leftover `stopped` record from `claude agents`
    // with `claude rm <id>` (DESIGN §2.3, T41). Run right after close on every normal finish path, so a
    // finished worker leaves the "Claude agents" view instead of piling up; NEVER on `halt-close`, where
    // a killed worker's record is left for forensics (loop.mjs). Best-effort: removing an id that is
    // already gone is not an error and a `remove` never throws the loop off course (runClaude swallows a
    // failed `claude rm` exactly as close's `claude stop` does). Acts on the authoritative list id — the
    // same `id` close and list use — never the spawn-returned id.
    remove(id) {
      if (!id) return { ok: true };
      runClaude(removeArgv(id));
      return { ok: true };
    },

    inbox: messaging.inbox,
  };
}
