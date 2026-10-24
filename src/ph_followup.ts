// PH FOLLOW UP tab — post-hearing follow-up against one voter, keyed the same
// way as ph_remarks (voter_key = epic_norm, or "elector:<id>" with no EPIC).
// Separate table (migration_016) — see its header comment for why. Read-only
// against everything else; writes only to ph_followup.
import { CurrentUser, utcnow } from "./records";

const YES_NO = ["Yes", "No"];

export interface FollowupPayload {
  voter_key: string;
  name?: string | null;
  house_number_raw?: string | null;
  part_number?: string | null;
  epic_id?: string | null;
  blo_contacted?: string | null;
  form6_submitted?: string | null;
  form6_assistance?: string | null; // only kept when form6_submitted === "No"
  notice_received?: string | null;
  notes?: string | null;
}

export async function getFollowup(db: D1Database, voterKey: string) {
  const row = await db.prepare("SELECT * FROM ph_followup WHERE voter_key = ?").bind(voterKey).first();
  return row || null;
}

// Full dump for the offline cache and for building the part/house list — same
// "ship it whole" reasoning as ph_remarks (allRemarks): one row per voter
// followed up with, a small table.
export async function allFollowups(db: D1Database) {
  const res = await db.prepare("SELECT * FROM ph_followup").all();
  return res.results;
}

export async function saveFollowup(db: D1Database, p: FollowupPayload, user: CurrentUser) {
  if (!p.voter_key) throw new Error("Missing voter");

  const bloContacted = YES_NO.includes(p.blo_contacted || "") ? (p.blo_contacted as string) : null;
  const form6Submitted = YES_NO.includes(p.form6_submitted || "") ? (p.form6_submitted as string) : null;
  // Question 3 only applies when Form 6 has NOT been submitted — cleared
  // otherwise, same "ask() only when it still applies" rule the reverification
  // rounds use (src/worklist.ts), so flipping the Form 6 answer back to "Yes"
  // never leaves a stale "needs assistance" answer sitting on a closed case.
  const form6Assistance =
    form6Submitted === "No" && YES_NO.includes(p.form6_assistance || "") ? (p.form6_assistance as string) : null;
  const noticeReceived = YES_NO.includes(p.notice_received || "") ? (p.notice_received as string) : null;
  const notes = (p.notes || "").trim() || null;

  const existing: any = await getFollowup(db, p.voter_key);
  const now = utcnow();
  if (existing) {
    await db
      .prepare(
        `UPDATE ph_followup SET name=?, house_number_raw=?, part_number=?, epic_id=?,
           blo_contacted=?, form6_submitted=?, form6_assistance=?, notice_received=?, notes=?,
           updated_by=?, updated_at=?
         WHERE voter_key=?`
      )
      .bind(
        p.name || existing.name || null,
        p.house_number_raw || existing.house_number_raw || null,
        p.part_number || existing.part_number || null,
        p.epic_id || existing.epic_id || null,
        bloContacted, form6Submitted, form6Assistance, noticeReceived, notes,
        user.email, now, p.voter_key
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ph_followup
          (voter_key, name, house_number_raw, part_number, epic_id,
           blo_contacted, form6_submitted, form6_assistance, notice_received, notes,
           updated_by, updated_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        p.voter_key, p.name || null, p.house_number_raw || null, p.part_number || null, p.epic_id || null,
        bloContacted, form6Submitted, form6Assistance, noticeReceived, notes,
        user.email, now, now
      )
      .run();
  }
  return getFollowup(db, p.voter_key);
}
