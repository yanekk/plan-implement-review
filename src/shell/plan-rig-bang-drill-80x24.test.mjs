// The bang drill at 80×24 (bang-commands T08): in its own file so node runs the sizes side by side. The tests
// are in plan-rig-bang-drill-helpers.mjs and conversation-rig-helpers.mjs (defineBangReopenTest).

import { defineBangDrill } from './plan-rig-bang-drill-helpers.mjs';
import { defineBangReopenTest } from './conversation-rig-helpers.mjs';

defineBangDrill([80, 24]);
defineBangReopenTest([80, 24]);
