// Households flagged for a return visit. A surveyor who finds a house
// locked, or nobody home, flags it here as a personal follow-up list — not
// part of the verification record, so it is freely editable by whoever
// raised it (or a coordinator) and never locked. Ported from revisits.py.
import { houseFields } from "./house";
import { CurrentUser, utcnow } from "./records";

export interface RevisitPayload {
  house_number_raw: string;
  part_number?: string | null;
  note?: string | null;
}

export async function createRevisit(
  db: D1Database,
  payload: RevisitPayload,
  user: CurrentUser,
  opId?: string | null,
  clientTime?: string | null
): Promise<{ revisit: any; duplicate: boolean }> {
  if (opId) {
    const existing = await db.prepare("SELECT * FROM revisits WHERE op_id = ?").bind(opId).first();
    if (existing) return { revisit: existing, duplicate: true };
  }

  const house = (payload.house_number_raw || "").trim();
  if (!house) throw new Error("House Number is required");

  const h = houseFields(house);
  let part = (payload.part_number || "").trim() || null;

  // Flagging the same house twice is a double tap, not two separate visits.
  const openAlready: any = await db
    .prepare(
      `SELECT * FROM revisits WHERE user_email = ? AND house_base = ? AND resolved_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .bind(user.email, h.house_base)
    .first();
  if (openAlready) {
    const note = (payload.note || "").trim() || openAlready.note;
    await db.prepare("UPDATE revisits SET note = ? WHERE id = ?").bind(note, openAlready.id).run();
    const row = await db.prepare("SELECT * FROM revisits WHERE id = ?").bind(openAlready.id).first();
    return { revisit: row, duplicate: true };
  }

  if (!part) {
    const match: any = await db
      .prepare(
        `SELECT part_number, COUNT(*) n FROM electors WHERE house_base = ? AND part_number IS NOT NULL
         GROUP BY part_number ORDER BY n DESC LIMIT 1`
      )
      .bind(h.house_base)
      .first();
    if (match) part = match.part_number;
  }

  const now = utcnow();
  const res = await db
    .prepare(
      `INSERT INTO revisits
       (op_id, user_email, part_number, house_number_raw, house_base, house_base_num,
        note, created_at, client_time)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      opId ?? null,
      user.email,
      part,
      h.house_number_raw,
      h.house_base,
      h.house_base_num,
      (payload.note || "").trim() || null,
      clientTime || now,
      clientTime ?? null
    )
    .run();

  const row = await db.prepare("SELECT * FROM revisits WHERE id = ?").bind(res.meta.last_row_id).first();
  return { revisit: row, duplicate: false };
}

async function owned(db: D1Database, revisitId: number, user: CurrentUser) {
  const row: any = await db.prepare("SELECT * FROM revisits WHERE id = ?").bind(revisitId).first();
  if (!row) throw new Error("NOT_FOUND");
  if (row.user_email !== user.email && !user.isAdmin) throw new Error("FORBIDDEN");
  return row;
}

export async function resolveRevisit(
  db: D1Database,
  revisitId: number,
  note: string | null | undefined,
  user: CurrentUser,
  resolved = true
) {
  await owned(db, revisitId, user);
  if (resolved) {
    await db
      .prepare(
        "UPDATE revisits SET resolved_at = ?, resolved_by_email = ?, resolution_note = ? WHERE id = ?"
      )
      .bind(utcnow(), user.email, (note || "").trim() || null, revisitId)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE revisits SET resolved_at = NULL, resolved_by_email = NULL, resolution_note = NULL WHERE id = ?"
      )
      .bind(revisitId)
      .run();
  }
  return db.prepare("SELECT * FROM revisits WHERE id = ?").bind(revisitId).first();
}

export async function deleteRevisit(db: D1Database, revisitId: number, user: CurrentUser) {
  await owned(db, revisitId, user);
  await db.prepare("DELETE FROM revisits WHERE id = ?").bind(revisitId).run();
  return { ok: true, id: revisitId };
}

export async function listRevisits(db: D1Database, user: CurrentUser, scope = "me", status = "open") {
  const where: string[] = [];
  const params: any[] = [];
  if (scope !== "all" || !user.isAdmin) {
    where.push("r.user_email = ?");
    params.push(user.email);
  }
  if (status === "open") where.push("r.resolved_at IS NULL");
  else if (status === "done") where.push("r.resolved_at IS NOT NULL");

  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const res = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM electors e WHERE e.house_base = r.house_base AND COALESCE(e.added_in_field,0) = 0) AS voters_at_house,
              (SELECT COUNT(*) FROM electors e WHERE e.house_base = r.house_base AND COALESCE(e.added_in_field,0) = 0 AND e.verification_status != 'Not Started') AS voters_done
         FROM revisits r
         ${clause}
     ORDER BY r.resolved_at IS NOT NULL, r.house_base_num, r.house_base, r.created_at DESC`
    )
    .bind(...params)
    .all();
  return res.results;
}

export async function openForHouse(db: D1Database, houseBase: string) {
  const res = await db
    .prepare("SELECT * FROM revisits WHERE house_base = ? AND resolved_at IS NULL")
    .bind(houseBase)
    .all();
  return res.results;
}

export async function revisitCounts(db: D1Database, user: CurrentUser) {
  const mine = await db
    .prepare(
      `SELECT SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open_mine, COUNT(*) AS total_mine
         FROM revisits WHERE user_email = ?`
    )
    .bind(user.email)
    .first<any>();
  const team = await db
    .prepare("SELECT COUNT(*) c FROM revisits WHERE resolved_at IS NULL")
    .first<{ c: number }>();
  return {
    open_mine: mine?.open_mine || 0,
    total_mine: mine?.total_mine || 0,
    open_team: team?.c || 0,
  };
}
