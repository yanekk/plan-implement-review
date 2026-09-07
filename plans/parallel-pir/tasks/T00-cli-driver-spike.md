# T00 — CLI driver spike: create, drive, close a worker

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Prove, on this machine and seatbelted, that the `claude` CLI can be driven the way the worker
lifecycle needs: spawn a background worker in a specific worktree and get a usable id back,
send it a turn that it acts on, reset it to fresh context for its own review, and close it
cleanly. These are the load-bearing unknowns behind the whole down-channel and worker
lifecycle; if any answer differs from the help text the architecture bends, so this is checked
before anything is built on it. Throwaway code, deleted when its findings are written.

## Design sections this implements

Probes the claims in DESIGN §2.2 (immediate down-channel), §2.3 (create / drive / close), and
the gotchas recorded in FINDINGS.md. Gates T10 and T11.

## Files

A throwaway `spikes/cli-driver/` directory (a shell script and a scratch plan), deleted after
its findings land in FINDINGS.md. Nothing under `src/` and nothing in the real plan.

## Interface

The four questions to answer, each with the command probed and the observation recorded:

```
1. spawn-in-worktree:  git worktree add <scratch> ; claude --bg --add-dir <scratch> \
                       -p "<trivial task>"  (cwd in the worktree)  → returns a usable id?
2. drive:              claude --resume <id> -p "<a turn>"  → worker acts on it and persists?
                       And what happens when the worker is mid-task — queued, ignored, or a copy?
3. fresh context:      how does the worker reset for review — is "/clear" drivable via
                       --resume -p, or is a second session on the same worktree the real path?
4. close:              claude stop <id> ; claude rm <id>  → session gone, worktree removed?
                       claude agents --json no longer lists it?
```

Each answer is a finding. The down-channel answer (2) decides whether T11 uses `--resume -p`
or the attach-injection fallback; the fresh-context answer (3) decides whether a worker is one
session driven twice or two sequential sessions on one worktree.

## Tests

This is a spike, so its evidence is the recorded observation, not the project test command.
The scratch plan and scratch repo are the seatbelt; no real paid long-running agent and no
real branch is touched.

- [ ] Each of the four questions has a written answer in FINDINGS.md, dated.
- [ ] Every spawned scratch worker is closed and every scratch worktree removed before the
      task ends — `claude agents --json` and `git worktree list` are clean.

## Done when

- [ ] All four questions answered on the machine, and the down-channel and fresh-context
      answers stated plainly enough that T10 and T11 can be designed from them.
- [ ] The spike directory and every scratch artifact are deleted; findings are in FINDINGS.md.

## Needs a person

This spawns live agents, so a person runs it and watches. Seatbelt: a scratch git repo and a
throwaway one-line "task", the worker ceiling irrelevant because only one is spawned, and every
session closed at the end.

```
# in a scratch repo, not the real project:
git worktree add /tmp/pir-spike-wt -b pir-spike
cd /tmp/pir-spike-wt
id=$(claude --bg -p "write the word ok to a file called out.txt")   # note the id printed
claude agents --json                                                # is it listed, cwd correct?
claude --resume "$id" -p "now write the word done to out.txt"       # does it act on it?
claude stop "$id" ; claude rm "$id"                                 # does it close?
git worktree remove /tmp/pir-spike-wt --force ; git branch -D pir-spike
```

Expect: an id back from `--bg`; the worker acting on the resumed turn; a clean close.
Tell me: for each of the four questions, what actually happened — especially whether the
resumed turn was acted on or started a copy, and how a fresh-context reset is really done.
