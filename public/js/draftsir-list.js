// Draft SIR 2026 reverification tab. Config lives in worklist-configs.js.
import { makeWorklistTab } from "./worklist-tab.js";
import { DRAFTSIR_CFG } from "./worklist-configs.js";

export const initDraftsirList = makeWorklistTab(DRAFTSIR_CFG);
