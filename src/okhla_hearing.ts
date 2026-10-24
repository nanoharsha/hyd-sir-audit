// Okhla public hearing desk (migration_023.sql). A staff member looks the elector up by EPIC or house number,
// records a phone number if the elector has one, and the app issues a token to read out to the elector:
//   block K  -> PH-K1, PH-K2 ...      block G  -> PH-G1, PH-G2 ...
//   any other block, e.g. R -> PH-R-01, PH-R-02 ...     no block on the roll -> PH-MISC-01, PH-MISC-02 ...
// (A category used to be asked as well; it was dropped. The column stays, always empty, so the table needs no migration.)
// One token per elector: asking again returns the same token, so a lost slip or a second desk never makes a duplicate.
import { okhlaSearch } from "./okhla";
import { cleanPhone } from "./okhla_verify";
import { CurrentUser, utcnow } from "./records";

export function tokenLabel(blockKey: string, seq: number): string {
  if (blockKey === "K" || blockKey === "G") return `PH-${blockKey}${seq}`;
  return `PH-${blockKey}-${String(seq).padStart(2, "0")}`;
}

const blockKeyOf = (block: string | null | undefined) => {
  const b = (block || "").trim().toUpperCase();
  return /^[A-Z]{1,2}$/.test(b) ? b : "MISC";
};

const HEARING_COLS =
  "elector_id, token, block_key, phone, issued_at, issued_by, exit_testimony, exit_status, exit_remarks, exit_by, exit_at";

// Exit desk (migration_024.sql): what happened at the hearing. Every answer is optional, but something must be filled in.
export const EXIT_STATUSES = ["form6_filled", "form6_submitted", "ack_received", "notice_help", "first_time_form6"] as const;

// Search exactly as the Okhla tab does, then mark every elector who already holds a token.
export async function hearingSearch(db: D1Database, q: string) {
  const r: any = await okhlaSearch(db, { q, part: null, status: null, page: 0, block: null });
  const ids: number[] = [];
  for (const h of r.households || []) for (const m of h.members) ids.push(m.id);
  const found = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const res = await db
      .prepare(`SELECT ${HEARING_COLS} FROM ok_hearing WHERE elector_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all();
    for (const row of res.results as any[]) found.set(row.elector_id, row);
  }
  for (const h of r.households || []) for (const m of h.members) m.hearing = found.get(m.id) || null;
  return r;
}

export async function issueToken(db: D1Database, p: { elector_id?: number; phone?: string }, user: CurrentUser) {
  const id = Number(p.elector_id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Pick an elector first.");
  // The phone number is optional (the desk confirms before issuing without one); when typed it must be a real 10-digit number.
  const typed = (p.phone || "").trim();
  const phone = typed ? cleanPhone(typed) : "";
  if (typed && !phone) throw new Error("Enter a 10-digit phone number, or leave it empty.");

  const e: any = await db
    .prepare(
      `SELECT id, epic_id, name, relation_type, relation_name, age, gender, house_raw, house_floor, old_part, new_part, block, status, status_detail
         FROM ok_electors WHERE id = ?`
    )
    .bind(id)
    .first();
  if (!e) throw new Error("That elector was not found.");

  const existing = await db.prepare(`SELECT ${HEARING_COLS} FROM ok_hearing WHERE elector_id = ?`).bind(id).first();
  if (existing) return { ...existing, existing: true };

  const blockKey = blockKeyOf(e.block);
  const now = utcnow();
  // The next number is read and inserted in separate steps; the unique indexes make a clash fail loudly, and we simply try again.
  for (let attempt = 0; attempt < 8; attempt++) {
    const top: any = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM ok_hearing WHERE block_key = ?").bind(blockKey).first();
    const seq = (top?.n || 0) + 1;
    const token = tokenLabel(blockKey, seq);
    try {
      await db
        .prepare(
          `INSERT INTO ok_hearing (token, block_key, seq, elector_id, epic_id, name, relation_type, relation_name, age, gender, house_raw, house_floor,
                                   old_part, new_part, block, status, status_detail, phone, category, issued_by, issued_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(token, blockKey, seq, id, e.epic_id, e.name, e.relation_type, e.relation_name, e.age, e.gender, e.house_raw, e.house_floor,
              e.old_part, e.new_part, e.block, e.status, e.status_detail, phone, "", user.email || null, now)
        .run();
      return { elector_id: id, token, block_key: blockKey, phone, issued_at: now, issued_by: user.email || null, existing: false };
    } catch (err: any) {
      const msg = String(err && err.message);
      if (!/UNIQUE/i.test(msg)) throw err;
      // someone else took this number, or this elector's token landed a moment ago
      const again = await db.prepare(`SELECT ${HEARING_COLS} FROM ok_hearing WHERE elector_id = ?`).bind(id).first();
      if (again) return { ...again, existing: true };
    }
  }
  throw new Error("Could not issue a token, please try again.");
}

// Save (or edit) the exit-desk answers of an elector who already holds a token. The latest answers sit on the token row;
// every save is also kept in ok_hearing_exit_log.
export async function saveExit(
  db: D1Database,
  p: { elector_id?: number; testimony?: string; statuses?: string[]; remarks?: string },
  user: CurrentUser
) {
  const id = Number(p.elector_id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Pick an elector first.");
  const row: any = await db.prepare("SELECT token FROM ok_hearing WHERE elector_id = ?").bind(id).first();
  if (!row) throw new Error("This elector has no token yet. Issue a token first.");
  const testimony = ["yes", "no"].includes(p.testimony || "") ? (p.testimony as string) : null;
  const picked = Array.isArray(p.statuses) ? p.statuses : [];
  const statuses = EXIT_STATUSES.filter((x) => picked.includes(x)); // keeps the list's order, drops anything unknown
  const status = statuses.length ? statuses.join(",") : null;
  const remarks = (p.remarks || "").trim().slice(0, 2000) || null;
  if (!testimony && !status && !remarks) throw new Error("Fill in at least one answer.");
  const now = utcnow();
  const by = user.email || null;
  await db.batch([
    db
      .prepare("UPDATE ok_hearing SET exit_testimony = ?, exit_status = ?, exit_remarks = ?, exit_by = ?, exit_at = ? WHERE elector_id = ?")
      .bind(testimony, status, remarks, by, now, id),
    db
      .prepare("INSERT INTO ok_hearing_exit_log (elector_id, token, testimony, status, remarks, saved_by, saved_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, row.token, testimony, status, remarks, by, now),
  ]);
  return { elector_id: id, token: row.token, exit_testimony: testimony, exit_status: status, exit_remarks: remarks, exit_by: by, exit_at: now };
}

// Public hearing dashboard: how many tokens have been issued, by the elector's SIR tag at the time (ASDD, Notice, ...),
// by counter (K, G, OTHER), who issued them, and how far the exit desk has got. Counts only, no names or phone numbers.
export async function hearingDashboard(db: D1Database) {
  const [tot, byStatus, byCounter, byIssuer, exit] = await Promise.all([
    db.prepare("SELECT COUNT(*) n, MIN(issued_at) first, MAX(issued_at) last FROM ok_hearing").first<any>(),
    db.prepare("SELECT status, COUNT(*) n FROM ok_hearing GROUP BY status").all(),
    db
      .prepare("SELECT CASE WHEN block_key IN ('K','G') THEN block_key ELSE 'OTHER' END counter, COUNT(*) n FROM ok_hearing GROUP BY 1")
      .all(),
    db.prepare("SELECT issued_by email, COUNT(*) n FROM ok_hearing GROUP BY issued_by ORDER BY n DESC").all(),
    db
      .prepare(
        `SELECT SUM(exit_at IS NOT NULL) recorded,
                SUM(exit_testimony = 'yes') testimony_yes, SUM(exit_testimony = 'no') testimony_no,
                SUM(exit_status LIKE '%form6_filled%') form6_filled, SUM(exit_status LIKE '%form6_submitted%') form6_submitted,
                SUM(exit_status LIKE '%ack_received%') ack_received, SUM(exit_status LIKE '%notice_help%') notice_help,
                SUM(exit_status LIKE '%first_time_form6%') first_time_form6
           FROM ok_hearing`
      )
      .first<any>(),
  ]);
  const num = (v: any) => Number(v || 0);
  return {
    total: num(tot?.n),
    first_at: tot?.first || null,
    last_at: tot?.last || null,
    by_status: Object.fromEntries((byStatus.results as any[]).map((r) => [r.status || "UNKNOWN", num(r.n)])),
    by_counter: Object.fromEntries((byCounter.results as any[]).map((r) => [r.counter, num(r.n)])),
    by_issuer: (byIssuer.results as any[]).map((r) => ({ email: r.email, n: num(r.n) })),
    exit: Object.fromEntries(Object.entries(exit || {}).map(([k, v]) => [k, num(v)])),
  };
}
