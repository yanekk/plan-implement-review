# T10 — `pir-worker` contract skill + mailbox-post command

**Phase:** 3 · **Depends on:** T05, T00 · **Weight:** light

## Goal

The worker's rulebook, and the small command it uses to talk back. A spawned worker runs the
stock `pir-work` unchanged, but two things differ in parallel mode: when a skill says "ask the
user and wait", the worker must instead post to the mailbox and wait, because there is no
interactive user at its terminal; and when its task is reviewed clean, it must integrate `main`
and post "done". The `pir-worker` skill states this contract, and a `pir mailbox post` command
is how the worker writes a message using the T05 format. The stock skills are not modified — the
contract wraps them.

## Design sections this implements

DESIGN §2.1 (the worker's run), §2.2 (the mailbox up-channel), §2.5 (worker resolves a conflict
or escalates), the "workers run stock skills unchanged" stance in §1.

## Files

- `skills/pir-worker/SKILL.md` — the worker contract (new skill, not a change to pir-work).
- `src/shell/mailbox-post.mjs` and a `bin` entry `pir` exposing `pir mailbox post …`.
- `src/shell/mailbox-post.test.mjs`.

## Interface

```
pir mailbox post --from <id> --to coordinator --task <T##> --kind <kind> --hop <n> --body <text>
  → writes a message to plans/{slug}/.parallel/mailbox/ atomically (temp name, then rename),
    using formatMessage from T05. Prints the message id.

pir-worker SKILL.md contract:
  - run `pir-work {slug}` as normal; it implements the one task and marks it 🔍.
  - reset to fresh context (mechanism from the T00 spike) and run `pir-work {slug}` again to
    review; it marks the task ✅.
  - whenever a stock skill would "ask the user and wait", instead: `pir mailbox post … --kind
    question|decision …` and wait for an answer file, then continue.
  - on a merge conflict while integrating main: attempt resolution (you hold the task context);
    if unresolved, post --kind conflict and wait.
  - when reviewed clean: integrate main, then post --kind done.
```

The exact fresh-context step (one driven session vs two sequential sessions) is whatever T00
established; the contract points at that finding rather than guessing.

## Tests

- [ ] `pir mailbox post` writes a well-formed message the T05 parser reads back.
- [ ] The write is atomic: a reader never sees a partial file (temp-then-rename proven).
- [ ] Posting with a hop at the cap is rejected/logged per T04 (hop provenance carried).
- [ ] Bad arguments (missing --task, unknown --kind) are rejected with a clear message.

## Done when

- [ ] `pir mailbox post` produces messages the coordinator can read, written atomically.
- [ ] `skills/pir-worker/SKILL.md` states the contract and cites the T00 fresh-context finding,
      without modifying pir-work / pir-implement / pir-review.
- [ ] `npm test` is green.
