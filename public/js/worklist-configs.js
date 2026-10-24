// Config for both reverification lists — kept here (not in the tab wrappers)
// so worklist-tab.js can read *both* for the "other flags at this house"
// cross-reference. Backends: src/asddo.ts / src/draftsir.ts.

export const ASDDO_CFG = {
  prefix: "asddo",
  store: "asddo",
  viewId: "asddoView",
  g: "asddoList",
  opType: "asddo_status",
  tabLabelKey: "tabAsddo",
  hasSegments: true,
  // ASDD only: a search hit can be re-verified even when it is not on a tile —
  // every ASDD voter has a removal reason, so a Reverify button always makes
  // sense. The row stays un-tiled (it is not "flagged"); the update rides on
  // the reason's tile. Draft SIR search stays lookup-only for un-flagged rows.
  searchAnyReverify: true,
  reasonCol: "asddo_reason",
  listSaysKey: "asddoListSays",
  movedKey: "asddoMovedLabel",
  tiles: [
    { key: "dead", k: "asddoTileDead" },
    { key: "pshift", k: "asddoTilePshift" },
    { key: "absent", k: "asddoTileAbsent" },
    { key: "enrolled", k: "asddoTileEnrolled" },
    { key: "notbase", k: "asddoTileNotbase" },
  ],
  outcomes: {
    dead: [["Alive", "wlOutAlive"], ["Dead", "wlOutDead"]],
    pshift: [["Present at the address", "wlOutPresent"], ["Permanently Shifted", "wlOutShifted"]],
    absent: [["Present at the address", "wlOutPresent"], ["Absent", "wlOutAbsent"]],
    enrolled: [["No Duplicity Found", "wlOutNoDup"], ["Duplicate", "wlOutDup"]],
    notbase: [["Found", "wlOutFound"], ["Not Found", "wlOutNotFound"]],
  },
  present: new Set(["Alive", "Present at the address", "No Duplicity Found", "Found"]),
  reasonTile: {
    Death: "dead",
    "Permanently Shifted": "pshift",
    "Untraceable/Absent": "absent",
    "Already enrolled": "enrolled",
  },
  reasonLabelKeys: {
    Death: "asddoReasonDeath",
    "Permanently Shifted": "asddoReasonShifted",
    "Untraceable/Absent": "asddoReasonAbsent",
    "Already enrolled": "asddoReasonEnrolled",
  },
  followups: (tile) => ({
    sir: tile !== "enrolled",
    voted: tile === "dead" || tile === "pshift" || tile === "absent",
    moved: tile === "notbase",
    jan: tile !== "enrolled",
    phone: tile !== "enrolled",
    photo: tile !== "enrolled",
  }),
};

export const DRAFTSIR_CFG = {
  prefix: "draftsir",
  store: "draftsir",
  viewId: "draftsirView",
  g: "draftsirList",
  opType: "draftsir_status",
  tabLabelKey: "tabDraftsir",
  hasSegments: false,
  reasonCol: null,
  listSaysKey: null, // Draft SIR rows carry no per-row status — see listTag()
  movedKey: "draftsirMovedLabel",
  tiles: [
    { key: "verified", k: "draftsirTileVerified" },
    { key: "pending", k: "draftsirTilePending" },
    { key: "not_in_base", k: "draftsirTileNotBase" },
    { key: "dead", k: "draftsirTileDead" },
    { key: "addition", k: "draftsirTileAddition" },
  ],
  outcomes: {
    dead: [["Alive", "wlOutAlive"], ["Dead", "wlOutDead"]],
    not_in_base: [["Found", "wlOutFound"], ["Not Found", "wlOutNotFound"]],
    verified: [["Found and present at the address", "wlOutFoundPresent"], ["Not Found", "wlOutNotFound"]],
    pending: [["Found and present at the address", "wlOutFoundPresent"], ["Not Found", "wlOutNotFound"]],
    addition: [["Found and present at the address", "wlOutFoundPresent"], ["Not Found", "wlOutNotFound"]],
  },
  present: new Set(["Alive", "Found", "Found and present at the address"]),
  reasonTile: null,
  reasonLabelKeys: null,
  followups: (tile) => ({
    sir: true,
    voted: false,
    moved: tile === "not_in_base",
    jan: true,
    phone: false,
    photo: true,
  }),
};

export const ALL_CONFIGS = { asddo: ASDDO_CFG, draftsir: DRAFTSIR_CFG };
