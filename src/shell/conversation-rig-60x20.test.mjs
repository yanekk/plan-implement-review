// The conversation rig's end-to-end pty test at 60×20, the visible-helpers T06 drill's narrow size: in its own
// file, like the other sizes (fast-tests T05), so node --test runs it side by side with them.
// The test body is in conversation-rig-helpers.mjs.

import { defineHelperLinesTest, defineBangTest } from './conversation-rig-helpers.mjs';

defineHelperLinesTest([60, 20]);
defineBangTest([60, 20]);
