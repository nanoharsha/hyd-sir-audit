// Okhla field verification (migration_020.sql, migration_021.sql). Three forms, chosen by the
// elector's CURRENT tag — ASDD, NOTICE or DELETED — never by the client:
//
//   ASDD    marking correct?; Enumeration Form; Form 6 now? -> help -> given; phone
//   NOTICE  physical copy received?; hearing status; required documents given to the BLO?; phone (optional)
//   DELETED wrongful / valid; (wrongful) aware of the reason?; got the enumeration form?;
//           (got it) submitted it to the BLO?; phone
//
// The ASDD form: a volunteer visits an elector tagged ASDD and records: was the ASDD marking
// correct; if not, what it should not have been; what happened to the
// Enumeration Form; whether Form 6 was submitted now; if not, whether help was
// needed and given; and a mandatory phone number. Answers are validated here —
// a follow-up answer that no longer applies is cleared (same rule as
// src/ph_followup.ts), so flipping an earlier answer never leaves a stale one.
import { CurrentUser, utcnow } from "./records";

export const ASDD_CORRECT = ["yes", "no", "unable"];
export const ENUM_FORM = ["yes", "not_generated", "blo_did_not_collect", "other"]; // blo_did_not_collect is shown as "Uncollected form found with elector"
const YES_NO = ["yes", "no"];
export const HEARING = ["completed", "due", "not_known"];
export const NOTICE_RECEIVED = ["yes", "no", "unable"];
export const DOCS = ["yes", "no", "unaware"];
export const DEL_STATUS = ["wrongful", "valid"];
export const FORM_FOR_STATUS: Record<string, string> = { ASDD: "asdd", NOTICE: "notice", DELETED: "deleted" };

export interface VerifyPayload {
  notice_received?: string;
  hearing_status?: string;
  docs_submitted?: string;
  del_status?: string;
  del_aware?: string;
  del_got_form?: string;
  del_submitted_form?: string;
  asdd_correct?: string;
  wrong_reason?: string;
  enum_form?: string;
  form6_submitted?: string;
  needs_assistance?: string;
  form6_given?: string;
  phone?: string;
  remarks?: string;
}

// Accepts "98765 43210", "+91 98765-43210", "098765 43210"; returns the 10 digits.
export function cleanPhone(raw: string | undefined): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : null;
}

const pick = (v: string | undefined, allowed: string[]) => (allowed.includes(v || "") ? (v as string) : null);

const NONE = {
  asddCorrect: null, wrongReason: null, enumForm: null, form6: null, needs: null, given: null,
  noticeReceived: null, hearing: null, docs: null,
  delStatus: null, delAware: null, delGot: null, delSubmitted: null,
  phone: null as string | null, remarks: null as string | null,
};

export function validate(formType: string, p: VerifyPayload) {
  // No question is mandatory: every answer may be left blank. What IS checked is that an answer, when given, is one of
  // the allowed values, that a typed phone number is a real 10-digit number, and that something was filled in at all
  // (an empty visit would show as "verified" for nobody's answer).
  const remarks = (p.remarks || "").trim() || null;
  const typed = (p.phone || "").trim();
  const phone = typed ? cleanPhone(typed) : null;
  if (typed && !phone) throw new Error("The phone number must be 10 digits (or leave it empty).");

  let out: any;
  if (formType === "notice") {
    const noticeReceived = pick(p.notice_received, NOTICE_RECEIVED);
    out =
      noticeReceived === "unable"
        ? { ...NONE, noticeReceived, remarks } // "unable to verify" ends the form
        : { ...NONE, noticeReceived, hearing: pick(p.hearing_status, HEARING), docs: pick(p.docs_submitted, DOCS), phone, remarks };
  } else if (formType === "deleted") {
    const delStatus = pick(p.del_status, DEL_STATUS);
    if (delStatus === "wrongful") {
      const delGot = pick(p.del_got_form, YES_NO);
      out = { ...NONE, delStatus, delAware: pick(p.del_aware, YES_NO), delGot, delSubmitted: delGot === "yes" ? pick(p.del_submitted_form, YES_NO) : null, phone, remarks };
    } else {
      out = { ...NONE, delStatus, remarks }; // a valid deletion (or no answer yet) carries no follow-up answers
    }
  } else {
    const asddCorrect = pick(p.asdd_correct, ASDD_CORRECT);
    if (asddCorrect === "no") {
      const form6 = pick(p.form6_submitted, YES_NO);
      const needs = form6 === "no" ? pick(p.needs_assistance, YES_NO) : null;
      const given = needs === "yes" ? pick(p.form6_given, YES_NO) : null;
      out = { ...NONE, asddCorrect, wrongReason: null, enumForm: pick(p.enum_form, ENUM_FORM), form6, needs, given, phone, remarks };
    } else {
      out = { ...NONE, asddCorrect, remarks }; // "yes", "unable to verify" or no answer: the form ends there
    }
  }
  if (!Object.values(out).some((v) => v !== null)) throw new Error("Please fill in at least one answer before saving.");
  return out;
}

export async function getVerification(db: D1Database, key: string) {
  return (await db.prepare("SELECT * FROM ok_verification WHERE voter_key = ?").bind(key).first()) || null;
}

// Attach each ASDD elector's saved visit (if any) to the household members the
// screen is about to show. One query per ≤80 EPICs.
export async function attachVerifications(db: D1Database, households: any[]) {
  const keys = new Set<string>();
  for (const h of households) for (const m of h.members) if (FORM_FOR_STATUS[m.status] && m.epic_id) keys.add(normEpic(m.epic_id));
  if (!keys.size) return;
  const list = [...keys];
  const found = new Map<string, any>();
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const res = await db
      .prepare(`SELECT * FROM ok_verification WHERE voter_key IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all();
    for (const r of res.results as any[]) found.set(r.voter_key, r);
  }
  // A saved visit only shows on the card if it was made under the elector's CURRENT tag.
  for (const h of households)
    for (const m of h.members) {
      if (!FORM_FOR_STATUS[m.status] || !m.epic_id) continue;
      const v = found.get(normEpic(m.epic_id)) || null;
      m.verification = v && v.form_type === FORM_FOR_STATUS[m.status] ? v : null;
    }
}

const normEpic = (e: string) => (e || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function saveVerification(db: D1Database, epicRaw: string, p: VerifyPayload, user: CurrentUser) {
  const key = normEpic(epicRaw);
  if (!key) throw new Error("Missing EPIC");
  // The form is decided by the elector's current tag, not by anything the client sends.
  const el: any = await db
    .prepare(
      `SELECT epic_id, name, house_raw, old_part, new_part, status, status_detail FROM ok_electors
        WHERE epic_norm = ? AND status IN ('ASDD','NOTICE','DELETED') ORDER BY id LIMIT 1`
    )
    .bind(key)
    .first();
  if (!el) throw new Error("This elector is not tagged ASDD, Notice or Deleted, so no verification form applies.");
  const formType = FORM_FOR_STATUS[el.status];

  const v = validate(formType, p);
  const now = utcnow();
  const answers = [
    v.asddCorrect, v.wrongReason, v.enumForm, v.form6, v.needs, v.given, v.phone, v.remarks,
    v.noticeReceived, v.hearing, v.docs, v.delStatus, v.delAware, v.delGot, v.delSubmitted,
  ];
  const existing: any = await getVerification(db, key);
  // A save must never ERASE what someone already recorded: an answer left blank in this save keeps the earlier answer
  // (two volunteers can reach the same elector; a stale or shorter form used to wipe the first one's answers).
  // Answers given in this save win; answers that no longer apply (follow-ups of a changed answer) are cleared.
  const SLOTS = ["asddCorrect", "wrongReason", "enumForm", "form6", "needs", "given", "phone", "remarks",
    "noticeReceived", "hearing", "docs", "delStatus", "delAware", "delGot", "delSubmitted"] as const;
  const COLUMN: Record<string, string> = {
    asddCorrect: "asdd_correct", wrongReason: "wrong_reason", enumForm: "enum_form", form6: "form6_submitted", needs: "needs_assistance",
    given: "form6_given", phone: "phone", remarks: "remarks", noticeReceived: "notice_received", hearing: "hearing_status",
    docs: "docs_submitted", delStatus: "del_status", delAware: "del_aware", delGot: "del_got_form", delSubmitted: "del_submitted_form",
  };
  const merged: any = { ...v };
  const info = { by_other: false, other: null as string | null, other_at: null as string | null, conflicts: [] as string[], kept: [] as string[] };
  if (existing && existing.form_type === formType) {
    for (const k of SLOTS) {
      const old = existing[COLUMN[k]];
      if (merged[k] == null && old != null && old !== "") {
        merged[k] = old;
        info.kept.push(COLUMN[k]);
      } else if (merged[k] != null && old != null && old !== "" && merged[k] !== old) {
        info.conflicts.push(COLUMN[k]);
      }
    }
    // a changed answer ends the questions that hang off it
    if (formType === "asdd") {
      if (merged.asddCorrect !== "no") merged.enumForm = merged.form6 = merged.needs = merged.given = merged.phone = null;
      else if (merged.form6 !== "no") merged.needs = merged.given = null;
      else if (merged.needs !== "yes") merged.given = null;
    } else if (formType === "notice") {
      if (merged.noticeReceived === "unable") merged.hearing = merged.docs = merged.phone = null;
    } else if (formType === "deleted") {
      if (merged.delStatus !== "wrongful") merged.delAware = merged.delGot = merged.delSubmitted = merged.phone = null;
      else if (merged.delGot !== "yes") merged.delSubmitted = null;
    }
    if (existing.updated_by && existing.updated_by !== user.email) {
      info.by_other = true;
      info.other_at = existing.updated_at;
      const u: any = await db.prepare("SELECT name FROM users WHERE email = ?").bind(existing.updated_by).first();
      info.other = (u && u.name) || null;
    }
  }
  const final = [
    merged.asddCorrect, merged.wrongReason, merged.enumForm, merged.form6, merged.needs, merged.given, merged.phone, merged.remarks,
    merged.noticeReceived, merged.hearing, merged.docs, merged.delStatus, merged.delAware, merged.delGot, merged.delSubmitted,
  ];
  if (existing) {
    await db
      .prepare(
        `UPDATE ok_verification SET form_type=?, tagged_status=?, tagged_detail=?,
           asdd_correct=?, wrong_reason=?, enum_form=?, form6_submitted=?, needs_assistance=?, form6_given=?, phone=?, remarks=?,
           notice_received=?, hearing_status=?, docs_submitted=?, del_status=?, del_aware=?, del_got_form=?, del_submitted_form=?,
           updated_by=?, updated_at=? WHERE voter_key=?`
      )
      .bind(formType, el.status, el.status_detail, ...final, user.email, now, key)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ok_verification
          (voter_key, form_type, epic_id, name, house_raw, old_part, new_part, tagged_status, tagged_detail,
           asdd_correct, wrong_reason, enum_form, form6_submitted, needs_assistance, form6_given, phone, remarks,
           notice_received, hearing_status, docs_submitted, del_status, del_aware, del_got_form, del_submitted_form,
           verified_by, verified_at, updated_by, updated_at)
         VALUES (${Array(28).fill("?").join(",")})`
      )
      .bind(
        key, formType, el.epic_id, el.name, el.house_raw, el.old_part, el.new_part, el.status, el.status_detail,
        ...final, user.email, now, user.email, now
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO ok_verification_history
         (voter_key, form_type, asdd_correct, wrong_reason, enum_form, form6_submitted, needs_assistance, form6_given, phone, remarks,
          notice_received, hearing_status, docs_submitted, del_status, del_aware, del_got_form, del_submitted_form, saved_by, saved_at)
       VALUES (${Array(19).fill("?").join(",")})`
    )
    .bind(key, formType, ...answers, user.email, now) // history = what was SUBMITTED in this save
    .run();
  const saved: any = await getVerification(db, key);
  return { ...saved, _merge: info };
}
