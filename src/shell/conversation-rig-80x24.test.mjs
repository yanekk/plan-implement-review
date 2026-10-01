// The conversation rig's end-to-end pty tests at 80×24 (fast-tests T05): split out of
// conversation-rig.test.mjs so node --test runs each screen size in its own process, side by side.
// The test bodies are in conversation-rig-helpers.mjs.

import {
  defineCoordinatorAgentTest, defineWheelTest, defineGroupLinesTest, defineFinisherTest, defineFinisherDrillTests,
  defineHelperLinesTest, defineEscWarnsTest, defineBangTest, defineHandTest,
} from './conversation-rig-helpers.mjs';

defineCoordinatorAgentTest([80, 24]);
defineWheelTest([80, 24]);
defineGroupLinesTest([80, 24]);
defineFinisherTest([80, 24]);
defineFinisherDrillTests([80, 24]);
defineHelperLinesTest([80, 24]);
defineEscWarnsTest([80, 24]);
defineBangTest([80, 24]);
defineHandTest([80, 24]);
