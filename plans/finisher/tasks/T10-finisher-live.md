# T10 — finisher-live

**Phase:** 3 · **Depends on:** T08, T09 · **Weight:** light

## Goal

Prove a real finisher on a throwaway repo: a real Claude session reads the rules, looks, writes its
steps, and waits; the person gives the go from the phone; it merges and reports done; the run ends. The
only part no tool reaches is the phone.

## Design sections this implements

DESIGN §2.7 (the phone path), §2.9, §5.1.

## Files

- `src/shell/harness/`: a `finisher-live` scenario: a scratch repo `/tmp/pir-finisher-live` with a
  one-task plan whose build is already green, a `.pir/rules/on-finish.md` saying "merge into main and
  write a file FINISHED in the main checkout", and the run started with the agent on.

## Environment (the worker owns this)

```
perl -e 'alarm 900; exec @ARGV' node src/shell/harness/run.mjs finisher-live --into /tmp/pir-finisher-live
rm -rf /tmp/pir-finisher-live    # teardown; confirm it is gone, and that this repo's main did not move
```

## Automated checks (the worker runs these)

```
# before the go: main in the scratch repo has not moved, FINISHED absent, the finisher's phase awaiting-go
# after the go: git -C /tmp/pir-finisher-live merge-base --is-ancestor pir/<slug> main; FINISHED present;
# the ledger has a go line by: phone; the run finished by: finisher
```

## Outside actions

- Real finisher session — `worker` (DESIGN §5.3)
- ntfy alert — `worker` (DESIGN §5.3)

## Needs a person

```
The run is waiting in /tmp/pir-finisher-live. On your phone:
  1. the alert "<slug> · ready for your go" should arrive; tap it
  2. in the Claude app, read the steps and answer the Go question with "Go"
```

Expect: the finisher's chat opens from the alert; after Go, a "<slug> · finished" alert arrives.
Tell me: did the ready alert open the finisher's chat, and did the finished alert arrive?

## Done when

- [ ] The automated checks pass after the person's phone go; FINDINGS has a dated ✅ row.
- [ ] Teardown done; this repo's `main` unchanged by the check.
