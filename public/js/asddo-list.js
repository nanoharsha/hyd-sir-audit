// ASDD List reverification tab. Config lives in worklist-configs.js.
import { makeWorklistTab } from "./worklist-tab.js";
import { ASDDO_CFG } from "./worklist-configs.js";

export const initAsddoList = makeWorklistTab(ASDDO_CFG);
