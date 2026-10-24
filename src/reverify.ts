// Re-verification Dashboard — a read-only view that sits ON TOP OF the frozen
// asddo / draft_sir worklists (migration_010 / _011). It never writes to those
// tables and never changes their tabs.
//
// It answers, per tile: how far has re-verification got, and what did it
// conclude — plus a flag for any voter whose *base-roll* verification has
// moved since the anomaly snapshot was frozen (e.g. someone re-verified in the
// main app who now belongs in a tile, or no longer does).
//
// Everything is computed live from asddo + draft_sir + electors on each load,
// so the number is conclusive whenever the exercise stops — no extra storage,
// no sync hooks.
import { utcnow } from "./records";

// The 10 tiles, in Reverification-Plan order, with the "confirming" outcomes
// (re_outcome values that mean "the anomaly stands"). Mirrors the outcomes /
// present sets in public/js/worklist-configs.js + src/{asddo,draftsir}.ts.
interface TileDef {
  key: string;
  label: string;
  confirm: string[]; // re_outcome values that CONFIRM the anomaly
}

const ASDDO_TILES: TileDef[] = [
  { key: "dead", label: "Marked dead in ASDD — verified alive", confirm: ["Alive"] },
  { key: "pshift", label: "Marked permanently shifted — present", confirm: ["Present at the address"] },
  { key: "absent", label: "Marked absent / untraceable — present", confirm: ["Present at the address"] },
  { key: "enrolled", label: "Marked duplicate — no duplicity found", confirm: ["No Duplicity Found"] },
  { key: "notbase", label: "In the ASDD list, not in our base roll", confirm: ["Found"] },
];

const DRAFTSIR_TILES: TileDef[] = [
  { key: "verified", label: "Verified present — not on the Draft or ASDD list", confirm: ["Found and present at the address"] },
  { key: "pending", label: "In the base roll, not yet verified — not on any list", confirm: ["Found and present at the address"] },
  { key: "not_in_base", label: "In the Draft SIR roll — not in our base roll", confirm: ["Found"] },
  { key: "dead", label: "Marked dead by us — but in the Draft SIR roll", confirm: ["Dead"] },
  { key: "addition", label: "Field addition — not on the Draft or ASDD list", confirm: ["Found and present at the address"] },
];

const OTHER = "Other";
// electors has no epic_norm column; normalise its epic_id the same way asddo /
// draft_sir do. Always used where the electors row is aliased `e`.
const NORM = "UPPER(REPLACE(e.epic_id,' ',''))";

type Row = Record<string, any>;

async function tileRollup(db: D1Database, table: string, defs: TileDef[]) {
  const rows = (
    await db
      .prepare(
        `SELECT tile,
                CASE WHEN segment = 'doublecheck' THEN 'dc' ELSE 'main' END AS seg,
                COUNT(*) AS frozen,
                SUM(CASE WHEN re_status = 'Done' THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN re_status = 'Done' AND re_outcome = '${OTHER}' THEN 1 ELSE 0 END) AS other,
                re_outcome
           FROM ${table}
          WHERE tile IS NOT NULL
          GROUP BY tile, seg, re_outcome`
      )
      .all()
  ).results as Row[];

  const acc: Record<string, any> = {};
  for (const d of defs)
    acc[d.key] = { frozen: 0, dc: 0, done: 0, dcDone: 0, other: 0, confirmed: 0, byOutcome: {} as Record<string, number> };
  for (const r of rows) {
    const a = acc[r.tile];
    if (!a) continue;
    if (r.seg === "dc") {
      a.dc += r.frozen;
      a.dcDone += r.done;
    } else {
      a.frozen += r.frozen;
      a.done += r.done;
      a.other += r.other;
      if (r.re_outcome && r.re_outcome !== OTHER)
        a.byOutcome[r.re_outcome] = (a.byOutcome[r.re_outcome] || 0) + r.done;
    }
  }
  for (const d of defs) {
    const a = acc[d.key];
    a.confirmed = d.confirm.reduce((s: number, o) => s + (a.byOutcome[o] || 0), 0);
    a.refuted = a.done - a.confirmed - a.other;
    a.pending = a.frozen - a.done;
  }
  return acc;
}

// Frozen rows in each tile whose CURRENT base-roll verification no longer
// matches the snapshot (`prior_status` / `prior_sub`). Joined by the elector id
// captured at import — rows with no base elector (ASDD "notbase", Draft SIR
// "not_in_base") can't drift and are skipped.
async function baseChangeCounts(db: D1Database, table: string) {
  const rows = (
    await db
      .prepare(
        `SELECT w.tile AS tile, COUNT(*) AS n
           FROM ${table} w
           JOIN electors e ON e.id = w.base_elector_id
          WHERE w.tile IS NOT NULL
            AND ( IFNULL(e.verification_status,'') <> IFNULL(w.prior_status,'')
               OR IFNULL(e.sub_category,'')        <> IFNULL(w.prior_sub,'') )
          GROUP BY w.tile`
      )
      .all()
  ).results as Row[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tile] = r.n;
  return out;
}

// Electors that AREN'T in either anomaly list but whose current base-roll state
// now qualifies them for a Draft SIR base-roll tile — the "we just found one"
// case (verified / pending / addition). Returns counts per tile key.
async function newCandidateCounts(db: D1Database) {
  const row = (await db
    .prepare(
      `SELECT
         SUM(CASE WHEN verification_status = 'Found' AND added_in_field = 0
                   AND IFNULL(sub_category,'') <> 'Deletion' THEN 1 ELSE 0 END) AS verified,
         SUM(CASE WHEN (verification_status = 'Not Started' OR verification_status IS NULL)
                   AND added_in_field = 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN verification_status = 'Found' AND added_in_field = 1 THEN 1 ELSE 0 END) AS addition
       FROM electors e
       WHERE NOT EXISTS (SELECT 1 FROM asddo a WHERE a.epic_norm = ${NORM})
         AND NOT EXISTS (SELECT 1 FROM draft_sir d WHERE d.epic_norm = ${NORM})
         AND ${NORM} <> ''`
    )
    .first()) as Row;
  return {
    verified: row?.verified || 0,
    pending: row?.pending || 0,
    addition: row?.addition || 0,
  };
}

export async function reverifyDashboard(db: D1Database) {
  const [asddoRoll, draftRoll, asddoChg, draftChg, cand] = await Promise.all([
    tileRollup(db, "asddo", ASDDO_TILES),
    tileRollup(db, "draft_sir", DRAFTSIR_TILES),
    baseChangeCounts(db, "asddo"),
    baseChangeCounts(db, "draft_sir"),
    newCandidateCounts(db),
  ]);

  const shape = (list: string, defs: TileDef[], roll: any, chg: Record<string, number>, candidates: Row) =>
    defs.map((d) => {
      const a = roll[d.key];
      return {
        list,
        key: d.key,
        label: d.label,
        frozen: a.frozen, // the "Started" figure (matches the tab + Reverification Plan)
        dc: a.dc, // double-check segment, tracked but not in the headline
        dc_done: a.dcDone,
        done: a.done,
        pending: a.pending,
        confirmed: a.confirmed, // the headline number
        refuted: a.refuted,
        other: a.other,
        by_outcome: a.byOutcome,
        base_changes: (chg[d.key] || 0) + (candidates[d.key] || 0),
        candidates: candidates[d.key] || 0,
      };
    });

  return {
    generated: utcnow(),
    lists: [
      { list: "asddo", label: "ASDD List", tiles: shape("asddo", ASDDO_TILES, asddoRoll, asddoChg, {}) },
      { list: "draftsir", label: "Draft SIR 2026", tiles: shape("draftsir", DRAFTSIR_TILES, draftRoll, draftChg, cand) },
    ],
  };
}

// The drill for one tile: every frozen row with its re-verification result,
// then the base-roll-change rows, then (Draft SIR base-roll tiles) the new
// candidates that have no anomaly row yet.
export async function reverifyTile(db: D1Database, list: string, tile: string) {
  const table = list === "asddo" ? "asddo" : "draft_sir";
  const defs = list === "asddo" ? ASDDO_TILES : DRAFTSIR_TILES;
  const def = defs.find((d) => d.key === tile);
  if (!def) return { detail: "Unknown tile" };

  // Only the re-verified rows travel — a tile can hold 700+ still-pending rows
  // and those belong on the worklist tab, not here.
  const members = (
    await db
      .prepare(
        `SELECT id, name, epic_id, old_part, new_part, house_number_raw, age, gender,
                relation_type, relation_name, prior_status, prior_sub, segment,
                re_status, re_outcome, re_notes, re_photos, re_verified_by, re_verified_at
           FROM ${table} WHERE tile = ? AND re_status = 'Done'
          ORDER BY re_verified_at DESC`
      )
      .bind(tile)
      .all()
  ).results as Row[];
  const pendingRow = (await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tile = ? AND IFNULL(re_status,'') <> 'Done'`)
    .bind(tile)
    .first()) as Row;

  const confirm = new Set(def.confirm);
  const withVerdict = members.map((m) => ({
    ...m,
    verdict: m.re_outcome === OTHER ? "other" : confirm.has(m.re_outcome) ? "confirmed" : "refuted",
  }));

  const changed = (
    await db
      .prepare(
        `SELECT w.id, w.name, w.epic_id, w.old_part, w.new_part, w.house_number_raw,
                w.prior_status, w.prior_sub, w.re_status, w.re_outcome,
                e.verification_status AS now_status, e.sub_category AS now_sub,
                e.verified_by AS now_by, e.verified_at AS now_at
           FROM ${table} w
           JOIN electors e ON e.id = w.base_elector_id
          WHERE w.tile = ?
            AND ( IFNULL(e.verification_status,'') <> IFNULL(w.prior_status,'')
               OR IFNULL(e.sub_category,'')        <> IFNULL(w.prior_sub,'') )
          ORDER BY w.name`
      )
      .bind(tile)
      .all()
  ).results as Row[];

  let candidates: Row[] = [];
  if (list === "draftsir" && (tile === "verified" || tile === "pending" || tile === "addition")) {
    const cond =
      tile === "verified"
        ? "e.verification_status = 'Found' AND e.added_in_field = 0 AND IFNULL(e.sub_category,'') <> 'Deletion'"
        : tile === "pending"
        ? "(e.verification_status = 'Not Started' OR e.verification_status IS NULL) AND e.added_in_field = 0"
        : "e.verification_status = 'Found' AND e.added_in_field = 1";
    candidates = (
      await db
        .prepare(
          `SELECT e.id, e.name, e.epic_id, e.part_number AS old_part, e.house_number_raw,
                  e.age, e.gender, e.relation_type, e.relation_name,
                  e.verification_status AS now_status, e.sub_category AS now_sub,
                  e.verified_by AS now_by, e.verified_at AS now_at
             FROM electors e
            WHERE ${cond}
              AND NOT EXISTS (SELECT 1 FROM asddo a WHERE a.epic_norm = ${NORM})
              AND NOT EXISTS (SELECT 1 FROM draft_sir d WHERE d.epic_norm = ${NORM})
              AND ${NORM} <> ''
            ORDER BY e.name
            LIMIT 500`
        )
        .all()
    ).results as Row[];
  }

  return {
    list,
    tile,
    label: def.label,
    members: withVerdict,
    pending: (pendingRow?.n as number) || 0,
    changed,
    candidates,
  };
}
