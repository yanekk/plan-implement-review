# T00 — Messaging-mode spike

**Phase:** 0 · **Runs:** you · **Depends on:** — · **Weight:** light

## Goal

Settle, on this machine with real sessions, the exact way to spawn a worker that accepts the
coordinator's cross-session messages without a person approving each one, and whether the sender
can observe that a message was delivered. The engine's worker spawn and the coordinator's
receipt loop both ride on this, and neither can be built on a guess: `claude --help` lists
permission-mode flags but does not say whether any of them auto-accepts cross-session message
*delivery*, which is a separate gate from tool permissions. Throwaway; deleted after.

## Design sections this implements

DESIGN §2.6 (a worker accepts messages without a person) and §2.5 (a decision is confirmed
received). It gates T01 (the spawn flag) and the receipt-loop wording in T05.

## Files

None committed to the product. Any probe script goes under `$CLAUDE_JOB_DIR/tmp` or a scratch
path and is deleted. If it is useful to keep the exact findings, they go in `FINDINGS.md`, not in
a file.

## Automated checks (the worker runs these)

```
# The worker spawns two throwaway sessions and drives the exchange as far as a machine can:
# 1. Spawn a candidate worker with the flag under test, e.g.
#      claude --bg -n "scratch · probe · T00 · verify" --permission-mode bypassPermissions "<noop instruction>"
#    (also try --dangerously-skip-permissions, and a plain spawn as the control).
# 2. From a second session, SendMessage to that worker by its `·` name.
# 3. Record, for each candidate: did the send return ok? what did the result text say about
#    delivery ("queued", a delivery notice, an approval requirement)?
# The worker records the observed send result text verbatim for each candidate — that is a
# machine result, separate from the person's judgement below.
# Tear the scratch sessions down:  claude stop <id> ; claude rm <id>  for each, and confirm
# `claude agents --json` no longer lists them.
```

## Needs a person

The one thing a machine cannot see is whether the *receiving* worker put up an approval prompt
or acted straight away — that is on the worker session's own screen, not in the sender's result.

```
# With the candidate worker spawned and a message sent to it, the person looks at the
# receiving worker session and reports whether it prompted for approval or accepted the
# message and acted on it with no prompt. Repeat for each candidate flag until one accepts
# with no prompt.
```

Expect: one permission-mode flag under which the receiving worker accepts the message and acts
with no approval prompt, and a plain spawn (the control) that requires approval.

Tell me:
  1. Which exact `claude` flag makes the worker accept a cross-session message with no approval
     prompt (the flag string, verbatim, for T01's `spawnArgv`).
  2. Whether the sender saw any delivery/receipt notice it could key on, and its exact wording
     (for T05's receipt loop). If none is observable, say so — T05 then keys on the absence.

## Done when

- The flag that makes a worker auto-accept messages is known and written into `FINDINGS.md` with
  the date, verbatim.
- Whether a receipt notice is observable, and its wording, is written into `FINDINGS.md`.
- The scratch sessions are torn down and `claude agents --json` confirms they are gone.
