// The dashboard model (DESIGN §2.3, §2.6, §2.7, §3.1, §3.2). Two pure things, kept apart on purpose:
// `buildDashboard` projects the resolved run views into the list (rows + counts the front-end paints),
// and `dashboardReducer` is the navigation state machine — list/watch, the Esc semantics, and the
// two-press stop/remove confirm. Neither reads a clock, a file or a process: the run states arrive
// already resolved by classifyRun (T01, src/core/runstate.mjs), so every rule a person could check —
// which run opens, when the confirm is armed, that a running run cannot be removed — is tested in
// milliseconds, not judged by eye (DESIGN §2.3's reason for the model/reducer split; it mirrors the
// display.mjs / render.mjs split the coordinator already uses).
//
// The two-press chords match `claude agents` (DESIGN §2.6, §2.7): Ctrl+S twice stops a running run,
// Ctrl+X twice removes a non-running one. The first matching press arms a confirmation; the second
// identical press (same action, same run) carries it out; any other event cancels the arm. Both are
// irreversible in the moment — stop kills in-flight work, remove drops the record — so the guard is
// deliberate, not friction.

// A run can be stopped only while running, and removed only while NOT running (DESIGN §2.6, §2.7): a
// running run must be stopped before its record can be cleared. These two predicates are the whole of
// "which chord is live on which run", and they are what the tests pin.
const CHORD = {
  ctrlS: { action: 'stop', eligible: (state) => state === 'running' },
  ctrlX: { action: 'remove', eligible: (state) => state !== 'running' },
};

// buildDashboard(views) → { rows, counts } (DESIGN §2.3).
//
//   views: [{ slug, state, repo, progress:{done,total}, workers }]
//     state — one of classifyRun's four: 'running' | 'finished' | 'stopped' | 'crashed' (T01). A view
//             may carry some other state (e.g. an unreachable stale entry, §2.8); it still counts in
//             `total` but not in any of the four named tallies.
//   rows   — the same views, in input order. The front-end paints them; order is the caller's, not ours.
//   counts — { running, finished, crashed, stopped, total }. `total` is every view; the four named are
//            tallies of the matching state, so the counts line can colour running green and crashed red.
export function buildDashboard(views = []) {
  const counts = { running: 0, finished: 0, crashed: 0, stopped: 0, total: views.length };
  for (const v of views) {
    // Only the four named states have a tally; an unknown state contributes to `total` alone.
    if (Object.prototype.hasOwnProperty.call(counts, v.state) && v.state !== 'total') counts[v.state] += 1;
  }
  // Rows preserve input order (a shallow copy so a caller mutating the array later cannot reorder ours).
  return { rows: [...views], counts };
}

// The navigation state the reducer owns. `view` is which block is on screen; `sel` is the highlighted
// row index in the list; `openSlug` is the run the watch view is showing; `armed` is the pending
// confirm, null unless a chord's first press has landed.
export function initialUi() {
  return { view: 'list', sel: 0, openSlug: null, armed: null };
}

// dashboardReducer(ui, event, views) → { ui, intent } (DESIGN §2.3, §2.6, §2.7).
//
//   ui    = { view:'list'|'watch', sel, openSlug, armed }
//           armed: null | { action:'stop'|'remove', slug }
//   event = { type, ... }:
//     {type:'down'} {type:'up'}     move selection, clamped to the list ends
//     {type:'select', index}        set selection (a click)
//     {type:'open'}                 list → watch on the selected run
//     {type:'back'}                 watch → list; list → intent {type:'quit'}
//     {type:'ctrlS'}                arm/confirm stop on the selected (list) or open (watch) run
//     {type:'ctrlX'}                arm/confirm remove on the selected run
//   views — the current resolved views (the output of buildDashboard's `rows`, or anything carrying
//           {slug, state} per row). Passed rather than held so the reducer stays a pure function of its
//           inputs and never caches run data (DESIGN §2.3): it needs the length to clamp `sel` and the
//           selected/open row to read the target run's slug and state. This third argument is the one
//           addition to the interface sketch, which the task's own rule ("it takes the current views")
//           calls for.
//   intent = null | {type:'quit'} | {type:'stop', slug} | {type:'remove', slug}
//
// The one invariant across every branch: any event other than the second half of a chord clears `armed`
// first (DESIGN §2.6). So a stray keystroke — even a move onto another row — cancels a pending confirm,
// which is why an intervening `down` between two Ctrl+S presses re-arms from scratch rather than firing.
export function dashboardReducer(ui, event, views = []) {
  const len = views.length;
  switch (event?.type) {
    case 'down':
      return { ui: { ...ui, sel: clamp(ui.sel + 1, len), armed: null }, intent: null };
    case 'up':
      return { ui: { ...ui, sel: clamp(ui.sel - 1, len), armed: null }, intent: null };
    case 'select':
      return { ui: { ...ui, sel: clamp(event.index, len), armed: null }, intent: null };
    case 'open':
      // Only the list opens a run; from watch, `open` has nothing new to open, so it just clears the arm.
      if (ui.view !== 'list') return { ui: { ...ui, armed: null }, intent: null };
      return { ui: { ...ui, view: 'watch', openSlug: views[ui.sel]?.slug ?? null, armed: null }, intent: null };
    case 'back':
      // Esc steps back one level: watch → list (no confirm), and list → quit `pir` outright (DESIGN §2.3:
      // quitting stops nothing, so there is no confirm here — the confirms are on stop/remove only).
      if (ui.view === 'watch') return { ui: { ...ui, view: 'list', openSlug: null, armed: null }, intent: null };
      return { ui: { ...ui, armed: null }, intent: { type: 'quit' } };
    case 'ctrlS':
    case 'ctrlX':
      return chord(event.type, ui, views);
    default:
      // An unrecognised event is inert but still cancels a pending confirm (the invariant above): a key
      // the dashboard does not bind must not leave a stale armed line waiting to be completed by chance.
      return { ui: { ...ui, armed: null }, intent: null };
  }
}

// Clamp an index into a list's valid row range; an empty list pins to 0 so `sel` is always a real slot.
function clamp(i, len) {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

// A Ctrl+S / Ctrl+X press. Resolve the run it acts on, check the chord is live on that run's state, then
// either arm (first press), fire the intent (second identical press) or cancel (ineligible run).
function chord(type, ui, views) {
  const { action, eligible } = CHORD[type];
  // Stop targets the OPEN run while watching (DESIGN §2.6 — you can stop a run from inside its live view),
  // otherwise the selected row. Remove is a list action and always targets the selected row.
  const target =
    action === 'stop' && ui.view === 'watch'
      ? views.find((v) => v.slug === ui.openSlug)
      : views[ui.sel];

  // Ineligible — no such run, or the chord does not apply to its state (Ctrl+S on a non-running run,
  // Ctrl+X on a running one): no arm, no intent, and any pending confirm is cleared (DESIGN §2.6, §2.7).
  if (!target || !eligible(target.state)) {
    return { ui: { ...ui, armed: null }, intent: null };
  }

  // Second identical press (same action, same run) carries the confirm out and disarms.
  if (ui.armed && ui.armed.action === action && ui.armed.slug === target.slug) {
    return { ui: { ...ui, armed: null }, intent: { type: action, slug: target.slug } };
  }

  // First matching press arms the confirmation line for that exact run.
  return { ui: { ...ui, armed: { action, slug: target.slug } }, intent: null };
}
