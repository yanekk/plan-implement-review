// The status snapshot: the shape the coordinator writes each pass and the dashboard repaints
// (DESIGN §2.4, §3.4, §3.5). A snapshot is process facts plus the run state a pass produced —
// the *same* run state the existing live display consumes — so the front-end paints it with the
// already-built `buildDisplay` model (src/core/display.mjs) and its own clock, rather than
// inventing a second display that could drift from the real one (DESIGN §2.4).
//
// This module owns the format and its validation only. It is pure: serialize is JSON out, parse
// is JSON in with a null on anything malformed, and neither touches the clock, the filesystem or
// a process. The atomic temp-then-rename write and the tolerant read are the store's (T07); the
// liveness of the `proc` this carries is the identity module's (T05). Keeping this a pure format
// module is what lets its whole validation table be checked in milliseconds (DESIGN §3.1,
// enforced by boundary.test.mjs).
//
// snap = {
//   version: 1,
//   proc: { pid, startTime, slug, repo, branch, startedAt },   // opaque here; T05 gives it meaning
//   finalState,      // 'finished' | 'stopped' | null — null (or absent) while the run is live
//   runState,        // exactly what buildDisplay(runState, { now }) consumes (display.mjs)
// }

// The one schema version this module reads and writes. A file stamped anything else is a format
// this module does not understand, so parse rejects it rather than guess (DESIGN §3.5: the
// snapshot carries a schema version). Bump this and the reader in lockstep when the shape changes.
const SCHEMA_VERSION = 1;

// The only non-null final states a run records. A live run has no final state (null); a clean end
// records 'finished' and a stop records 'stopped'. A crash records no final status at all, so it
// stays null and is classified crashed by liveness elsewhere (DESIGN §2.2, §7). Any other value in
// the file is malformed — parse rejects the whole snapshot rather than paint an unknown state.
const FINAL_STATES = new Set(['finished', 'stopped']);

// A present, plain object (not null, not an array, not a primitive). Used to gate `proc` and
// `runState`, whose absence must reject the snapshot (the interface requires both).
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// serializeSnapshot(snap) → string. Emits the canonical four-field shape, so it is symmetric with
// parseSnapshot: `finalState` is normalised to null when the run is live, and the schema version is
// stamped by the writer rather than trusted from the caller. Pretty-printed because status.json is a
// file a person may `cat` while debugging a run; the whitespace is irrelevant to the parser.
export function serializeSnapshot(snap) {
  const { proc, finalState = null, runState } = snap ?? {};
  return JSON.stringify(
    { version: SCHEMA_VERSION, proc, finalState: finalState ?? null, runState },
    null,
    2,
  );
}

// parseSnapshot(text) → snap | null. Never throws on any string: a JSON syntax error, a wrong
// top-level type, a wrong version, a missing block or an out-of-set final state all return null, so
// the store (T07) can treat a torn or foreign file as simply "no readable snapshot". On success it
// returns the canonical four-field snapshot, reconstructed rather than passed through, so a parsed
// snapshot has exactly the fields the interface names and round-trips a serialized one deep-equal.
export function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null; // not JSON at all.
  }

  if (!isObject(raw)) return null; // an array, a bare number, or JSON `null`.
  if (raw.version !== SCHEMA_VERSION) return null; // a version this reader does not understand.
  if (!isObject(raw.proc)) return null; // the process facts are required (DESIGN §3.4).
  if (!isObject(raw.runState)) return null; // the run state to paint is required (DESIGN §2.4).

  // finalState: absent or null both mean "still live"; the two named end states pass through;
  // anything else is a value this module cannot paint, so the whole snapshot is rejected.
  const finalState = raw.finalState ?? null;
  if (finalState !== null && !FINAL_STATES.has(finalState)) return null;

  return { version: SCHEMA_VERSION, proc: raw.proc, finalState, runState: raw.runState };
}
