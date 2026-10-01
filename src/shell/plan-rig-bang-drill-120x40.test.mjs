// The bang drill at 120×40 (bang-commands T08): in its own file so node runs the sizes side by side. The tests
// are in plan-rig-bang-drill-helpers.mjs and conversation-rig-helpers.mjs (defineBangReopenTest).

import { defineBangDrill } from './plan-rig-bang-drill-helpers.mjs';
import { defineBangReopenTest } from './conversation-rig-helpers.mjs';

defineBangDrill([120, 40]);
defineBangReopenTest([120, 40]);
