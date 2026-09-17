# T09 — Self-wake spike

**Phase:** 0 · **Runs:** you · **Depends on:** — · **Weight:** light

## Goal

Settle, on this machine with a real background session, that a coordinator session which has gone
fully idle can wake *itself* on a fixed cadence — the harness's own scheduled wake, not a poll that
needs the session to keep taking turns — and on that wake re-read a control file and act (attempt a
down-send). T08's whole heartbeat rests on this, and the earlier fix failed precisely because an
idle session was assumed to keep checking and did not. The `claude` harness has scheduled-wake
mechanisms (a self-paced wake, a cron tick), but whether one reliably re-animates a `--bg`
coordinator that is otherwise doing nothing — and how a `pir-coordinate` session arms it — is not
knowable without trying it live. Throwaway; torn down after.

## Design sections this implements

DESIGN §2.8 (delivery does not depend on the coordinator staying awake). Gates T08 — the wake it
arms, the cadence its receipt/heartbeat keys on, and the skill wording that must not fall back to
the "poll while awake" approach that already failed.

## Files

None committed to the product. Any probe script goes under `$CLAUDE_JOB_DIR/tmp` or a scratch path
and is deleted. The finding goes in `FINDINGS.md`, not in a file.

## Automated checks (the worker runs these)

```
# Spawn a throwaway --bg session that arms a scheduled self-wake on a short cadence and, on each
# wake, appends a line to a scratch file — proving the wake fired while nothing else drove it.
# Leave it strictly idle: send it nothing, take no turn in it, for several cadences.
# Record, as a machine result: did the scratch file gain a line per cadence with no input? Which
# exact mechanism armed the wake (the flag / tool / skill call), verbatim, for T08's skill wording.
# Tear the scratch session down:  claude stop <id> ; claude rm <id>  and confirm
# `claude agents --json` no longer lists it.
```

## Needs a person

The one thing a machine cannot settle from the sender side is whether the *idle* session truly
re-animated on its own, rather than being nudged.

```
# The person watches the idle scratch session and confirms it woke itself on the cadence with no
# prompt, no message, and no one taking a turn in it — the wake is the harness's, not a poll riding
# on activity. If it only advances when nudged, that is the failure T08 must avoid.
```

Expect: an idle `--bg` session that re-animates itself on the cadence with no input, via a named
mechanism; and, as a control, a plain session that stays asleep with nothing to wake it.

Tell me, so it goes in `FINDINGS.md` with the date:
  1. Which exact mechanism wakes a fully idle coordinator on a cadence (the flag / tool / skill
     call, verbatim, for T08's heartbeat wording).
  2. The shortest cadence that fires reliably, and whether a wake reliably runs an action (a
     re-read plus a send attempt) or only re-enters the session.

## Done when

- The mechanism that wakes an idle `--bg` session on a cadence is known and written into
  `FINDINGS.md` with the date, verbatim — or, if none does, that is recorded and T08's approach is
  reconsidered with the user before T08 is built.
- The scratch session is torn down and `claude agents --json` confirms it is gone.
