// The fake platform: in-memory agents standing in for real background `claude` sessions
// (DESIGN §2.2, §2.3, §4). It answers the same shell interface the real platform.mjs of T06/T08
// will — spawn / send / list / close / inbox — so the loop is written once and run against either.
// It lives in src/shell/ and may use fs and git; the boundary test guards only src/core/.
//
// Fidelity choices, so the loop is genuinely exercised, not stubbed:
//   - A worker makes REAL commits on its task-branch worktree (its cwd), through the same git
//     helper the fake worktree uses. So there is real work to merge, and the branch model is
//     proven end to end. An implementer commits a code file and marks its own PROGRESS.md row
//     🔍 on its task branch (DESIGN §2.5: a worker edits only its own row); a reviewer marks it
//     ✅; a hands-on `verify` worker marks it ✅ and records a finding, with no review phase (§2.6).
//   - list() advances every live worker one step before returning the snapshot. This is the fake's
//     clock: one observation is one tick, which is how an in-memory worker makes progress between
//     the coordinator's passes the way a real session progresses in wall-clock time. The real
//     list() has no such side effect; the loop calls list() exactly once per pass, so a tick is
//     well defined. Nothing else advances a worker.
//   - A worker's behaviour is scriptable per task (a question, an unresolved conflict, a crash),
//     so the loop's unhappy paths (DESIGN §2.5) are testable without a live agent.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentName } from '../../core/naming.mjs';
import { reconcileTaskRow, progressPathFor } from '../../core/progress.mjs';
import { git } from './worktree.mjs';

// Commit a worker's work on its task-branch worktree (its cwd). `state`/`note` set that task's own
// row in the task branch's PROGRESS.md, which lives at plans/{plan}/PROGRESS.md (progressPathFor), the
// same file the loop and the worker's real skills use; a distinct file per phase gives the merge real
// content. `plan` comes from the worker's name (parseAgentName), set at spawn.
function commit(cwd, task, plan, { file, content, rowState, note, message }) {
  if (file) writeFileSync(join(cwd, file), content ?? '');
  if (rowState) {
    const p = join(cwd, progressPathFor(plan));
    const updated = reconcileTaskRow(readFileSync(p, 'utf8'), { num: task, state: rowState, notes: note ?? '' });
    writeFileSync(p, updated);
  }
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message, '--no-edit']);
}

// createFakePlatform({ behaviors }) → the platform object.
//   behaviors — a map from task id ("T05") to how that task's worker behaves:
//     {}                     clean: implement → implemented; review → done; verify → done.
//     { question: "text" }   the implementer parks with a question until an answer arrives, then
//                            proceeds to implemented (DESIGN §2.5).
//     { decision: "text" }   the same as question but the worker sends kind `decision` (a genuine
//                            choice, DESIGN §2.5); it parks and resumes identically (T12 P3).
//     { conflict: "text" }   the implementer cannot resolve a code conflict and parks with a
//                            decision; it stays parked (the loop must not merge, DESIGN §2.5).
//     { crash: true }        the worker dies after one step (vanishes from list()); the loop must
//                            close it as dead and free its slot (DESIGN §2.5, §3.3).
//     { lingerBusy: N }      after the worker reaches a resting stage (implemented / done / awaiting),
//                            list() reports it `busy` for N more ticks before `idle`. Models a real
//                            session still mid-turn after it committed, so a test can prove the loop
//                            gates a finished worker's close on it going idle (T13 Problem B).
//     { lingerClosed: N }    after close(), the session stays in list() for N more ticks (still
//                            `state:working`) before it drops off. Models the real `claude close`:
//                            SIGTERM is async and a stale Remote Control registry entry can outlive the
//                            process, so a just-closed worker lingers in `claude agents --json` for a
//                            few passes (single live run 2026-09-12). Lets a test prove the loop does
//                            not recount a closed-but-still-listed worker (loop.mjs closedIds).
export function createFakePlatform({ behaviors = {} } = {}) {
  const workers = new Map(); // id → worker record
  const inboxQueue = []; // messages from workers to the coordinator, drained by inbox()
  const spawns = []; // every spawn, for test introspection
  const closed = []; // every close, for test introspection
  const sent = []; // every send, for test introspection
  let nextId = 0;

  function emit(w, kind, text = '') {
    inboxQueue.push({ from: w.name, task: w.task, kind, text });
  }

  // One step for one live worker. Its `stage` is where it is in its own little lifecycle; the
  // behaviour map bends the implement path into a question/conflict/crash.
  function advance(w) {
    const b = behaviors[w.task] ?? {};

    if (w.role === 'implement') {
      if (w.stage === 'fresh') {
        if (b.crash) {
          w.live = false;
          w.stage = 'dead';
          return;
        }
        if (b.question) {
          emit(w, 'question', b.question);
          w.stage = 'awaiting';
          w.resume = 'implemented';
          return;
        }
        if (b.decision) {
          // A `decision` (a genuine choice, DESIGN §2.5) parks exactly like a question — the loop
          // must surface both and resume on an answer. Added for T12 P3, which taught the loop to
          // handle `decision`, previously dropped.
          emit(w, 'decision', b.decision);
          w.stage = 'awaiting';
          w.resume = 'implemented';
          return;
        }
        if (b.conflict) {
          emit(w, 'conflict', b.conflict);
          w.stage = 'parked'; // stays parked; the loop surfaces it and must not merge
          return;
        }
        commit(w.cwd, w.task, w.plan, { file: `work-${w.task}.txt`, content: `work ${w.task}\n`, rowState: '🔍', note: 'implemented', message: `${w.task}: implement` });
        emit(w, 'implemented');
        w.stage = 'implemented';
        return;
      }
      if (w.stage === 'awaiting' && w.answered) {
        commit(w.cwd, w.task, w.plan, { file: `work-${w.task}.txt`, content: `work ${w.task}\n`, rowState: '🔍', note: 'implemented', message: `${w.task}: implement` });
        emit(w, 'implemented');
        w.stage = 'implemented';
        return;
      }
      return; // implemented / parked / still awaiting → nothing new
    }

    if (w.role === 'review') {
      if (w.stage === 'fresh') {
        commit(w.cwd, w.task, w.plan, { rowState: '✅', note: 'reviewed clean', message: `${w.task} review: clean` });
        emit(w, 'done');
        w.stage = 'done';
      }
      return;
    }

    if (w.role === 'verify') {
      if (w.stage === 'fresh') {
        // A hands-on worker: the person ran the live steps; the worker records the finding and marks
        // the row ✅ directly. No 🔍, no review (DESIGN §2.6).
        commit(w.cwd, w.task, w.plan, { file: `finding-${w.task}.txt`, content: `verified ${w.task}\n`, rowState: '✅', note: 'verified by hand', message: `${w.task}: verified` });
        emit(w, 'done');
        w.stage = 'done';
      }
      return;
    }
  }

  // A worker is `busy` (mid-turn) until it reaches a resting stage, then `idle` — the coordinator's
  // close of a finished worker is gated on this (T13 Problem B). `lingerBusy` holds it `busy` for a few
  // extra ticks after it rests, so a test can watch the loop DEFER a close while busy and only close
  // once idle. Mirrors `claude agents --json`'s status/state (idle/busy, working/done, FINDINGS
  // 2026-09-07). Called once per tick in list(), after advance, so a stage change is reflected the same
  // observation the coordinator reads it on.
  const RESTING = new Set(['implemented', 'done', 'awaiting', 'parked', 'dead']);
  function updateStatus(w) {
    if (!RESTING.has(w.stage)) {
      w.status = 'busy';
      w.state = 'working';
      return;
    }
    if (w.busyHold > 0) {
      w.busyHold -= 1;
      w.status = 'busy';
      w.state = 'working';
      return;
    }
    w.status = 'idle';
    w.state = 'done';
  }

  function findByIdOrName(idOrName) {
    if (workers.has(idOrName)) return workers.get(idOrName);
    for (const w of workers.values()) if (w.name === idOrName) return w;
    return null;
  }

  return {
    // spawn({ cwd, name, phase }) → id. phase is the worker's role: "implement" | "review" | "verify".
    // The name is built by the loop with naming.mjs; the task is recovered from it here so list()
    // reports it and the loop can rebuild assignments from names alone (DESIGN §2.8).
    spawn({ cwd, name, phase }) {
      const parsed = parseAgentName(name);
      const b = behaviors[parsed.task] ?? {};
      const id = `w${++nextId}`;
      const w = {
        id,
        name,
        task: parsed.task,
        plan: parsed.plan,
        cwd,
        role: phase,
        stage: 'fresh',
        live: true,
        answered: false,
        status: 'busy',
        state: 'working',
        busyHold: b.lingerBusy ?? 0,
      };
      workers.set(id, w);
      spawns.push({ id, name, task: parsed.task, role: phase, cwd });
      return id;
    },

    // send(idOrName, msg) → deliver a message to a worker. Used for the user's answer to a parked
    // worker's question, which un-parks it (DESIGN §2.5).
    send(idOrName, msg) {
      const w = findByIdOrName(idOrName);
      sent.push({ to: idOrName, msg });
      if (w && w.stage === 'awaiting') w.answered = true;
      return { ok: !!w };
    },

    // list() → live workers with their state. Advances every live worker one tick first (see header).
    list() {
      for (const w of workers.values()) {
        if (!w.live) continue;
        if (w.stage === 'closed') {
          // a closed session lingers a few ticks before it drops off the list (see close()); while it
          // lingers it stays a stale `working` entry and does not advance.
          if (w.lingerClosed <= 0) w.live = false;
          else w.lingerClosed -= 1;
          continue;
        }
        advance(w);
        updateStatus(w); // reflect the new stage's busy/idle in this same observation (T13 Problem B)
      }
      return [...workers.values()]
        .filter((w) => w.live)
        .map((w) => ({ id: w.id, name: w.name, cwd: w.cwd, status: w.status, state: w.state, live: true }));
    },

    // close(id) → stop the session. Session teardown only; removing the worktree and branch is the
    // worktree's job (worktree.remove), so an implementer can be closed while its reviewer keeps the
    // shared worktree (DESIGN §2.3). Safe on an already-gone id. With `lingerClosed: N` the session is
    // stopped but stays listed for N more ticks (a stale `working` entry), modelling the real close's
    // async teardown so a test can prove the loop does not recount it (loop.mjs closedIds).
    close(id) {
      closed.push(id);
      const w = workers.get(id);
      const linger = w ? behaviors[w.task]?.lingerClosed ?? 0 : 0;
      if (w && linger > 0) {
        w.stage = 'closed'; // no further advance; list() ages it out over `linger` ticks
        w.lingerClosed = linger;
        w.status = 'busy';
        w.state = 'working';
      } else {
        workers.delete(id);
      }
    },

    // inbox() → drain the messages workers have sent the coordinator since the last call.
    inbox() {
      return inboxQueue.splice(0, inboxQueue.length);
    },

    // --- test introspection ---
    spawns,
    closed,
    sent,
    _workers: workers,
  };
}
