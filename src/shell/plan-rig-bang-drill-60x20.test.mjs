// The bang drill at 60×20 (bang-commands T08): in its own file so node runs the sizes side by side. The tests
// are in plan-rig-bang-drill-helpers.mjs and conversation-rig-helpers.mjs (defineBangReopenTest).

import { defineBangDrill } from './plan-rig-bang-drill-helpers.mjs';
import { defineBangReopenTest } from './conversation-rig-helpers.mjs';

defineBangDrill([60, 20]);
defineBangReopenTest([60, 20]);
