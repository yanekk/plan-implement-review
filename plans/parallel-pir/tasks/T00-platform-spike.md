# T00 — Platform primitives spike: spawn, message, fresh review, close

**Phase:** 0 · **Depends on:** — · **Weight:** medium · **Runs:** you

## Goal

Confirm on this machine and this `claude` version that the platform primitives behave the way
the survey (FINDINGS.md) says, before the worker contract and the loop are designed on them.
Four things: a background worker spawns in a given worktree and returns a usable id; a message
sent from a coordinator session to a running worker is received and acted on, and the worker can
message back; a fresh second session pointed at the worker's worktree reviews its work with no
implementer context; and close stops the session and removes the worktree. Throwaway, deleted
once its findings are written.

## Design sections this implements

Probes DESIGN §2.2 (cross-session messaging both ways), §2.3 (create / drive / close), and the
survey claims in FINDINGS.md. Gates T07 and T08.

## Files

A throwaway `spikes/platform/` directory (scripts and a scratch plan), deleted after its
findings land in FINDINGS.md. Nothing under `src/` and nothing in the real plan.

## Interface

The four questions, each with the commands probed and the observation recorded:

```
1. spawn-in-worktree: git worktree add <scratch> -b s ; (cwd=<scratch>) claude --bg -p "<task>"
                      → returns a usable id; claude agents --json shows it with cwd=<scratch>?
2. message both ways: from a coordinator session, SendMessage the worker a turn → worker acts?
                      worker SendMessage back to the coordinator → arrives in its inbox?
                      (confirm cross-session messaging is enabled headless; note any setting,
                       e.g. crossSessionInbound: accept, needed to receive.)
3. fresh review:      spawn a SECOND session (cwd=<scratch>) → does it review the 🔍 task with
                      no implementer context, and does pir-review accept it as a different session?
4. close:             claude stop <id> ; remove the worktree → session gone from agents --json,
                      worktree removed (note: claude rm removes the worktree only when clean).
```

Each answer is a finding. If any differs from the survey — most likely the messaging handshake
or a setting needed to receive inbound — that difference shapes T07 and T08.

## Tests

A spike, so its evidence is the recorded observation, not the project test command. The scratch
plan and scratch repo are the seatbelt; no real long-running paid agent against a real branch.

- [ ] Each of the four questions has a written answer in FINDINGS.md, dated.
- [ ] Every scratch session is closed and every scratch worktree removed before the task ends —
      `claude agents --json` and `git worktree list` are clean.

## Done when

- [ ] All four questions answered on the machine, stated plainly enough that T07 and T08 can be
      designed from them (especially the messaging handshake and any receive-side setting).
- [ ] The spike directory and every scratch artifact deleted; findings in FINDINGS.md.

## Needs a person

This spawns live agents and exchanges live messages, so a person runs it and watches. Seatbelt:
a scratch git repo and a throwaway one-line task, one worker only, everything closed at the end.

```
# in a scratch repo, not the real project:
git worktree add /tmp/pir-spike-wt -b pir-spike ; cd /tmp/pir-spike-wt
id=$(claude --bg -p "write the word ok to out.txt, then wait for further instructions")
claude agents --json          # is it listed, cwd correct, status/state readable?
# from THIS session, message the worker (SendMessage to its id) and watch it act.
# then spawn a fresh session in the same worktree to review, then:
claude stop "$id" ; git worktree remove /tmp/pir-spike-wt --force ; git branch -D pir-spike
```

Expect: an id from `--bg`; the worker acting on a sent message and able to message back; a fresh
session reviewing cleanly; a clean close.
Tell me: for each of the four questions, what actually happened — especially whether a sent
message reached and was acted on by the running worker, and any setting needed to receive one.
