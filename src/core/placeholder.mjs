// Placeholder so src/core/ exists as a real, scannable directory from T01.
// The pure modules land here in later tasks: progress.mjs (T02), dispatch.mjs (T03),
// parallelism.mjs (T04), naming.mjs. Nothing in this directory may reach for a clock,
// a random number, I/O, a process or the network — src/core/boundary.test.mjs enforces
// that on every run. Delete this file once a real core module exists.
export const CORE_IS_PURE = true;
