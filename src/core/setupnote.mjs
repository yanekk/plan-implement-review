// The text of the note a worker's opening instruction carries when the plan's setup step failed in
// its worktree (DESIGN §2.4). Setup failure still spawns the worker (best effort, user 2026-09-24);
// the note tells it why the worktree is not ready. The tail goes inline, not only as a path, because
// the log sits in the main checkout's control folder and reading it from a worktree may hit a
// permission prompt. Pure: the runner's result in, a string out.

// formatSetupNote({ reason, tail, logPath }, { slug }) → string. `reason` already names the failing
// line and its exit status ("`npm ci` exited 1", commands.mjs); an empty tail drops the "Last lines"
// part rather than printing a heading over nothing.
export function formatSetupNote({ reason, tail, logPath }, { slug }) {
  const parts = [`The plan's setup step failed in this worktree before you started: ${reason}.`];
  const lines = (tail ?? '').replace(/\n+$/, '');
  if (lines.trim()) {
    parts.push('Last lines of its output:');
    parts.push(lines.split('\n').map((l) => `  ${l}`).join('\n'));
  }
  parts.push(`Full output: ${logPath}`);
  parts.push(
    `Get this worktree ready (the setup lines are at the top of plans/${slug}/DESIGN.md), then carry on ` +
      'with your task.',
  );
  return parts.join('\n');
}
