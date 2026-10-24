// Draft SIR 2026 reverification round — config for the generic engine in
// src/worklist.ts. Data: migration_011.sql + docs/draftsir/draftsir_import.sql.
// Isolated from `electors`.
import type { ListConfig } from "./worklist";

// Five worklist tiles (Reverification Plan rows 8, 9, 6, 5, 10), in the
// display order the owner asked for.
const TILES = [
  { key: "verified", label: "Verified present — on no list" },
  { key: "pending", label: "In the base roll, not yet verified — on no list" },
  { key: "not_in_base", label: "In the Draft SIR roll — not in our base roll" },
  { key: "dead", label: "Marked dead by us — but in the Draft SIR roll" },
  { key: "addition", label: "Field addition — on no list" },
];

const OUTCOMES: Record<string, string[]> = {
  dead: ["Alive", "Dead"],
  not_in_base: ["Found", "Not Found"],
  verified: ["Found and present at the address", "Not Found"],
  pending: ["Found and present at the address", "Not Found"],
  addition: ["Found and present at the address", "Not Found"],
};

export const DRAFT_SIR: ListConfig = {
  table: "draft_sir",
  historyTable: "draft_sir_history",
  fkCol: "draft_sir_id",
  syncOpType: "draftsir_status",
  photoPrefix: "draftsir/",
  tiles: TILES,
  outcomes: OUTCOMES,
  presentOutcomes: new Set([
    "Alive",
    "Found",
    "Found and present at the address",
  ]),
  hasSegments: false,
  // Reverification Plan: SIR enumeration form + Jan Sunwai on every "found"
  // case; "were you a voter elsewhere and recently moved here?" only on
  // not_in_base (row 6). No 2025-vote or phone question in the Excel for this
  // list; photo kept as an optional provision.
  followups: (tile) => ({
    sir: true,
    voted: false,
    moved: tile === "not_in_base",
    jan: true,
    phone: false,
    photo: true,
  }),
};
