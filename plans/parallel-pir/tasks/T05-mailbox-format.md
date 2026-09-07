# T05 — Mailbox message format, parse, provenance

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

Define the mailbox message and the pure functions that read and write it: format a message to
its on-disk text, parse text back to a struct, and read its provenance so the hop-depth cap can
count. The mailbox is the worker-to-coordinator channel and the down-channel's reply carrier, so
its shape carries who it is from, who it is to, which task, the hop count and the kind. The
filesystem read and write live in the shell (T07/T09); this task is the format only.

## Design sections this implements

DESIGN §2.2 (the async mailbox), §3.2 (`mailbox.mjs`), §3.5 (message storage and the rename
discipline, whose format half is here), §2.4 (hop provenance for the cap).

## Files

- `src/core/mailbox.mjs` — `formatMessage`, `parseMessage`, `nextHop`.
- `src/core/mailbox.test.mjs`.

## Interface

```
Message = {
  id: string,            // stable, sortable (the shell supplies the timestamp/uuid)
  from: string,          // agent id, e.g. "coordinator" or "w3"
  to: string,            // agent id or "coordinator"
  task: string,          // "T05" or "" if not task-scoped
  hop: number,           // handoff depth of the chain this message belongs to
  kind: "question" | "decision" | "answer" | "done" | "conflict" | "cap" | "log",
  body: string,          // free text, may be multiline
  ts: string,            // ISO timestamp, supplied by the shell
}

formatMessage(msg) → string     // deterministic text; header fields then a body block
parseMessage(text) → Message | { error: string }   // never throws on bad input
nextHop(msg) → number           // msg.hop + 1, for a message this one causes
```

`parseMessage` must round-trip anything `formatMessage` writes, and must return an `error`
object (not throw) on a truncated or malformed file, because the shell may read a file mid-write
in the worst case and a throw there would crash the loop.

## Tests

- [ ] `parseMessage(formatMessage(m))` equals `m` for each kind, including a multiline body.
- [ ] A truncated/garbled message yields `{ error }`, not a throw.
- [ ] `nextHop` increments; provenance (from/to/task/hop) survives the round-trip.
- [ ] An empty `task` field is preserved as empty, not dropped.
- [ ] Field order and formatting are deterministic (same input, same bytes).

## Done when

- [ ] Messages round-trip losslessly and malformed input is reported not thrown.
- [ ] `mailbox.mjs` touches no filesystem; the boundary test passes.
- [ ] `npm test` is green.
