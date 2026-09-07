# T07 — Fake agent registry + scratch-repo simulation

**Phase:** 2 · **Depends on:** T03, T04, T05, T06 · **Weight:** medium

## Goal

Build the seatbelt: a fake world that stands in for real agents and real git so the whole
dispatch loop can be exercised with zero live paid agents and no touch of the real `main`. A
fake agent registry answers spawn / drive / list / close like the real CLI would, and a scratch
git repo (or an in-memory stand-in) answers worktree create / integrate / merge / close. This is
built before any real orchestration exists, because the dangerous capability must be rehearsable
before it is real.

## Design sections this implements

DESIGN §5.2 (the `PARALLEL_DRY_RUN` seatbelt), §4 (the dry-run layer), §3.2 (the shell
interfaces these fakes mirror).

## Files

- `src/shell/fake/agents.mjs` — a fake implementing the same interface T09/T11 will give the
  real `agents.mjs`.
- `src/shell/fake/worktree.mjs` — a fake worktree/merge against a scratch repo.
- `src/shell/fake/mailboxfs.mjs` — a real-enough temp-dir mailbox using the T05 format.
- `src/shell/fake/*.test.mjs`.

## Interface

```
The fakes present exactly the shell interface the loop (T08) calls, so T08 is written once
against an interface and run against either fakes or the real shell:

  agents:   spawn(cwd, prompt) → id ; drive(id, prompt) ; list() → [{id,name,cwd,live}] ; close(id)
  worktree: create(task) → {path,branch} ; integrate(path) → {ok|conflict} ;
            merge(branch) → {ok|conflict} ; remove({path,branch})
  mailbox:  write(msg) ; list() → [Message] ; consume(id)

The fake agent, when driven, advances its assignment's phase (implementing → 🔍 → reviewing →
✅ → done) and can be scripted to raise a question or a merge conflict, so the loop's unhappy
paths are exercised without a real agent.
```

## Tests

- [ ] A fake worker driven through its phases ends at "done" and its scratch branch merges clean.
- [ ] A scripted question from a fake worker lands in the mailbox and a driven answer clears it.
- [ ] A scripted merge conflict surfaces as a `conflict` message, not a merge onto scratch main.
- [ ] `close` removes the fake worktree and the fake registry no longer lists the worker.
- [ ] The mailbox fake round-trips messages using the T05 format under a temp dir.
- [ ] With `PARALLEL_DRY_RUN=1` nothing calls a real `claude` or the real repo.

## Done when

- [ ] The three fakes present the shell interface and drive a fake task to done-and-merged.
- [ ] Question and conflict paths are scriptable and observable in the mailbox.
- [ ] `npm test` is green.
