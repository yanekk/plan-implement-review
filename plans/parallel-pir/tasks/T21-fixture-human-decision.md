# T21 — Live fixture: human-decision

**Phase:** 6 · **Depends on:** T17 · **Weight:** medium · **Runs:** you

## Goal

Run the `human-decision` scenario for real and get an all-green fact report. An underspecified task doc
makes a real worker **ask** rather than guess; the coordinator surfaces the question, you answer it, the
answer is delivered down, and the worker resumes and promotes.

## Run

```
node src/shell/harness/run.mjs human-decision
```

**Needs you mid-run.** When the coordinator surfaces the question, answer it — append one JSON line to
`$S/plans/human-decision/.parallel/control/answers`:

```
{"task":"T01","text":"<the decision, in the worker's terms>"}
```

(or reply through the coordinator session). `$S` is the scratch dir the runner printed. See
`TEST-HARNESS.md § human-decision`.

## Facts it must show (all green)

- `question-round-trip:T01` — a question was surfaced and the answer reached the worker before it
  resumed.
- `one-merge-to-main` — `main` gains exactly one commit, the promotion.

## Done when

The fact report is `PASS`. Record the verdict and bundle path in `FINDINGS.md` with the date. A failed
fact is a finding — diagnose from the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
