// Placeholder so src/shell/ exists as a real directory from T01.
// Everything platform-shaped lands here in later tasks: platform.mjs, worktree.mjs,
// control.mjs, loop.mjs. This is the only side of the boundary allowed to touch the
// claude CLI, git, the filesystem, the clock and the network; it executes what core
// decides. Delete this file once a real shell module exists.
export const SHELL_IS_THIN = true;
