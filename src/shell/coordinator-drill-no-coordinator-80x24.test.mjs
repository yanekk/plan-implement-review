// One drill at one size, in its own file so node runs it beside the others (fast-tests T03, DESIGN §2.4).
// The drill itself is in coordinator-drill-helpers.mjs.
import { noCoordinatorDrill } from './coordinator-drill-helpers.mjs';

noCoordinatorDrill(80, 24);
