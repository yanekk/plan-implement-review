// The fake platform: in-memory workers standing in for the live stream-json children of platform.mjs
// (live-workers DESIGN §2.1, §4). It answers the same shell interface — spawn / list / close / remove /
// inbox / send / interrupt / answer — so the loop is written once and run against either.
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

// A worker introducing a new task writes its ⬜ row into its OWN task branch's PROGRESS.md (DESIGN
// §2.1 step 3), which the coordinator then adopts at merge (adoptNewTaskRows). Models the durable
// half of the proposal: the row rides the branch and lands when the branch merges. `rows` are full
// markdown table lines the test supplies (so a test can introduce a valid row or a malformed/bad-dep
// one to prove the reject-and-surface path); they are inserted right after the worker's own row so
// the table stays well-formed, then committed. Kept a separate commit from the worker's own 🔍 so the
// branch tip carries both, exactly as a real worker's two edits would. The test owns the row format
// because it owns progressDoc; the fake only splices lines, staying column-layout agnostic.
function addTaskRows(cwd, task, plan, rows) {
  const p = join(cwd, progressPathFor(plan));
  const lines = readFileSync(p, 'utf8').split('\n');
  const own = lines.findIndex((l) => new RegExp(`^\\|\\s*${task}\\s*\\|`).test(l.trim()));
  const at = own >= 0 ? own + 1 : lines.length;
  lines.splice(at, 0, ...rows);
  writeFileSync(p, lines.join('\n'));
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', `${task}: propose ${rows.length} new task row(s)`, '--no-edit']);
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
//     { addRows: [line…] }   a worker introducing a new task (DESIGN §2.1): when the implementer
//                            commits its 🔍, it also commits these full PROGRESS.md table rows onto
//                            its OWN task branch, which the coordinator adopts at merge. The test
//                            supplies the row text, so it can introduce a valid new task or a
//                            malformed/bad-dep one to drive the reject-and-surface path (§2.5).
//     { lingerBusy: N }      after the worker reaches a resting stage (implemented / done / awaiting),
//                            list() reports it `busy` for N more ticks before `idle`. Models a live
//                            worker still in its turn after it dropped its report, so a test can prove
//                            the loop gates a finished worker's close on it going idle (T13 Problem B).
//     { lingerClosed: N }    after close(), the worker stays in list() for N more ticks (`busy`) before
//                            it drops off. Models a live child's close: it is fire-and-forget, and the
//                            child is listed until it exits, up to the 5 s + 5 s SIGTERM/SIGKILL
//                            escalation (platform.mjs). Lets a test prove the loop does not recount a
//                            closed-but-still-listed worker (loop.mjs closedIds).
//
// The `resurrectClosed` behaviour of the `claude --bg` days (a closed session reappearing under its old
// id as a stale registry entry) is gone with live-workers T05: a child that exited cannot come back.
export function createFakePlatform({ behaviors = {} } = {}) {
  const workers = new Map(); // id → worker record
  const inboxQueue = []; // messages from workers to the coordinator, drained by inbox()
  const spawns = []; // every spawn, for test introspection
  const closed = []; // every close, for test introspection
  const closeOpts = []; // every close with its options ({ id, immediate })
  const removed = []; // every remove (claude rm), for test introspection
  const sent = []; // every send: { to, text, from }, for test introspection
  const interrupts = []; // every interrupt: { to, from }
  const answers = []; // every answer: { to, requestId, result, from }
  let nextId = 0;

  function emit(w, kind, text = '') {
    inboxQueue.push({ from: w.name, task: w.task, kind, text });
  }

  // One step for one live worker. Its `stage` is where it is in its own little lifecycle; the
  // behaviour map bends the implement path into a question/conflict/crash.
  function advance(w) {
    const b = behaviors[w.task] ?? {};
    // A conflictResolve task edits a SHARED file (`mine`) instead of its own work-{task}.txt, so two
    // such tasks cut from the same base collide when the coordinator merges the second — the real
    // T22 coordinator-hit conflict. On the decision it re-integrates and rewrites the file to
    // `resolved` (§ send below), re-signalling done (DESIGN §2.5 Option 2, T28).
    const cr = b.conflictResolve;
    const implFile = cr ? cr.file : `work-${w.task}.txt`;
    const implContent = cr ? cr.mine : `work ${w.task}\n`;

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
        commit(w.cwd, w.task, w.plan, { file: implFile, content: implContent, rowState: '🔍', note: 'implemented', message: `${w.task}: implement` });
        if (b.addRows) addTaskRows(w.cwd, w.task, w.plan, b.addRows);
        emit(w, 'implemented');
        w.stage = 'implemented';
        return;
      }
      if (w.stage === 'awaiting' && w.answered) {
        commit(w.cwd, w.task, w.plan, { file: implFile, content: implContent, rowState: '🔍', note: 'implemented', message: `${w.task}: implement` });
        if (b.addRows) addTaskRows(w.cwd, w.task, w.plan, b.addRows);
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
        return;
      }
      if (w.stage === 'resolving') {
        // The coordinator hit a merge conflict on this branch, kept this worker alive, and delivered
        // the user's decision (send → stage 'resolving'). Resolve it on this branch as Option 2 says:
        // bring the current feature branch in, rewrite the shared file to the decided content, commit,
        // and re-signal done (DESIGN §2.5, T28). The coordinator's next merge then lands cleanly.
        git(w.cwd, ['merge', '--no-commit', '--no-ff', `pir/${w.plan}`]); // may leave the file conflicted
        if (cr) writeFileSync(join(w.cwd, cr.file), cr.resolved);
        git(w.cwd, ['add', '-A']);
        git(w.cwd, ['commit', '--no-edit', '-m', `${w.task}: resolve conflict per decision`]);
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
  // once idle. Mirrors the real list()'s status (busy until workerActivity says idle). Called once per
  // tick in list(), after advance, so a stage change is reflected the same observation the coordinator
  // reads it on.
  const RESTING = new Set(['implemented', 'done', 'awaiting', 'parked', 'dead']);
  function updateStatus(w) {
    if (!RESTING.has(w.stage)) {
      w.status = 'busy';
      return;
    }
    if (w.busyHold > 0) {
      w.busyHold -= 1;
      w.status = 'busy';
      return;
    }
    w.status = 'idle';
  }

  // The live worker under `id`, or null when it is closed, crashed or unknown: the real platform's
  // send / interrupt / answer to an exited worker return ok:false, and so do these.
  const liveWorker = (id) => {
    const w = workers.get(id);
    return w && w.live && w.stage !== 'closed' && w.stage !== 'dead' ? w : null;
  };

  return {
    // spawn({ cwd, name, phase, note }) → id. phase is the worker's role: "implement" | "review" | "verify".
    // `note` is the text appended to the opening instruction (DESIGN §2.4), recorded for tests.
    // The name is built by the loop with naming.mjs; the task is recovered from it here so list()
    // reports it and the loop can rebuild assignments from names alone (DESIGN §2.8).
    spawn({ cwd, name, phase, note = null }) {
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
        pid: 10000 + nextId,
        busyHold: b.lingerBusy ?? 0,
      };
      workers.set(id, w);
      spawns.push({ id, name, task: parsed.task, role: phase, cwd, note });
      return id;
    },

    // send(id, text, { from }) → { ok }. A message into the worker's input (platform.mjs send). Any
    // message un-parks a worker awaiting an answer to its question, as the person's reply does (DESIGN
    // §2.5).
    send(id, text, { from = 'pir' } = {}) {
      sent.push({ to: id, text, from });
      const w = liveWorker(id);
      if (!w) return { ok: false };
      if (w.stage === 'awaiting') w.answered = true;
      // A worker parked on a coordinator-hit merge conflict (it had already reported done, so it is a
      // review-role session at stage 'done') receives the user's decision and moves to resolve it on
      // its own branch, re-signalling done (DESIGN §2.5 Option 2, T28). Only conflictResolve tasks have
      // a resolution to run; any other done worker ignores a late message, as a real one would.
      if (w && w.role === 'review' && w.stage === 'done' && behaviors[w.task]?.conflictResolve) {
        w.stage = 'resolving';
        w.busyHold = 0;
      }
      return { ok: true };
    },

    // interrupt(id, { from }) → { ok }. Recorded only: the fake's workers have no turn to cut short.
    interrupt(id, { from = 'person' } = {}) {
      interrupts.push({ to: id, from });
      return { ok: !!liveWorker(id) };
    },

    // answer(id, requestId, result, { from }) → { ok }. Recorded only: the fake's workers raise no
    // permission requests, so there is never one pending to resolve beyond a live worker accepting it.
    answer(id, requestId, result, { from = 'person' } = {}) {
      answers.push({ to: id, requestId, result, from });
      return { ok: !!liveWorker(id) };
    },

    // list() → live workers with their state. Advances every live worker one tick first (see header).
    // Each carries the fields the real list() does, `activity` included, folded from the fake's stage.
    list() {
      for (const w of workers.values()) {
        if (!w.live) continue;
        if (w.stage === 'closed') {
          // a closed worker stays listed a few ticks before its child exits (see close()); while it
          // lingers it stays `busy` and does not advance.
          if (w.lingerClosed <= 0) w.live = false;
          else w.lingerClosed -= 1;
          continue;
        }
        advance(w);
        updateStatus(w); // reflect the new stage's busy/idle in this same observation (T13 Problem B)
      }
      return [...workers.values()]
        .filter((w) => w.live)
        .map((w) => ({
          id: w.id,
          pid: w.pid,
          name: w.name,
          cwd: w.cwd,
          status: w.status,
          state: w.status === 'busy' ? 'busy' : 'idle',
          live: true,
          task: w.task,
          role: w.role,
          activity: { state: w.status === 'busy' ? 'busy' : 'idle', pending: [] },
        }));
    },

    // close(id, opts) → stop the worker. Worker teardown only; removing the worktree and branch is the
    // worktree's job (worktree.remove), so an implementer can be closed while its reviewer keeps the
    // shared worktree (DESIGN §2.3). Safe on an already-gone id. With `lingerClosed: N` the worker is
    // stopped but stays listed for N more ticks, modelling the real close's fire-and-forget escalation
    // so a test can prove the loop does not recount it (loop.mjs closedIds). `opts` ({ immediate }) is
    // recorded for teardown tests.
    close(id, opts = {}) {
      closed.push(id);
      closeOpts.push({ id, ...opts });
      const w = workers.get(id);
      const linger = w ? behaviors[w.task]?.lingerClosed ?? 0 : 0;
      if (w && linger > 0) {
        w.stage = 'closed'; // no further advance; list() ages it out over `linger` ticks
        w.lingerClosed = linger;
        w.status = 'busy';
      } else {
        workers.delete(id);
      }
      return { ok: true };
    },

    // remove(id) → { ok }. A no-op in the real platform since live-workers T05 (a child leaves no
    // session record). RECORD-ONLY here, and it does NOT drop the worker from list(): closedIds is the
    // guarantee against a recount (loop.mjs). The loop still calls it on each normal finish path and not
    // on `halt-close` (T41), and a loop test asserts that.
    remove(id) {
      removed.push(id);
      return { ok: true };
    },

    // inbox() → drain the messages workers have sent the coordinator since the last call.
    inbox() {
      return inboxQueue.splice(0, inboxQueue.length);
    },

    // --- test introspection ---
    spawns,
    closed,
    closeOpts,
    removed,
    sent,
    interrupts,
    answers,
    _workers: workers,
  };
}
