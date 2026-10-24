// Dashboard metrics and per-staff activity, ported from the developer's
// reports.py. Scoped down from their version: we have no login/session
// tracking (Cloudflare Access handles sign-in), so activity is grouped by
// staff email rather than by session, and there is no login/logout timeline.
import { BASE_ROLL, CORRECTION, DELETION, FOUND, MIGRATED, NOT_FOUND, NOT_STARTED } from "./records";

export const DEFINITIONS: Record<string, string> = {
  base_roll_total:
    "Total electors in the 2025 Final Roll (Revision 1) for Secunderabad Cantt (AC 71), parts 149-151. Counted by unique EPIC, so someone enrolled in two parts is counted once.",
  verification_completed:
    "Roll entries where a surveyor has recorded an outcome, either Found or Not Found. Shows how much of the roll has been covered so far.",
  additions:
    "Eligible voters found living in the area who are missing from the roll, recorded in the field. They have no EPIC number yet.",
  deletions:
    "Voters who were verified and are marked for deletion, for reasons such as death, marriage, or other grounds recorded by the surveyor.",
  corrections:
    "Voters who were found but whose roll details are wrong, and who need a Form 8 correction.",
  revised_total:
    "What the roll should contain once this audit is applied: base roll voters confirmed Found, plus field additions, minus deletions.",
  found: "Roll entries confirmed as genuine residents at the listed address.",
  not_found: "Roll entries where the voter could not be traced at the listed address.",
  not_started: "Roll entries no surveyor has reached yet.",
  pending: "Roll entries still waiting to be verified. Base Roll Total minus Verification Completed.",
};

export const REVISED_TOTAL_FORMULA = "Found on base roll + Additions − Deletions";

async function count(db: D1Database, where: string, params: any[] = []): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM electors WHERE ${where}`)
    .bind(...params)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

// The base roll is counted by unique voter (EPIC), not by row: the ECI roll
// enrols a handful of people in two parts, and the Supplement 5 part-moves
// keep the old entry alongside the new one. Every base-roll row carries an
// EPIC, so the IFNULL guard is belt-and-braces. A voter enrolled twice is
// "Found" if either entry was found, else "Not Found" if either was — hence
// notFound / notStarted are derived from the completed/found split below so
// found + notFound + notStarted always sums back to the total.
async function countEpics(db: D1Database, where: string, params: any[] = []): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(DISTINCT epic_id) AS c FROM electors WHERE (${where}) AND IFNULL(epic_id, '') <> ''`)
    .bind(...params)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function dashboard(db: D1Database) {
  const baseRollTotal = await countEpics(db, BASE_ROLL);
  const foundBase = await countEpics(db, `${BASE_ROLL} AND verification_status = ?`, [FOUND]);
  const foundAll = await count(db, "verification_status = ?", [FOUND]);
  const verificationCompleted = await countEpics(
    db,
    `${BASE_ROLL} AND verification_status != ?`,
    [NOT_STARTED]
  );
  const notFound = verificationCompleted - foundBase;
  const notStarted = baseRollTotal - verificationCompleted;
  const notFoundShifted = await countEpics(
    db,
    `${BASE_ROLL} AND verification_status = ? AND sub_category = ?`,
    [NOT_FOUND, MIGRATED]
  );
  const additions = await count(db, "added_in_field = 1");
  const deletions = await count(db, "sub_category = ?", [DELETION]);
  const corrections = await count(db, "sub_category = ?", [CORRECTION]);
  const revisedTotal = foundBase + additions - deletions;

  return {
    base_roll_total: baseRollTotal,
    verification_completed: verificationCompleted,
    pending: baseRollTotal - verificationCompleted,
    additions,
    deletions,
    corrections,
    not_found_shifted: notFoundShifted,
    revised_total: revisedTotal,
    found: foundBase,
    found_all: foundAll,
    not_found: notFound,
    not_started: notStarted,
    definitions: DEFINITIONS,
    revised_total_formula: REVISED_TOTAL_FORMULA,
    percent_complete: baseRollTotal ? Math.round((1000 * verificationCompleted) / baseRollTotal) / 10 : 0,
  };
}

// Per Part Number coverage, so a coordinator can see which parts lag.
export async function partProgress(db: D1Database) {
  const res = await db
    .prepare(
      `SELECT part_number,
              SUM(CASE WHEN ${BASE_ROLL} THEN 1 ELSE 0 END) AS base_total,
              SUM(CASE WHEN ${BASE_ROLL} AND verification_status != ? THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN added_in_field = 1 THEN 1 ELSE 0 END) AS additions,
              SUM(CASE WHEN sub_category = ? THEN 1 ELSE 0 END) AS deletions,
              SUM(CASE WHEN sub_category = ? THEN 1 ELSE 0 END) AS corrections
         FROM electors
     GROUP BY part_number
     ORDER BY CAST(part_number AS INTEGER), part_number`
    )
    .bind(NOT_STARTED, DELETION, CORRECTION)
    .all();
  return res.results;
}

// Verifications/additions/deletions/corrections per staff email for one UTC
// day (the developer's version windows by IST calendar day; we keep it
// simple and use UTC since D1 has no timezone database available).
export async function dailyActivity(db: D1Database, dateStr?: string | null) {
  const day = dateStr || new Date().toISOString().slice(0, 10);
  const start = `${day}T00:00:00`;
  const end = `${day}T23:59:59.999`;

  const activity = await db
    .prepare(
      `SELECT h.user_email AS email,
              COUNT(DISTINCT CASE WHEN h.verification_status != ? AND COALESCE(e.added_in_field, 0) = 0
                                   THEN h.elector_id END) AS verifications,
              COUNT(DISTINCT CASE WHEN h.sub_category = ? THEN h.elector_id END) AS deletions,
              COUNT(DISTINCT CASE WHEN h.sub_category = ? THEN h.elector_id END) AS corrections
         FROM status_history h
    LEFT JOIN electors e ON e.id = h.elector_id
        WHERE h.verified_at >= ? AND h.verified_at <= ? AND h.user_email IS NOT NULL
     GROUP BY h.user_email`
    )
    .bind(NOT_STARTED, DELETION, CORRECTION, start, end)
    .all();

  const additions = await db
    .prepare(
      `SELECT created_by_email AS email, COUNT(*) AS additions
         FROM electors
        WHERE added_in_field = 1 AND created_at >= ? AND created_at <= ? AND created_by_email IS NOT NULL
     GROUP BY created_by_email`
    )
    .bind(start, end)
    .all();

  const additionsByEmail: Record<string, number> = {};
  for (const r of additions.results as any[]) additionsByEmail[r.email] = r.additions;

  const rows = (activity.results as any[]).map((r) => ({
    email: r.email,
    verifications: r.verifications || 0,
    additions: additionsByEmail[r.email] || 0,
    deletions: r.deletions || 0,
    corrections: r.corrections || 0,
  }));
  // Staff who only added electors (no status_history activity that day) still belong in the report.
  for (const email of Object.keys(additionsByEmail)) {
    if (!rows.find((r) => r.email === email)) {
      rows.push({ email, verifications: 0, additions: additionsByEmail[email], deletions: 0, corrections: 0 });
    }
  }
  rows.sort((a, b) => b.verifications + b.additions - (a.verifications + a.additions));

  const totals = { verifications: 0, additions: 0, deletions: 0, corrections: 0 };
  for (const r of rows) {
    totals.verifications += r.verifications;
    totals.additions += r.additions;
    totals.deletions += r.deletions;
    totals.corrections += r.corrections;
  }

  return { date: day, rows, totals };
}

// Everything a staff member has done across the whole survey, so their
// record is waiting for them at each new login rather than starting blank.
export async function mySummary(db: D1Database, email: string) {
  const totals = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN h.verification_status != ? AND COALESCE(e.added_in_field, 0) = 0
                              THEN h.elector_id END) AS verifications,
         COUNT(DISTINCT CASE WHEN h.sub_category = ? THEN h.elector_id END) AS deletions,
         COUNT(DISTINCT CASE WHEN h.sub_category = ? THEN h.elector_id END) AS corrections
         FROM status_history h
    LEFT JOIN electors e ON e.id = h.elector_id
        WHERE h.user_email = ?`
    )
    .bind(NOT_STARTED, DELETION, CORRECTION, email)
    .first<any>();

  const additions = await db
    .prepare("SELECT COUNT(*) AS c FROM electors WHERE added_in_field = 1 AND created_by_email = ?")
    .bind(email)
    .first<{ c: number }>();

  return {
    verifications: totals?.verifications || 0,
    deletions: totals?.deletions || 0,
    corrections: totals?.corrections || 0,
    additions: additions?.c || 0,
  };
}

// Dates that have any activity, for the report date picker — so a
// coordinator can't land on an empty day by mistake.
export async function activeDays(db: D1Database, limit = 30): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT DISTINCT d FROM (
         SELECT substr(verified_at, 1, 10) AS d FROM status_history WHERE verified_at IS NOT NULL
         UNION SELECT substr(created_at, 1, 10) FROM electors WHERE created_at IS NOT NULL
       )
       ORDER BY d DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return (res.results as any[]).map((r) => r.d).filter(Boolean);
}
