# T03 — activity-reader

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The shell half of observing a worker from outside: a cheap fingerprint of its task worktree, and the
new bytes of its session transcript since the last read. It hands raw facts to the pure core (T01) and
decides nothing itself. `parseAgents` starts keeping `sessionId`, which the transcript lookup needs.

## Design sections this implements

DESIGN §2.2, §2.7 (git failure, transcript not found), §3.4, §3.5.

## Files

- `src/shell/platform.mjs`: add `activity()` to `createPlatform`; keep `sessionId` in `parseAgents`
  and `list()`; update the `parseAgents` comment that says sessionId is dropped on purpose.
- `src/shell/platform.test.mjs`: tests below.
- `src/shell/fake/platform.mjs`: `list()` entries gain `sessionId` and `pid`; `activity()` returns a
  scripted observation per worker (`behaviors` gains an `activity` script keyed by pass or clock).
- `src/shell/fake/platform.test.mjs` if it exists, else covered in `loop.test.mjs` by T05.

## Interface

```js
// On the object createPlatform returns. Injected: git runner, fs reads, projectsDir (default
// ~/.claude/projects) so tests point it at a temp dir.
activity({ worktreePath, sessionId, transcriptPath /* cached from last call, or null */, offset })
  → {
      fingerprint: string | null,  // null when git fails; never throws
      transcriptPath: string | null,
      text: string,                // complete lines only, from offset to the last '\n' byte
      nextOffset: number,
      transcriptFound: boolean,
    }
```

- Fingerprint: HEAD sha + `git status --porcelain=v1 -uall` + size and mtimeMs of each listed path.
  The mtimes catch a second edit to an already-dirty file, which porcelain alone does not.
- Transcript lookup: the first `<projectsDir>/*/<sessionId>.jsonl`, found once and returned so the
  caller caches it. T00 confirms the location.
- The read cuts at the last newline byte before decoding, so a UTF-8 character or a JSON line split
  across two reads is never parsed half-written.
- A shrunk file (offset past EOF) restarts from 0.

## Tests

- [ ] `parseAgents` keeps `sessionId`; `list()` returns it.
- [ ] Fingerprint on a scratch git repo: unchanged tree → same string; new file, edit of a tracked
      file, second edit of an already-dirty file, a commit → each a different string.
- [ ] git failing (not a repo) → `fingerprint: null`, no throw.
- [ ] Transcript found by globbing a temp `projectsDir`; missing → `transcriptFound: false`, text ''.
- [ ] Incremental read: two appends read as two slices with no overlap and no gap.
- [ ] A trailing partial line is held back until its newline arrives; a multibyte character split at
      the read boundary decodes correctly.
- [ ] Offset beyond a truncated file restarts at 0.
- [ ] The fake platform returns scripted observations and `sessionId`/`pid` in `list()`.

## Done when

- [ ] `platform.activity()` exists with the shape above and all listed tests pass in `npm test`.
- [ ] `parseAgents` carries `sessionId` and its comment says why.
- [ ] The fake platform can script a worker's activity over time for T05's loop tests.
