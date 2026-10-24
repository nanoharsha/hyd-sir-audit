// ASDD List reverification round ("Camp cum Jan Sunwai") — config for the
// generic engine in src/worklist.ts. Data: migration_010.sql +
// docs/asddo_list/asddo_import.sql. Isolated from `electors`.
import type { ListConfig } from "./worklist";

// Five worklist tiles, in display order. English labels; Hindi lives in app.js.
const TILES = [
  { key: "dead", label: "Marked dead — verified alive" },
  { key: "pshift", label: "Permanently shifted — present at the address" },
  { key: "absent", label: "Absent / untraceable — present at the address" },
  { key: "enrolled", label: "Duplicate — present, no duplicity found" },
  { key: "notbase", label: "In the ASDD List, not in our base roll" },
];

// First value per tile = the "found present" outcome that opens the follow-ups.
const OUTCOMES: Record<string, string[]> = {
  dead: ["Alive", "Dead"],
  pshift: ["Present at the address", "Permanently Shifted"],
  absent: ["Present at the address", "Absent"],
  enrolled: ["No Duplicity Found", "Duplicate"],
  notbase: ["Found", "Not Found"],
};

export const ASDDO: ListConfig = {
  table: "asddo",
  historyTable: "asddo_history",
  fkCol: "asddo_id",
  syncOpType: "asddo_status",
  photoPrefix: "asddo/",
  tiles: TILES,
  outcomes: OUTCOMES,
  presentOutcomes: new Set(["Alive", "Present at the address", "No Duplicity Found", "Found"]),
  hasSegments: true,
  reasonCol: "asddo_reason",
  reasonTile: {
    Death: "dead",
    "Permanently Shifted": "pshift",
    "Untraceable/Absent": "absent",
    "Already enrolled": "enrolled",
  },
  // Reverification Plan rows 1-4 + 7: SIR form + Jan Sunwai + phone + photo for
  // the "present" cases; voted-2025 for death/shifted/absent; "moved here" for
  // not-in-roll; the Duplicate check asks nothing.
  followups: (tile) => ({
    sir: tile !== "enrolled",
    voted: tile === "dead" || tile === "pshift" || tile === "absent",
    moved: tile === "notbase",
    jan: tile !== "enrolled",
    phone: tile !== "enrolled",
    photo: tile !== "enrolled",
  }),
};
