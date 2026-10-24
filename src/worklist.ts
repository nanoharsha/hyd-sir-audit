// Generic reverification-list engine. Drives the ASDD List (src/asddo.ts,
// migration_010) and the Draft SIR 2026 list (src/draftsir.ts, migration_011):
// both are self-contained datasets with the same shape — a searchable list plus
// worklist tiles that drill part -> house -> voter, and a per-voter
// reverification form following the Reverification Plan. Nothing here touches
// `electors`.
import { tokenizeHouseNumber } from "./house";
import { CurrentUser, LockedError, LOCKED_MESSAGE, utcnow } from "./records";
import { savePhoto } from "./uploads";

const EPIC_PATTERN = /^[A-Za-z]{3}\d+$/;
const ORDER_BY = " ORDER BY house_base_num, house_base, house_floor, CAST(old_sr AS INTEGER), old_sr";

export const SIR_FORM = ["Yes", "No", "Submitted Online"];
export const JAN_SUNWAI = ["Will participate", "Will speak", "No"];
export const YES_NO = ["Yes", "No"];

// "Other" is a synthetic outcome available on every tile — the verifier bails
// out of the structured flow and just leaves a remark (note required). It is
// never a "present" outcome, so all the follow-ups clear.
export const OTHER_OUTCOME = "Other";

// One photo per reverification, stored under a single slot ("photo"), shown
// just above Notes for every tile/outcome. Mirrors worklist-tab.js.
export const PHOTO_SLOTS = ["photo"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export interface Followups {
  sir: boolean;
  voted: boolean;
  moved: boolean;
  jan: boolean;
  phone: boolean;
  photo: boolean;
}

export interface ListConfig {
  table: string;
  historyTable: string;
  fkCol: string; // FK column name in the history table
  syncOpType: string;
  photoPrefix: string;
  tiles: { key: string; label: string }[];
  outcomes: Record<string, string[]>; // tileKey -> [presentOutcome, ...]
  presentOutcomes: Set<string>;
  hasSegments: boolean;
  reasonTile?: Record<string, string>; // ASDD only: asddo_reason -> tile fallback
  reasonCol?: string; // "asddo_reason" — extra column to expose in drill/search
  followups: (tile: string) => Followups;
}

const clone = (row: any) => (row ? { ...row } : row);
const cloneAll = (rows: any[]) => rows.map(clone);

// --------------------------------------------------------------------------
// search — house / EPIC / name over the whole list
// --------------------------------------------------------------------------
export async function search(db: D1Database, cfg: ListConfig, qRaw: string) {
  const q = (qRaw || "").trim();
  if (!q) return { results: [], match_type: "empty", query_base: null };
  const T = cfg.table;

  if (EPIC_PATTERN.test(q)) {
    const res = await db
      .prepare(`SELECT * FROM ${T} WHERE epic_norm = ?` + ORDER_BY)
      .bind(q.toUpperCase().replace(/\s+/g, ""))
      .all();
    return { results: cloneAll(res.results), match_type: "epic", query_base: q.toUpperCase() };
  }

  if (!/\d/.test(q)) {
    const upper = q.toUpperCase();
    const res = await db
      .prepare(
        `SELECT *, CASE WHEN UPPER(name) = ? THEN 0 WHEN UPPER(name) LIKE ? THEN 1 ELSE 2 END AS name_rank
           FROM ${T} WHERE UPPER(name) LIKE ?
       ORDER BY name_rank, name, house_base_num, house_base LIMIT 300`
      )
      .bind(upper, upper + "%", "%" + upper + "%")
      .all();
    if (res.results.length)
      return { results: cloneAll(res.results), match_type: "name", query_base: q };
    const rel = await db
      .prepare(`SELECT * FROM ${T} WHERE UPPER(relation_name) LIKE ?` + ORDER_BY + " LIMIT 300")
      .bind("%" + upper + "%")
      .all();
    return {
      results: cloneAll(rel.results),
      match_type: rel.results.length ? "relation" : "none",
      query_base: q,
    };
  }

  const { base } = tokenizeHouseNumber(q);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;
  let res = await db
    .prepare(
      `SELECT * FROM ${T}
        WHERE house_base = ?
           OR (? IS NOT NULL AND house_range_end_num IS NOT NULL
               AND house_base_num <= ? AND house_range_end_num >= ?)
           OR UPPER(TRIM(house_number_raw)) = UPPER(TRIM(?))` + ORDER_BY
    )
    .bind(base, qNum, qNum, qNum, q)
    .all();
  let matchType = "house";
  if (!res.results.length) {
    res = await db
      .prepare(`SELECT * FROM ${T} WHERE house_number_raw LIKE ? OR name LIKE ?` + ORDER_BY)
      .bind(`%${q}%`, `%${q}%`)
      .all();
    matchType = res.results.length ? "loose" : "none";
  }
  return { results: cloneAll(res.results), match_type: matchType, query_base: base };
}

// --------------------------------------------------------------------------
// tiles + part / house drill
// --------------------------------------------------------------------------
export async function tiles(db: D1Database, cfg: ListConfig) {
  const rows = (
    await db
      .prepare(
        `SELECT tile, segment,
                COUNT(*) AS voters,
                COUNT(DISTINCT (IFNULL(old_part,'') || '|' || IFNULL(house_base,''))) AS houses,
                SUM(CASE WHEN re_status = 'Done' THEN 1 ELSE 0 END) AS done
           FROM ${cfg.table} WHERE tile IS NOT NULL
          GROUP BY tile, segment`
      )
      .all()
  ).results as any[];

  const out: Record<string, any> = {};
  for (const t of cfg.tiles) {
    out[t.key] = {
      key: t.key,
      label: t.label,
      confirmed: 0,
      confirmed_houses: 0,
      doublecheck: 0,
      doublecheck_houses: 0,
      done: 0,
      total: 0,
    };
  }
  for (const r of rows) {
    const b = out[r.tile];
    if (!b) continue;
    if (cfg.hasSegments && r.segment === "doublecheck") {
      b.doublecheck = r.voters;
      b.doublecheck_houses = r.houses;
    } else {
      b.confirmed = r.voters;
      b.confirmed_houses = r.houses;
    }
    b.done += r.done;
    b.total += r.voters;
  }
  return { tiles: cfg.tiles.map((t) => out[t.key]), generated: utcnow() };
}

export async function tilePartHouses(
  db: D1Database,
  cfg: ListConfig,
  tile: string,
  segment = "confirmed"
) {
  const hasSeg = cfg.hasSegments && tile !== "notbase";
  const segClause = !hasSeg || segment === "all"
    ? ""
    : segment === "doublecheck"
    ? " AND segment = 'doublecheck'"
    : " AND (segment = 'confirmed' OR segment IS NULL OR segment = '')";
  const reasonSel = cfg.reasonCol ? `${cfg.reasonCol}, ` : "";
  const res = await db
    .prepare(
      `SELECT id, old_part, new_part, old_sr, epic_id, name, relation_type, relation_name, age, gender, ${reasonSel}
              house_number_raw, house_base, house_base_num, house_floor,
              prior_status, prior_sub, prior_note, prior_by, prior_at,
              tile, segment, dc_subtag, dc_why,
              re_status, re_outcome, sir_form, voted_2025, moved_here_recently, contact_phone, jan_sunwai,
              re_photo_key, re_notes, re_verified_by, re_verified_at
         FROM ${cfg.table} WHERE tile = ?` + segClause + ORDER_BY
    )
    .bind(tile)
    .all();

  const parts: Record<string, any> = {};
  for (const r of res.results as any[]) {
    // Group by old part where we have one (a base-roll voter); otherwise by
    // the draft's new part (a voter we hold no old-part record for).
    const pk = r.old_part || r.new_part || "—";
    const p = (parts[pk] ||= {
      old_part: r.old_part || r.new_part || "",
      no_old_part: !r.old_part,
      new_parts: new Set<string>(),
      houses: {} as Record<string, any>,
      voters: 0,
      done: 0,
    });
    if (r.new_part && r.old_part) p.new_parts.add(r.new_part);
    p.voters++;
    if (r.re_status === "Done") p.done++;
    const hk = r.house_number_raw || "(no house recorded)";
    const h = (p.houses[hk] ||= { house: hk, house_base: r.house_base, voters: [], done: 0 });
    h.voters.push(r);
    if (r.re_status === "Done") h.done++;
  }
  return {
    tile,
    segment,
    parts: Object.values(parts)
      .map((p: any) => ({
        old_part: p.old_part,
        no_old_part: p.no_old_part,
        new_part: [...p.new_parts].sort().join(" / "),
        houses: Object.values(p.houses).sort((a: any, b: any) =>
          (a.house_base || "").localeCompare(b.house_base || "", undefined, { numeric: true })
        ),
        house_count: Object.keys(p.houses).length,
        voters: p.voters,
        done: p.done,
      }))
      .sort((a, b) => (Number(a.old_part) || 999) - (Number(b.old_part) || 999)),
  };
}

// --------------------------------------------------------------------------
// offline snapshot
// --------------------------------------------------------------------------
export async function snapshot(db: D1Database, cfg: ListConfig) {
  const res = await db.prepare(`SELECT * FROM ${cfg.table}`).all();
  return { records: cloneAll(res.results), server_time: utcnow(), full: true };
}

export async function getOne(db: D1Database, cfg: ListConfig, id: number) {
  const row = await db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).bind(id).first();
  return row ? clone(row) : null;
}

export async function history(db: D1Database, cfg: ListConfig, id: number) {
  const res = await db
    .prepare(`SELECT * FROM ${cfg.historyTable} WHERE ${cfg.fkCol} = ? ORDER BY id DESC`)
    .bind(id)
    .all();
  return res.results;
}

// --------------------------------------------------------------------------
// record reverification
// --------------------------------------------------------------------------
export interface WorklistPayload {
  re_outcome?: string | null;
  sir_form?: string | null;
  voted_2025?: string | null;
  moved_here_recently?: string | null;
  contact_phone?: string | null;
  jan_sunwai?: string | null;
  // { slot: [ "data:image/..." (new) | "<existing r2 key>" (keep), ... ] }.
  // A slot omitted or empty clears that slot's photos.
  re_photos?: Record<string, string[]> | null;
  re_notes?: string | null;
}

async function alreadyApplied(db: D1Database, opId?: string | null) {
  if (!opId) return null;
  return db.prepare("SELECT * FROM sync_ops WHERE op_id = ?").bind(opId).first();
}

export async function updateStatus(
  db: D1Database,
  cfg: ListConfig,
  id: number,
  payload: WorklistPayload,
  user: CurrentUser,
  opId?: string | null,
  clientTime?: string | null,
  bucket?: R2Bucket
): Promise<{ record: any; duplicate: boolean }> {
  const T = cfg.table;
  const prior = await alreadyApplied(db, opId);
  if (prior) {
    const row = await db
      .prepare(`SELECT * FROM ${T} WHERE id = ?`)
      .bind((prior as any).elector_id)
      .first();
    return { record: clone(row), duplicate: true };
  }

  const row: any = await db.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(id).first();
  if (!row) throw new Error("NOT_FOUND");
  if (row.locked_at) throw new LockedError(LOCKED_MESSAGE);

  const tile =
    row.tile ||
    (cfg.reasonTile && cfg.reasonCol ? cfg.reasonTile[row[cfg.reasonCol]] : undefined) ||
    cfg.tiles[cfg.tiles.length - 1].key;
  const outcome = (payload.re_outcome || "").trim();
  const valid = [
    ...(cfg.outcomes[tile] || cfg.outcomes[cfg.tiles[cfg.tiles.length - 1].key]),
    OTHER_OUTCOME,
  ];
  if (!valid.includes(outcome)) {
    throw new Error(`Choose one of: ${valid.join(" / ")}`);
  }
  const isOther = outcome === OTHER_OUTCOME;
  const present = !isOther && cfg.presentOutcomes.has(outcome);
  const fu = cfg.followups(tile);

  const ask = (on: boolean, v: string | null | undefined) =>
    present && on ? (v || "").trim() || null : null;

  const sirForm = ask(fu.sir, payload.sir_form);
  if (sirForm && !SIR_FORM.includes(sirForm)) throw new Error("Invalid SIR form value");
  const voted = ask(fu.voted, payload.voted_2025);
  if (voted && !YES_NO.includes(voted)) throw new Error("Invalid voted-2025 value");
  const moved = ask(fu.moved, payload.moved_here_recently);
  if (moved && !YES_NO.includes(moved)) throw new Error("Invalid moved-here value");
  const jan = ask(fu.jan, payload.jan_sunwai);
  if (jan && !JAN_SUNWAI.includes(jan)) throw new Error("Invalid Jan Sunwai value");
  const phone =
    present && fu.phone
      ? (payload.contact_phone || "").trim() || row.contact_phone
      : row.contact_phone;
  const notes = (payload.re_notes ?? row.re_notes ?? null) || null;
  if (isOther && !(notes && notes.trim())) {
    throw new Error('Add a remark to record this as "Other".');
  }

  // One photo. An entry is either a new data URL (upload it) or an
  // already-stored key for this record (keep it); anything else is dropped.
  const keyPrefix = `${cfg.photoPrefix}${id}/`;
  const inPhotos =
    payload.re_photos && typeof payload.re_photos === "object" ? payload.re_photos : {};
  const rePhotos: Record<string, string[]> = {};
  for (const slot of PHOTO_SLOTS) {
    const entries = Array.isArray((inPhotos as any)[slot]) ? ((inPhotos as any)[slot] as any[]) : [];
    const keys: string[] = [];
    for (const entry of entries.slice(0, 1)) {
      if (typeof entry !== "string") continue;
      if (entry.startsWith("data:")) {
        if (bucket) keys.push(await savePhoto(bucket, id, entry, cfg.photoPrefix, slot));
      } else if (entry.startsWith(keyPrefix) && /\.(jpg|png|webp)$/.test(entry)) {
        keys.push(entry);
      }
    }
    if (keys.length) rePhotos[slot] = keys;
  }
  const rePhotosJson = Object.keys(rePhotos).length ? JSON.stringify(rePhotos) : null;

  const isCorrection = row.re_status === "Done";
  const now = utcnow();

  // No auto-lock — this round is iterative and any signed-in surveyor may
  // update; the full trail lives in the history table. An explicit setLock()
  // still blocks writes via the guard below.
  const res = await db
    .prepare(
      `UPDATE ${T} SET
         re_status = 'Done', re_outcome = ?, sir_form = ?, voted_2025 = ?, moved_here_recently = ?,
         contact_phone = ?, jan_sunwai = ?, re_photos = ?, re_photo_key = NULL, re_notes = ?,
         re_verified_by = ?, re_verified_at = ?, updated_by_email = ?, updated_at = ?
       WHERE id = ? AND locked_at IS NULL`
    )
    .bind(
      outcome, sirForm, voted, moved, phone, jan, rePhotosJson, notes,
      user.email, clientTime || now, user.email, now, id
    )
    .run();
  if (res.meta.changes === 0) throw new LockedError(LOCKED_MESSAGE);

  await db
    .prepare(
      `INSERT INTO ${cfg.historyTable}
        (${cfg.fkCol}, re_status, re_outcome, sir_form, voted_2025, moved_here_recently, contact_phone,
         jan_sunwai, re_photos, re_notes, re_verified_by, re_verified_at, user_email, op_id, client_time, action)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      id, "Done", outcome, sirForm, voted, moved, phone, jan, rePhotosJson, notes,
      user.email, clientTime || now, user.email, opId ?? null, clientTime ?? null,
      isCorrection ? "correct" : "verify"
    )
    .run();

  if (opId) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO sync_ops
         (op_id, user_email, op_type, elector_id, client_time, received_at, status, detail)
         VALUES (?,?,?,?,?,?,?,'')`
      )
      .bind(opId, user.email, cfg.syncOpType, id, clientTime ?? null, now, "applied")
      .run();
  }

  const updated = await db.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(id).first();
  return { record: clone(updated), duplicate: false };
}

export async function setLock(
  db: D1Database,
  cfg: ListConfig,
  id: number,
  locked: boolean,
  user: CurrentUser
) {
  const T = cfg.table;
  const row: any = await db.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(id).first();
  if (!row) throw new Error("NOT_FOUND");
  const now = utcnow();
  if (locked) {
    await db
      .prepare(`UPDATE ${T} SET locked_at = ?, locked_by_email = ? WHERE id = ?`)
      .bind(row.locked_at || now, user.email, id)
      .run();
  } else {
    await db.prepare(`UPDATE ${T} SET locked_at = NULL, locked_by_email = NULL WHERE id = ?`).bind(id).run();
  }
  await db
    .prepare(
      `INSERT INTO ${cfg.historyTable} (${cfg.fkCol}, re_status, re_outcome, re_verified_by, re_verified_at, user_email, action)
       VALUES (?,?,?,?,?,?,?)`
    )
    .bind(id, row.re_status, row.re_outcome, user.email, now, user.email, locked ? "lock" : "reopen")
    .run();
  const updated = await db.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(id).first();
  return clone(updated);
}

export async function exportCsv(db: D1Database, cfg: ListConfig): Promise<string> {
  const res = await db.prepare(`SELECT * FROM ${cfg.table}` + ORDER_BY).all();
  const skip = new Set(["id", "epic_norm", "base_elector_id", "house_base", "house_base_num",
    "house_floor", "house_range_end", "house_range_end_num", "locked_at", "locked_by_email",
    "updated_by_email", "updated_at", "segment", "dc_why"]);
  const cols = Object.keys((res.results[0] as any) || {}).filter((c) => !skip.has(c));
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(",")];
  for (const r of res.results as any[]) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}
