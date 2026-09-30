// One drill at one size, in its own file so node runs it beside the others (fast-tests T03, DESIGN §2.4).
// The drill itself is in coordinator-drill-helpers.mjs.
import { endHelperDrill } from './coordinator-drill-helpers.mjs';

endHelperDrill(80, 24);
