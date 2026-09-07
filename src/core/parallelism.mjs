// analyzeParallelism — the width report the planner shows at the plan checkpoint (DESIGN
// §2.7, §3.2). Given the parsed task list with its dependencies and Runs markers, it says
// how parallel a plan actually is: the longest dependency chain, the widest set of tasks
// that could run at once, and how many tasks are auto versus you. A pure function of the
// task list — no clock, no filesystem — so the report is proven in the test run (§3.1).
//
// maxWidth is the largest topological layer, not the true maximum antichain. Layer width is
// cheap, deterministic, and good enough to tell a wide plan from a chain (a long thin chain
// has maxWidth 1); the report's job is to inform the user, not to schedule the run (§2.7).

// The longest chain of dependencies ENDING at a task, counted in tasks: a root is 1, and
// anything else is one more than the deepest task it depends on. Memoised, and guarded
// against a dependency cycle so a malformed graph reports rather than recurses for ever.
// An unknown dependency (not in the list) and a cycle back-edge both contribute nothing to
// the depth — the errors array is where they are surfaced, so neither is silently a root.
function computeDepths(tasks, byNum, errors) {
  const depth = new Map();
  const onStack = new Set();

  function depthOf(num) {
    if (depth.has(num)) return depth.get(num);
    if (onStack.has(num)) {
      // A back-edge: this task is already being resolved further up the stack, so following
      // it would loop. Report the cycle and break it by treating the edge as depth 0.
      errors.push(`task ${num} is part of a dependency cycle`);
      return 0;
    }
    onStack.add(num);
    let deepestDep = 0;
    for (const dep of byNum.get(num).deps) {
      // An unknown dep is already reported by the caller; it contributes 0 here.
      if (byNum.has(dep)) deepestDep = Math.max(deepestDep, depthOf(dep));
    }
    onStack.delete(num);
    const value = deepestDep + 1;
    depth.set(num, value);
    return value;
  }

  for (const t of tasks) depthOf(t.num);
  return depth;
}

// analyzeParallelism(tasks) → { criticalPathLength, maxWidth, autonomousCount, humanCount,
//   totalTasks, errors }.
// tasks: [ { num, deps, runs } ] as parseProgress yields them. errors names any dependency
// that points at no task in the list and any cycle, so the width numbers are never quietly
// computed over a broken graph. An empty list yields zeroes and no error.
export function analyzeParallelism(tasks) {
  const totalTasks = tasks.length;
  const autonomousCount = tasks.filter((t) => t.runs === 'auto').length;
  const humanCount = tasks.filter((t) => t.runs === 'you').length;
  const errors = [];

  if (totalTasks === 0) {
    return { criticalPathLength: 0, maxWidth: 0, autonomousCount, humanCount, totalTasks, errors };
  }

  const byNum = new Map(tasks.map((t) => [t.num, t]));

  // Report every dependency that names a task not in the list. Reported once here rather
  // than inside the depth walk, so a dep shared by several tasks is not counted many times.
  for (const t of tasks) {
    for (const dep of t.deps) {
      if (!byNum.has(dep)) {
        errors.push(`task ${t.num} depends on ${dep}, which is not in the task list`);
      }
    }
  }

  const depth = computeDepths(tasks, byNum, errors);

  // criticalPathLength is the deepest task; maxWidth is the largest group of tasks that share
  // a depth — the tasks in one layer depend on nothing in that same layer, so all of them
  // could, in principle, run at once (DESIGN §2.7).
  let criticalPathLength = 0;
  const layerSize = new Map();
  for (const t of tasks) {
    const d = depth.get(t.num);
    criticalPathLength = Math.max(criticalPathLength, d);
    layerSize.set(d, (layerSize.get(d) || 0) + 1);
  }

  let maxWidth = 0;
  for (const size of layerSize.values()) maxWidth = Math.max(maxWidth, size);

  return { criticalPathLength, maxWidth, autonomousCount, humanCount, totalTasks, errors };
}
