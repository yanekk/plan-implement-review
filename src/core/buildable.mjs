// buildable.mjs — which plans the box offers after `@repo/start` (box-commands DESIGN §2.3).
//
// A plan is offered when `pir start` would build or resume it: PROGRESS.md says reviewed, DESIGN.md has a
// valid setup/test block (without one the engine counts the plan as not reviewed, declared-test-command
// §2.3), and there is at least one task and at least one not ✅. Pure: the texts arrive as parameters,
// and finding them on disk or on pir/* branches is shell/plan-scan.mjs's job.

import { parseProgress } from './progress.mjs';
import { parseTestBlock } from './testblock.mjs';

// buildablePlan({ progress, design }) → { done, total } | null
// progress and design are the files' texts, or null when a file is absent.
export function buildablePlan({ progress, design } = {}) {
  if (typeof progress !== 'string' || typeof design !== 'string') return null;
  const { planReviewed, tasks } = parseProgress(progress);
  if (!planReviewed.reviewed) return null;
  if (!parseTestBlock(design).ok) return null;
  const total = tasks.length;
  const done = tasks.filter((t) => t.state === '✅').length;
  if (total < 1 || done >= total) return null;
  return { done, total };
}
