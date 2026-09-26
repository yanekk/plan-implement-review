// The filesystem side of the cross-repo index (DESIGN §2.8, §3.5). One small JSON file per run lives
// under `~/.pir/runs/`, so `pir` from any directory can enumerate every run on the machine without
// opening its repo. This module lists, writes and removes those files; the shape of one file and its
// parse/serialize is T02's (../core/runrecord.mjs), which this module calls — it owns where the files
// live and how they are written, never the format.
//
// Two rules from DESIGN drive the mechanics:
//   - Writes are temp-then-rename within the index directory (§3.5). A rename on one filesystem is
//     atomic, so a reader listing the index mid-write sees either the old whole file or the new whole
//     file, never a half-written pointer. The temp file is named `.tmp`, not `.json`, so a writer that
//     crashes after creating it but before the rename leaves a file listRecords ignores rather than a
//     partial entry it would try to parse.
//   - listRecords never throws (§2.10). An absent directory lists as empty, and a file that is
//     malformed or half-written (parseRecord returns null) drops only itself — one corrupt pointer must
//     not blind the dashboard to every other run.
//
// fs and dir are injectable so tests drive a scratch directory with the real fs (or a fake one) and
// never touch the real `~/.pir`. In production both default to the real fs and indexDir().

import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serializeRecord, parseRecord } from '../core/runrecord.mjs';
import { writeFileAtomic } from './atomic-write.mjs';

// The default filesystem: the real node:fs calls this module needs, bundled so a caller can inject a
// fake with the same shape. Every fs use below goes through the injected object, never a bare import.
const DEFAULT_FS = {
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  unlinkSync,
};

// indexDir({ env }) → the directory holding the per-run index files, `${root}/.pir/runs`.
// $PIR_HOME overrides $HOME as the root so tests point the whole index at a scratch dir and never
// write to the real `~/.pir` (task interface, DESIGN §3.5). homedir() is the last-resort fallback if
// neither env var is set, so a caller in a stripped environment still resolves a real path.
export function indexDir({ env = process.env } = {}) {
  const root = env.PIR_HOME ?? env.HOME ?? homedir();
  return join(root, '.pir', 'runs');
}

// recordPath(repo, slug, { dir }) → the absolute path of one run's index file, `{dir}/{repo}__{slug}.json`.
// The `{repo}__{slug}` name is why the same slug in two repos never collides (§2.8): the repo name is
// part of the filename. dir defaults to indexDir() so a caller that wants the real location need not
// compute it.
export function recordPath(repo, slug, { dir = indexDir() } = {}) {
  return join(dir, `${repo}__${slug}.json`);
}

// listRecords({ dir, fs }) → every valid record in the index, in no guaranteed order.
// Reads each `*.json` file and parses it with parseRecord, keeping the ones that parse and silently
// dropping the ones that do not (malformed, half-written, wrong version). Never throws: an absent
// directory or an unreadable file yields fewer records, not an exception (DESIGN §2.10). Only names
// ending in `.json` are considered, so a leftover `.tmp` from an interrupted write is ignored.
export function listRecords({ dir = indexDir(), fs = DEFAULT_FS } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    // The directory does not exist yet (no run has ever been indexed) or is unreadable — either way
    // there is nothing to list, and that is not an error the caller should have to handle.
    return [];
  }

  const records = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let text;
    try {
      text = fs.readFileSync(join(dir, name), 'utf8');
    } catch {
      // A file that vanished between the listing and the read (a concurrent removeRecord), or is
      // unreadable, drops itself and lets the rest list.
      continue;
    }
    const record = parseRecord(text);
    if (record !== null) records.push(record);
  }
  return records;
}

// writeRecord(record, { dir, fs }) → serialize the record and write it to its index file, atomically.
// mkdir -p the directory first (the very first run creates `~/.pir/runs`), then write to a unique temp
// file in the same directory and rename it over the final path. The rename is what a concurrent reader
// sees as a single instant, so it never observes a partial entry; writing the same repo+slug again
// renames over the old file, keeping one entry per run (task tests). The temp name carries the pid and
// a random suffix so two writers in the same directory cannot collide on it, and ends in `.tmp` so it
// is never mistaken for an entry.
export function writeRecord(record, { dir = indexDir(), fs = DEFAULT_FS } = {}) {
  writeFileAtomic(recordPath(record.repo, record.slug, { dir }), serializeRecord(record), { fs });
}

// removeRecord({ repo, slug }, { dir, fs }) → delete a run's index file. Removing a run deletes its
// pointer (§3.5). Absent file is not an error: a second remove of the same run, or a remove of a run
// that was never indexed, is a no-op rather than a throw (task tests). A non-ENOENT failure (a
// permission error) is left to surface.
export function removeRecord({ repo, slug }, { dir = indexDir(), fs = DEFAULT_FS } = {}) {
  try {
    fs.unlinkSync(recordPath(repo, slug, { dir }));
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}

// readExisting(path, fs) → the parsed record at path. Throws an Error with code ENOENT when there is
// no file and EUNPARSEABLE when the file is there but not a valid entry, so a caller can tell "nothing
// to update" from "something is wrong with what is there" (coordinate.mjs maps them to its reasons).
function readExisting(path, fs) {
  const record = parseRecord(fs.readFileSync(path, 'utf8'));
  if (record === null) {
    const err = new Error(`index entry is not a valid record: ${path}`);
    err.code = 'EUNPARSEABLE';
    throw err;
  }
  return record;
}

// updateRecord({ repo, slug }, patch, { dir, fs, write }) → the record as written.
// The one read-modify-write of an index entry (plans/pir-plan-command T02, user at plan review
// 2026-09-26): read the entry, apply the patch, write it back atomically through writeRecord. The key
// fields repo and slug come from the key, never the patch, so an update can only ever rewrite the file
// it read; moving an entry is renameRecord's job. No clock here: a caller that wants an updatedAt stamp
// puts it in the patch. A missing entry throws ENOENT and an unparseable one EUNPARSEABLE — neither is
// conjured into a fresh entry. `write` defaults to this store's writeRecord into `dir`; coordinate.mjs
// passes its injected store's writeRecord so its tests keep capturing the write.
export function updateRecord(
  { repo, slug },
  patch = {},
  { dir = indexDir(), fs = DEFAULT_FS, write = (record) => writeRecord(record, { dir, fs }) } = {},
) {
  const existing = readExisting(recordPath(repo, slug, { dir }), fs);
  const record = { ...existing, ...patch, repo, slug };
  write(record);
  return record;
}

// renameRecord({ repo, from, to }, patch, { dir, fs }) → the record written under `to`.
// Moves a planning run's entry from its temporary key to its slug (DESIGN §2.6 step 4): the new record
// is the old one with slug = to and the patch applied — T07 passes { branch, controlDir, label: null }
// so the dashboard and resume read the moved branch and control folder. Refuses (EEXIST) when an entry
// under `to` already exists, leaving the source untouched, because overwriting it would silently merge
// two runs into one row. The new file is written before the old one is removed, so a crash between
// leaves two entries rather than none; listRecords keeps both and the planning program's resume
// finishes the rename (§2.6, §2.14).
export function renameRecord({ repo, from, to }, patch = {}, { dir = indexDir(), fs = DEFAULT_FS } = {}) {
  const source = recordPath(repo, from, { dir });
  const existing = readExisting(source, fs);
  const target = recordPath(repo, to, { dir });
  let taken = true;
  try {
    fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    taken = false;
  }
  if (taken) {
    const err = new Error(`index entry already exists: ${target}`);
    err.code = 'EEXIST';
    throw err;
  }
  const record = { ...existing, ...patch, repo, slug: to };
  writeRecord(record, { dir, fs });
  removeRecord({ repo, slug: from }, { dir, fs });
  return record;
}
