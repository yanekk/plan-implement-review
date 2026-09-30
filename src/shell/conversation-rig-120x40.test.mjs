// The conversation rig's end-to-end pty tests at 120×40 (fast-tests T05): split out of
// conversation-rig.test.mjs so node --test runs each screen size in its own process, side by side.
// The test bodies are in conversation-rig-helpers.mjs.

import { defineCoordinatorAgentTest, defineWheelTest, defineGroupLinesTest, defineFinisherTest, defineFinisherDrillTests } from './conversation-rig-helpers.mjs';

defineCoordinatorAgentTest([120, 40]);
defineWheelTest([120, 40]);
defineGroupLinesTest([120, 40]);
defineFinisherTest([120, 40]);
defineFinisherDrillTests([120, 40]);
