// Search, status updates with record locking, additions, and the offline
// sync endpoint. Ported from the developer's records.py, adapted from their
// phone/OTP + numeric user_id model to our Cloudflare Access email identity.
import { houseFields, tokenizeHouseNumber } from "./house";

export const EPIC_PATTERN = /^[A-Za-z]{3}\d+$/;
export const FOUND = "Found";
export const NOT_FOUND = "Not Found";
export const NOT_STARTED = "Not Started";
export const SELECTABLE_STATUSES = [FOUND, NOT_FOUND];
export const DELETION = "Deletion";
export const CORRECTION = "Correction needed";
// Sub-category a surveyor picks for a Not Found voter who has shifted /
// migrated out (the other Not Found option is "Others"). Its own dashboard
// stat + drill-down.
export const MIGRATED = "Migrated";

// Supplement 5 (ECI, Mangol Puri AC) import — one tag column, three values.
// See migration_009.sql. Deletions tagged here are NOT subtracted from Base
// Roll Total — same treatment as source_deleted / source_unidentified_deletion.
// The audit field-verifies every proposed deletion independently, and several
// Supplement 5 deletions are already confirmed present on the ground, so the
// deletion is surfaced (badge + dashboard tile + drill-down) rather than
// silently applied. Supplement 5 additions are stored as added_in_field = 0
// rows so they are counted.
export const S5_ADDITION = "Addition";
export const S5_DELETION = "Deletion";
export const S5_CORRECTION = "Correction";
export const BASE_ROLL = "added_in_field = 0";

export const ORDER_BY =
  " ORDER BY house_base_num, house_base, house_floor, CAST(sr_no AS INTEGER), sr_no";

// Tags the source roll carries in its Flag column. Shown on every voter card
// so a surveyor sees at the doorstep what the roll already says about them.
export const SOURCE_FLAG_TAGS = ["Absent", "Expired", "Repeated", "Shifted"];

export const ADDITION_CATEGORIES = [
  "Completed 18 years",
  "Marriage",
  "Wrongful Deletion",
  "Voter not found in base roll",
  "Other",
];

// Which Form 8 sub-category a correction falls under. This replaced a plain
// "was Form 8 given?" yes/no, which recorded that paperwork had changed
// hands but not what the voter was asking to have changed.
//
// "Wrongful Deletion" covers a voter the source roll already marks as deleted
// who turns out on verification to be living at the address — the deletion
// itself is the error being corrected. Watch for it alongside the "Deleted in
// source roll" tag on a record.
export const CORRECTION_TYPES = [
  "Correction of Entries in Existing Electoral Roll",
  "Shifting of Residence",
  "Wrongful Deletion",
  "Other",
];

// Why a deletion is being proposed. Only "Death" carries a certificate — the
// upload field is hidden for the others, so an absent photo no longer has to
// be read as either "no certificate yet" or "not a death".
//
// "Absent / Permanently shifted" was removed 2026-08-26 at the owner's
// request: a voter who has moved away is a Correction (Shifting of
// Residence — they may still be reachable/re-registerable), not a Deletion.
// Every existing record using it (318 as of the migration) was remapped to
// sub_category "Correction needed" / correction_type "Shifting of
// Residence" before this value was removed from the list — see
// scripts/migrate_absent_shifted_to_correction.sql. Do not re-add this
// value without a matching data decision; DELETION_TYPES is validated
// against on every submission, so a stray old client still offering it
// would simply have the submission rejected.
export const DEATH = "Death";
export const DELETION_TYPES = [DEATH, "Duplicate Voter", "Other"];

export const YES_NO = ["Yes", "No"];

// Pull the known tags out of the roll's Flag column. The column is free
// text, so tags are matched case-insensitively and any value that is not
// one of the known tags is returned as-is rather than dropped — hiding a
// flag would be worse than showing one we cannot name.
export function parseSourceFlags(value: string | null | undefined): string[] {
  const raw = (value || "").trim();
  if (!raw) return [];
  const lowered = raw.toLowerCase();
  const found = SOURCE_FLAG_TAGS.filter((t) => lowered.includes(t.toLowerCase()));
  if (found.length) return found;
  return lowered === "added in field" ? [] : [raw];
}

export function rowToDict(row: any): any {
  if (!row) return row;
  return { ...row, flags: parseSourceFlags(row.source_flag) };
}

export function rowsToDict(rows: any[]): any[] {
  return rows.map(rowToDict);
}

export function utcnow(): string {
  return new Date().toISOString();
}

export interface CurrentUser {
  email: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

// Two tiers: Team Coordinators are DB-backed (the `admins` table, manageable
// from the Team screen by a super admin) and Super Admins come only from the
// SUPER_ADMIN_EMAILS env var — set at deploy time, never through the UI, so
// the top tier can never be locked out or removed by a UI mistake. A super
// admin is also a coordinator (isAdmin is true for both tiers); the two
// booleans let call sites gate ordinary coordinator actions on isAdmin and
// super-admin-only overrides (managing the team, clearing test data) on
// isSuperAdmin.
export async function currentUser(c: any): Promise<CurrentUser> {
  const email = (c.req.header("Cf-Access-Authenticated-User-Email") || "unknown").toLowerCase();
  const superAdmins = ((c.env.SUPER_ADMIN_EMAILS as string) || "")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  if (superAdmins.includes(email)) return { email, isAdmin: true, isSuperAdmin: true };

  const row = await c.env.DB.prepare("SELECT 1 FROM admins WHERE email = ?").bind(email).first();
  return { email, isAdmin: !!row, isSuperAdmin: false };
}

// --------------------------------------------------------------------------
// search
// --------------------------------------------------------------------------

export async function search(db: D1Database, qRaw: string) {
  const q = (qRaw || "").trim();
  if (!q) return { results: [], match_type: "empty", query_base: null };

  if (EPIC_PATTERN.test(q)) {
    const res = await db
      .prepare("SELECT * FROM electors WHERE epic_id = ?" + ORDER_BY)
      .bind(q.toUpperCase())
      .all();
    return { results: rowsToDict(res.results), match_type: "epic", query_base: q.toUpperCase() };
  }

  // No digits at all means they are looking for a person, not a house.
  if (!/\d/.test(q)) {
    return searchByName(db, q);
  }

  const { base } = tokenizeHouseNumber(q);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;

  let res = await db
    .prepare(
      `SELECT * FROM electors
        WHERE house_base = ?
           OR (? IS NOT NULL
               AND house_range_end_num IS NOT NULL
               AND house_base_num <= ? AND house_range_end_num >= ?)
           OR UPPER(TRIM(house_number_raw)) = UPPER(TRIM(?))` + ORDER_BY
    )
    .bind(base, qNum, qNum, qNum, q)
    .all();
  let matchType = "house";

  if (!res.results.length) {
    res = await db
      .prepare("SELECT * FROM electors WHERE house_number_raw LIKE ? OR name LIKE ?" + ORDER_BY)
      .bind(`%${q}%`, `%${q}%`)
      .all();
    matchType = res.results.length ? "loose" : "none";
  }

  return { results: rowsToDict(res.results), match_type: matchType, query_base: base };
}

// Name search, best matches first: exact, then starts-with, then anywhere.
// If nobody has that name, look for people whose relative does — which is
// how a household is often described at the door.
async function searchByName(db: D1Database, q: string) {
  const upper = q.toUpperCase();
  const res = await db
    .prepare(
      `SELECT *,
              CASE WHEN UPPER(name) = ?     THEN 0
                   WHEN UPPER(name) LIKE ?  THEN 1
                   ELSE 2 END AS name_rank
         FROM electors
        WHERE UPPER(name) LIKE ?
     ORDER BY name_rank, name, house_base_num, house_base, CAST(sr_no AS INTEGER)
        LIMIT 300`
    )
    .bind(upper, upper + "%", "%" + upper + "%")
    .all();
  if (res.results.length) {
    return { results: rowsToDict(res.results), match_type: "name", query_base: q };
  }

  const rel = await db
    .prepare("SELECT * FROM electors WHERE UPPER(relation_name) LIKE ?" + ORDER_BY + " LIMIT 300")
    .bind("%" + upper + "%")
    .all();
  return {
    results: rowsToDict(rel.results),
    match_type: rel.results.length ? "relation" : "none",
    query_base: q,
  };
}

// --------------------------------------------------------------------------
// record locking
// --------------------------------------------------------------------------

// No grace period, no role exemption (2026-08-25, at the owner's request —
// editing should be "democratised and not timebound"): a locked record
// blocks a direct write from anyone, full stop. The only way past it is the
// explicit Reopen action (setLock below), which is itself open to anyone
// signed in. This message is a rare-case fallback — the UI never offers a
// locked record's form for direct submission, it offers Reopen instead — so
// it stays short rather than explaining a flow the reader isn't in.
export const LOCKED_MESSAGE = "This entry is locked. Reopen it first to make changes.";

export class LockedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function checkUnlocked(row: any) {
  if (row.locked_at) throw new LockedError(LOCKED_MESSAGE);
}

export interface StatusPayload {
  verification_status?: string | null;
  sub_category?: string | null;
  death_cert_collected?: boolean | null;
  death_cert_photo?: string | null; // base64 data URL, saved via uploads.ts
  remove_death_cert?: boolean;
  correction_type?: string | null;
  deletion_type?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// Idempotent on op_id so a retried sync after a dropped connection does not
// double-write history.
async function alreadyApplied(db: D1Database, opId: string | null | undefined) {
  if (!opId) return null;
  return db.prepare("SELECT * FROM sync_ops WHERE op_id = ?").bind(opId).first();
}

async function recordOp(
  db: D1Database,
  opId: string | null | undefined,
  userEmail: string,
  opType: string,
  electorId: number,
  clientTime: string | null | undefined,
  status: string
) {
  if (!opId) return;
  await db
    .prepare(
      `INSERT OR REPLACE INTO sync_ops
       (op_id, user_email, op_type, elector_id, client_time, received_at, status, detail)
       VALUES (?,?,?,?,?,?,?,'')`
    )
    .bind(opId, userEmail, opType, electorId, clientTime ?? null, utcnow(), status)
    .run();
}

export async function updateStatus(
  db: D1Database,
  electorId: number,
  payload: StatusPayload,
  user: CurrentUser,
  opId?: string | null,
  clientTime?: string | null,
  bucket?: R2Bucket
): Promise<{ record: any; duplicate: boolean }> {
  const prior = await alreadyApplied(db, opId);
  if (prior) {
    const row = await db
      .prepare("SELECT * FROM electors WHERE id = ?")
      .bind((prior as any).elector_id)
      .first();
    return { record: rowToDict(row), duplicate: true };
  }

  const row: any = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  if (!row) throw new Error("NOT_FOUND");

  checkUnlocked(row);
  // Distinguishes a first-time verification from a later edit — of an
  // already-recorded entry, whether that's a Reopen-then-resubmit or (before
  // 2026-08-25) a same-day self-correction. No longer tied to lock/grace
  // state, since checkUnlocked above guarantees locked_at is null here
  // either way.
  const isCorrection = !!row.verification_status && row.verification_status !== NOT_STARTED;

  const status = payload.verification_status || row.verification_status;
  if (!SELECTABLE_STATUSES.includes(status)) {
    throw new Error("Choose whether the voter was Found or Not Found");
  }
  const subCategory = payload.sub_category ?? null;
  const notes = payload.notes ?? null;
  const deathCert =
    payload.death_cert_collected === true ? 1 : payload.death_cert_collected === false ? 0 : null;

  // A correction needs a way to reach the voter about their Form 8. Keep any
  // number already on file if this update does not carry one.
  const contactPhone = (payload.contact_phone || "").trim() || row.contact_phone;
  let correctionType = (payload.correction_type || "").trim() || null;
  if (correctionType && !CORRECTION_TYPES.includes(correctionType)) {
    throw new Error("Choose a valid correction sub-category");
  }
  // The sub-category only means anything on a correction. Clearing it when
  // the outcome changes stops a stale value trailing a record that is now a
  // deletion.
  if (subCategory !== CORRECTION) correctionType = null;

  let deletionType = (payload.deletion_type || "").trim() || null;
  if (deletionType && !DELETION_TYPES.includes(deletionType)) {
    throw new Error("Choose a valid deletion type");
  }
  // Same reasoning as correction_type above: the deletion type only means
  // anything on a Deletion, so it is cleared when the outcome changes rather
  // than left trailing a record that is no longer one.
  if (subCategory !== DELETION) deletionType = null;

  // A photo only belongs to a Deletion; keep any previously uploaded one
  // unless this operation carries a replacement or explicit removal.
  let photoPath = row.death_cert_file;
  if (payload.death_cert_photo && bucket) {
    const { savePhoto } = await import("./uploads");
    photoPath = await savePhoto(bucket, electorId, payload.death_cert_photo);
  } else if (payload.remove_death_cert) {
    photoPath = null;
  }
  // A certificate is only meaningful on a death. If the record is no longer a
  // Deletion, or the deletion is no longer a Death, drop the reference — a
  // death certificate hanging off a "permanently shifted" record would be
  // both misleading and an unnecessary retention of a sensitive document.
  if (subCategory !== DELETION || deletionType !== DEATH) photoPath = null;

  const now = utcnow();

  // Recording an outcome always claims the lock — checkUnlocked above
  // guarantees the record was unlocked to begin with, so this write is
  // always the one that (re-)locks it. The "AND locked_at IS NULL" makes
  // that claim atomic: two people submitting the same freshly-unlocked
  // record at the same instant would both pass checkUnlocked, since neither
  // has written yet, and this lets exactly one of them win.
  const result = await db
    .prepare(
      `UPDATE electors SET
        verification_status = ?, sub_category = ?, death_cert_collected = ?, death_cert_file = ?,
        correction_type = ?, deletion_type = ?, contact_phone = ?, notes = ?, verified_by = ?, verified_at = ?,
        updated_by_email = ?, updated_at = ?, locked_at = ?, locked_by_email = ?
      WHERE id = ? AND locked_at IS NULL`
    )
    .bind(
      status,
      subCategory,
      deathCert,
      photoPath,
      correctionType,
      deletionType,
      contactPhone,
      notes,
      user.email,
      clientTime || now,
      user.email,
      now,
      now,
      user.email,
      electorId
    )
    .run();
  if (result.meta.changes === 0) {
    throw new LockedError(LOCKED_MESSAGE);
  }

  await db
    .prepare(
      `INSERT INTO status_history
       (elector_id, verification_status, sub_category, death_cert_collected, death_cert_file, correction_type,
        deletion_type, verified_by, verified_at, notes, user_email, op_id, client_time, is_override, action)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      electorId,
      status,
      subCategory,
      deathCert,
      photoPath,
      correctionType,
      deletionType,
      user.email,
      clientTime || now,
      notes,
      user.email,
      opId ?? null,
      clientTime ?? null,
      isCorrection ? 1 : 0,
      isCorrection ? "correct" : "verify"
    )
    .run();

  await recordOp(db, opId, user.email, "status", electorId, clientTime, "applied");

  const updated = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  return { record: rowToDict(updated), duplicate: false };
}

export interface NewElectorPayload {
  part_number: string;
  house_number_raw: string;
  name: string;
  age?: string | null;
  gender?: string | null;
  addition_category?: string | null;
  contact_phone?: string | null;
  form6_given?: string | null;
  notes?: string | null;
}

// A voter found in the field who is not on the roll. No EPIC ID: a new voter
// has not been issued one yet — and no relation details either, since those
// are not collected for a field addition. Additions are locked immediately
// since they already carry a submitted outcome ("Found").
export async function addElector(
  db: D1Database,
  payload: NewElectorPayload,
  user: CurrentUser,
  opId?: string | null,
  clientTime?: string | null
): Promise<{ record: any; duplicate: boolean }> {
  const prior = await alreadyApplied(db, opId);
  if (prior) {
    const row = await db
      .prepare("SELECT * FROM electors WHERE id = ?")
      .bind((prior as any).elector_id)
      .first();
    return { record: rowToDict(row), duplicate: true };
  }

  const name = (payload.name || "").trim();
  const house = (payload.house_number_raw || "").trim();
  const part = (payload.part_number || "").trim();
  const category = (payload.addition_category || "").trim() || null;
  if (category && !ADDITION_CATEGORIES.includes(category)) {
    throw new Error("Choose a valid category for this addition");
  }
  const form6 = (payload.form6_given || "").trim() || null;
  if (form6 && !YES_NO.includes(form6)) {
    throw new Error("Answer Yes or No for Form 6");
  }
  const notes = (payload.notes || "").trim() || null;
  if (!name) throw new Error("Name is required");
  if (!house) throw new Error("House Number is required");
  if (!part) throw new Error("Part Number is required");

  const h = houseFields(house);
  const now = utcnow();

  const res = await db
    .prepare(
      `INSERT INTO electors (
        part_number, house_number_raw, house_base, house_base_num, house_floor,
        house_range_end, house_range_end_num, name,
        age, gender, addition_category, contact_phone, form6_given, notes,
        source_deleted, source_flag, added_in_field,
        verification_status, verified_by, verified_at,
        created_by_email, created_at, updated_by_email, updated_at,
        locked_at, locked_by_email
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'No', 'Added in field', 1,
                'Found', ?,?, ?,?,?,?, ?,?)`
    )
    .bind(
      part,
      h.house_number_raw,
      h.house_base,
      h.house_base_num,
      h.house_floor,
      h.house_range_end,
      h.house_range_end_num,
      name,
      (payload.age || "").trim() || null,
      (payload.gender || "").trim() || null,
      category,
      (payload.contact_phone || "").trim() || null,
      form6,
      notes,
      user.email,
      clientTime || now,
      user.email,
      clientTime || now,
      user.email,
      now,
      now,
      user.email
    )
    .run();

  const newId = res.meta.last_row_id as number;
  await db
    .prepare(
      `INSERT INTO status_history
       (elector_id, verification_status, sub_category, verified_by, verified_at,
        notes, user_email, op_id, client_time, action)
       VALUES (?, 'Found', 'Added in field', ?, ?, ?, ?, ?, ?, 'addition')`
    )
    .bind(newId, user.email, clientTime || now, notes, user.email, opId ?? null, clientTime ?? null)
    .run();

  await recordOp(db, opId, user.email, "addition", newId, clientTime, "applied");

  const row = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(newId).first();
  return { record: rowToDict(row), duplicate: false };
}

// "Reopen" — anyone signed in can unlock a submitted record to edit it, or
// lock one again (2026-08-25: no longer coordinator-only, no grace period —
// see the note on checkUnlocked above). Recorded in the audit history
// either way.
export async function setLock(db: D1Database, electorId: number, locked: boolean, user: CurrentUser) {
  const row: any = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  if (!row) throw new Error("NOT_FOUND");

  const now = utcnow();
  if (locked) {
    await db
      .prepare("UPDATE electors SET locked_at = ?, locked_by_email = ? WHERE id = ?")
      .bind(row.locked_at || now, user.email, electorId)
      .run();
  } else {
    await db
      .prepare("UPDATE electors SET locked_at = NULL, locked_by_email = NULL WHERE id = ?")
      .bind(electorId)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO status_history
       (elector_id, verification_status, sub_category, verified_by, verified_at,
        user_email, is_override, action)
       VALUES (?,?,?,?,?,?,1,?)`
    )
    .bind(
      electorId,
      row.verification_status,
      row.sub_category,
      user.email,
      now,
      user.email,
      locked ? "lock" : "reopen"
    )
    .run();

  const updated = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  return rowToDict(updated);
}

// Fields a coordinator may correct — chiefly a field addition with a typo,
// which locking would otherwise make permanent.
export const EDITABLE_DETAILS = [
  "name",
  "relation_type",
  "relation_name",
  "age",
  "gender",
  "part_number",
  "contact_phone",
  "addition_category",
  "form6_given",
];

export async function updateDetails(
  db: D1Database,
  electorId: number,
  payload: Record<string, any>,
  user: CurrentUser
) {
  const row: any = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  if (!row) throw new Error("NOT_FOUND");

  const updates: Record<string, any> = {};
  const changes: string[] = [];
  for (const field of EDITABLE_DETAILS) {
    if (field in payload && payload[field] !== null && payload[field] !== undefined) {
      const value = String(payload[field]).trim() || null;
      if (value !== row[field]) {
        updates[field] = value;
        changes.push(`${field}: ${row[field] || "—"} → ${value || "—"}`);
      }
    }
  }

  if (payload.house_number_raw) {
    const h = houseFields(payload.house_number_raw);
    if (h.house_number_raw !== row.house_number_raw) {
      Object.assign(updates, h);
      changes.push(`house: ${row.house_number_raw} → ${h.house_number_raw}`);
    }
  }

  if (!Object.keys(updates).length) return rowToDict(row);

  if ("name" in updates && !updates.name) throw new Error("Name cannot be empty");

  const now = utcnow();
  updates.updated_by_email = user.email;
  updates.updated_at = now;
  const assignments = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  await db
    .prepare(`UPDATE electors SET ${assignments} WHERE id = ?`)
    .bind(...Object.values(updates), electorId)
    .run();

  await db
    .prepare(
      `INSERT INTO status_history
       (elector_id, verification_status, sub_category, verified_by, verified_at,
        notes, user_email, is_override, action)
       VALUES (?,?,?,?,?,?,?,1,'edit-details')`
    )
    .bind(
      electorId,
      row.verification_status,
      row.sub_category,
      user.email,
      now,
      changes.join("; "),
      user.email
    )
    .run();

  const updated = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  return rowToDict(updated);
}

// Super-admin-only override for wiping out a mistaken/test submission. A
// field addition has no existence in the base roll, so it is deleted
// outright; anything else is put back to its pre-verification state. Either
// way the row's audit trail is cleared too, so a reset record reads as
// untouched rather than "reset by X".
export async function resetRecord(db: D1Database, electorId: number) {
  const row: any = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  if (!row) throw new Error("NOT_FOUND");

  await db.prepare("DELETE FROM status_history WHERE elector_id = ?").bind(electorId).run();

  if (row.added_in_field) {
    await db.prepare("DELETE FROM electors WHERE id = ?").bind(electorId).run();
    return { deleted: true, id: electorId };
  }

  await db
    .prepare(
      `UPDATE electors SET
         verification_status = ?, sub_category = NULL, notes = NULL,
         verified_by = NULL, verified_at = NULL, locked_at = NULL, locked_by_email = NULL,
         death_cert_collected = NULL, death_cert_file = NULL, correction_type = NULL,
         deletion_type = NULL, contact_phone = NULL
       WHERE id = ?`
    )
    .bind(NOT_STARTED, electorId)
    .run();

  const updated2 = await db.prepare("SELECT * FROM electors WHERE id = ?").bind(electorId).first();
  return rowToDict(updated2);
}

// --------------------------------------------------------------------------
// bulk reset
// --------------------------------------------------------------------------

// The phrase a caller must send to actually perform a bulk reset. Deliberately
// not "yes" or "confirm": it has to be impossible to trigger by a mis-click, a
// replayed request, or a curl someone half-remembers.
export const RESET_ALL_CONFIRMATION = "ERASE ALL FIELDWORK";

// What a bulk reset would destroy. Always show this before doing it — there is
// no is_test column on any table, so the system cannot tell a test entry from
// a surveyor's real work. "Clear the test data" and "erase the survey" are the
// same operation to the database, and the only thing separating them is
// whether real fieldwork has started yet.
export async function resetAllPreview(db: D1Database) {
  const one = async (sql: string) =>
    ((await db.prepare(sql).first<{ c: number }>())?.c ?? 0);
  return {
    verifications: await one(
      `SELECT COUNT(*) AS c FROM electors WHERE ${BASE_ROLL} AND verification_status != '${NOT_STARTED}'`
    ),
    field_additions: await one("SELECT COUNT(*) AS c FROM electors WHERE added_in_field = 1"),
    history_entries: await one("SELECT COUNT(*) AS c FROM status_history"),
    revisit_flags: await one("SELECT COUNT(*) AS c FROM revisits"),
    photos: await one("SELECT COUNT(*) AS c FROM electors WHERE death_cert_file IS NOT NULL"),
    base_roll_total: await one(`SELECT COUNT(*) AS c FROM electors WHERE ${BASE_ROLL}`),
    confirmation_phrase: RESET_ALL_CONFIRMATION,
  };
}

// Returns every base-roll record to untouched and removes all field-recorded
// work. The imported roll itself (names, addresses, EPIC numbers) is never
// touched — only what surveyors have added on top of it.
export async function resetAllData(db: D1Database, bucket?: R2Bucket) {
  const before = await resetAllPreview(db);

  // Delete the stored certificate images before dropping their references,
  // otherwise the objects are orphaned in R2 with nothing pointing at them.
  let photosDeleted = 0;
  if (bucket) {
    const listed = await bucket.list({ limit: 1000 });
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
      photosDeleted++;
    }
  }

  await db.prepare("DELETE FROM electors WHERE added_in_field = 1").run();
  await db.prepare("DELETE FROM status_history").run();
  await db.prepare("DELETE FROM revisits").run();
  // sync_ops holds the op_id ledger that makes offline replay idempotent.
  // Clearing it alongside the data keeps a re-test from being swallowed as a
  // duplicate of an operation whose record no longer exists.
  await db.prepare("DELETE FROM sync_ops").run();

  await db
    .prepare(
      `UPDATE electors SET
         verification_status = ?, sub_category = NULL, notes = NULL,
         verified_by = NULL, verified_at = NULL, locked_at = NULL, locked_by_email = NULL,
         death_cert_collected = NULL, death_cert_file = NULL, correction_type = NULL,
         deletion_type = NULL, contact_phone = NULL, updated_by_email = NULL, updated_at = NULL
       WHERE added_in_field = 0`
    )
    .bind(NOT_STARTED)
    .run();

  return { cleared: before, photos_deleted: photosDeleted, at: utcnow() };
}
