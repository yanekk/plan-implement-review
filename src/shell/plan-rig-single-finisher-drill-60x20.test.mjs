// The single-run finisher drill at 60×20 (single-finisher T08): in its own file, like the other drills'
// sizes, so node --test runs the sizes side by side. The test bodies are in plan-rig-single-drill-helpers.mjs.

import { defineSingleFinisherDrill } from './plan-rig-single-drill-helpers.mjs';

defineSingleFinisherDrill([60, 20]);
