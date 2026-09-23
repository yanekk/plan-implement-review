// The project's test command, read out of the plan's DESIGN.md (§ Environment, "The test command.").
// The feature-branch gate at the end of a parallel run runs it (loop.mjs, runTests). It used to run a
// hard-coded `npm test`, which on a project without a package.json (a Swift app on `make test`, a
// suite of run.sh scripts) exited 254 before any test ran, so nearly every non-Node run finished red
// with tests that pass by hand. The command is whatever the plan named; the engine assumes no stack.
//
// testCommandFrom(designText) → string[] | null. The command lines of the first fenced block that
// follows a line mentioning "test command(s)", before the next heading. The template writes
// "**The test command.**" then a fence, but real plans phrase it freely ("The test command is
// unchanged:", "**The test commands.**") and some carry several lines (one per suite), so any mention
// qualifies and every line of the block is a command. A mention whose section has no fence (the
// "5.1 What the test command cannot reach" heading, a prose aside) is skipped, not fatal. Blank lines
// and whole-line `#` comments are dropped; a trailing `# note` stays, since the shell ignores it.
// null when no block is found: the caller reports that as its own reason, never as failing tests.
// Pure text in, list out — the file read lives in the shell (boundary.test.mjs).
export function testCommandFrom(designText) {
  const lines = String(designText ?? '').split('\n');
  const FENCE = /^\s*(```|~~~)/;
  const HEADING = /^\s*#{1,6}\s/;
  const MENTION = /\btest commands?\b/i;

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !MENTION.test(lines[i])) continue;

    // Look forward from the mention for a fence, giving up at the next heading.
    for (let j = i + 1; j < lines.length; j++) {
      if (HEADING.test(lines[j])) break;
      if (!FENCE.test(lines[j])) continue;
      const commands = [];
      for (let k = j + 1; k < lines.length && !FENCE.test(lines[k]); k++) {
        const line = lines[k].trim();
        if (line && !line.startsWith('#')) commands.push(line);
      }
      if (commands.length) return commands;
      break;
    }
  }
  return null;
}
