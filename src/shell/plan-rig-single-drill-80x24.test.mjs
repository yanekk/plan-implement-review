// The single-run drill's scenario tests at 80×24 (single-runs T11): in its own file, like the conversation
// rig's sizes, so node --test runs the sizes side by side. The test bodies are in plan-rig-single-drill-helpers.mjs.

import { defineSingleDrill } from './plan-rig-single-drill-helpers.mjs';

defineSingleDrill([80, 24]);
