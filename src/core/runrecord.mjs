// The shape of one run's entry in the cross-repo index, and the pure parse/serialize for it
// (DESIGN §2.8, §3.5). An entry is a pointer to a run plus enough to classify it without opening
// its repo: the slug, the repo and its path, the control-folder path, the process number and the
// launch time captured at start, and the final status once the run records one. `pir` from any
// directory reads every entry under `~/.pir/runs/` to enumerate runs across repos, then reads each
// run's own snapshot for live detail. This module owns only the format and its validation; where
// the files live and how they are written is the store (T06, src/shell/index-store.mjs). Pure: no
// clock, no fs, no process — text in, struct or text out, enforced by boundary.test.mjs (DESIGN §3.1).
//
// Why parseRecord returns null rather than throwing on anything malformed (DESIGN §2.10): the
// dashboard parses every entry it finds, and one corrupt or half-written pointer must drop only
// itself and let the rest list — a throw here would blind `pir` to every other run. So every
// rejection, from non-JSON text to a missing field to a wrong type, is a null, never an exception.
//
// Why pid and startTime are both required (DESIGN §2.2, §3.3): classifyRun (T01) tells a live run
// from a reused process number by comparing the launch time it recorded against the live one, so an
// entry that carries a pid but no startTime could not be classified — it is not a valid pointer.

// The current index-entry format number. A record whose version is anything else — an older format,
// or a future one — parses to null rather than being read under today's field assumptions (DESIGN
// §2.10: an old format is ignored, not mis-read into a wrong run state).
const RECORD_VERSION = 1;

// The two final statuses a run may record. A run with no final status is still live-or-crashed and
// classifyRun decides which; these are the only values finalState may hold besides null (DESIGN §2.2).
const FINAL_STATES = new Set(['finished', 'stopped']);

// The required string fields, each of which must be a present, non-empty string for a valid parse.
// pid (a number) and finalState (an enum-or-null) are validated separately below.
const REQUIRED_STRINGS = ['slug', 'repo', 'repoPath', 'controlDir', 'startTime', 'branch'];

// serializeRecord(record) → canonical JSON text.
// Writes the fields in a fixed order with the three optional fields filled to null when absent, so a
// serialize→parse round-trip is symmetric and two equal records serialize identically. Trailing
// newline for a tidy file; JSON.parse ignores it on the way back. Does not validate — the store
// hands it a record it built, and parseRecord is where a value read off disk is checked.
export function serializeRecord(record) {
  const canonical = {
    version: record.version ?? RECORD_VERSION,
    slug: record.slug,
    repo: record.repo,
    repoPath: record.repoPath,
    controlDir: record.controlDir,
    pid: record.pid,
    startTime: record.startTime,
    startedAt: record.startedAt ?? null,
    branch: record.branch,
    finalState: record.finalState ?? null,
    updatedAt: record.updatedAt ?? null,
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}

// parseRecord(text) → record | null.
// Parses one index entry's text and validates it, returning the canonical record on success and null
// on anything malformed — non-JSON, the wrong top-level type, a wrong or absent version, a missing or
// mistyped required field, a bad pid, or a finalState outside the allowed set. Never throws on any
// string input (DESIGN §2.10 / task Done-when). The returned record always carries all fields, with
// finalState, startedAt and updatedAt defaulted to null when the entry omitted them, so a reader gets
// one predictable shape. Extra unknown fields on the entry are ignored, not rejected, so a newer
// writer that adds a field does not break an older reader.
export function parseRecord(text) {
  if (typeof text !== 'string') return null;

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  // Must be a plain object: an array, a number, a string or null JSON is not an entry (DESIGN §2.10).
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  // Version gate first, before any field is read under this format's assumptions.
  if (data.version !== RECORD_VERSION) return null;

  for (const key of REQUIRED_STRINGS) {
    if (typeof data[key] !== 'string' || data[key] === '') return null;
  }

  // pid is a process number: a positive integer. A float, a string or a missing pid cannot be
  // classified against a live process (DESIGN §3.3), so it fails the parse.
  if (!Number.isInteger(data.pid) || data.pid <= 0) return null;

  // finalState: null when absent; otherwise strictly one of the allowed final statuses. A value
  // outside the set (a stray 'running', a number) invalidates the whole entry rather than being
  // coerced, so a reader never sees a final status the design does not define.
  const finalState = data.finalState ?? null;
  if (finalState !== null && !FINAL_STATES.has(finalState)) return null;

  // The ISO timestamps are optional; a present value must be a string, an absent one defaults to null.
  const startedAt = optionalString(data.startedAt);
  if (startedAt === INVALID) return null;
  const updatedAt = optionalString(data.updatedAt);
  if (updatedAt === INVALID) return null;

  return {
    version: RECORD_VERSION,
    slug: data.slug,
    repo: data.repo,
    repoPath: data.repoPath,
    controlDir: data.controlDir,
    pid: data.pid,
    startTime: data.startTime,
    startedAt,
    branch: data.branch,
    finalState,
    updatedAt,
  };
}

// Sentinel distinguishing "optional field present but the wrong type" (invalidates the record) from
// "absent" (defaults to null). A plain null return could not tell the two apart.
const INVALID = Symbol('invalid');

// An optional string field: absent (undefined/null) → null; a string → itself; anything else → INVALID.
function optionalString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return INVALID;
  return value;
}
