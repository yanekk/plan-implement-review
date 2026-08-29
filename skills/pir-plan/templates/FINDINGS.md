# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the *entire* record that something was seen
working for real.

**Newest first. Forty words a row, counted, not estimated.** The long version is already in
the commit message that carried the fix. This is the index, not the account.

**What goes here:** what the next session would otherwise rediscover · what you noticed and
left alone under the scope rule · every answer that came back from the user's own hands, dated.

**What does not:** a decision and its reasoning (that is the commit message) · anything the
code or a test now states for itself · a restatement of the row above.

## Writing a row

Flat prose. At most one bold phrase in a row, and none is better. No em-dash asides, no
clause that is there to sound right. If a row reads like it is arguing a case, it is too long.

> 🐞 `DRY_RUN=1` was ignored on an already-connected slug: the repair branch is decided above
> the dry-run check, so it opened a real browser. Fixed in review, +4 tests.

Thirty-two words, and it is a whole finding — what broke, why, and what happened about it.

## Keeping it short

**Whoever appends, compacts.** Before adding a row, if this file is over 60 rows or 15 KB,
spend two minutes shrinking it. That is the only maintenance it gets, and it is what stops
this file becoming the one nobody reads.

- **Merge** rows that are one lesson learned twice.
- **Drop** a row whose lesson is now enforced by code, by a test, or by a rule in `DESIGN.md`,
  and name where it went. The test is the better record.
- **Never drop a ✅ row or its date.** Shorten it; never lose it. `CLAUDE.md` makes this file
  the only record that anything was ever seen working for real.
- **Never drop what somebody would grep for** — the flag, the error string, the path.

**Promotion is a move, not a copy.** When a finding binds every session rather than one task
it goes to the project's traps list in `CLAUDE.md` as **one line** — the rule, without its
rationale — and the row here becomes a pointer to it. Two copies both grow, and that list is
loaded into every session whether or not it touches the thing.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| | | |
