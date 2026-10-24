// The SEARCH tab: one search box across every list we hold on a voter —
// the base electoral roll (incl. field additions), the published Draft SIR
// 2026 roll, and the ASDD removal list — merged into one row per person by
// EPIC (falling back to the base-roll row id for the rare field addition
// with no EPIC yet). Read-only against electors/asddo/draft_sir; writes only
// to the separate ph_remarks table (migration_013, migration_015 — the
// "Public Hearing" participation flow).
import { tokenizeHouseNumber } from "./house";
import { EPIC_PATTERN, CurrentUser, utcnow } from "./records";
import { savePhoto } from "./uploads";

type Row = Record<string, any>;

function matchWhere(kind: "epic" | "house" | "name", epicExpr: string) {
  if (kind === "epic") return `${epicExpr} = ?`;
  if (kind === "house")
    return `(house_base = ? OR (? IS NOT NULL AND house_range_end_num IS NOT NULL AND house_base_num <= ? AND house_range_end_num >= ?) OR UPPER(TRIM(house_number_raw)) = UPPER(TRIM(?)) OR house_number_raw LIKE ?)`;
  return `(UPPER(name) LIKE ? OR UPPER(relation_name) LIKE ?)`;
}
function matchBinds(kind: "epic" | "house" | "name", q: string, base: string, qNum: number | null) {
  if (kind === "epic") return [q];
  if (kind === "house") return [base, qNum, qNum, qNum, q, `%${q}%`];
  const up = q.toUpperCase();
  return [`%${up}%`, `%${up}%`];
}

const CASE_ID_PATTERN = /^PH-\d+$/i;

export async function searchAll(db: D1Database, qRaw: string): Promise<any> {
  const q = (qRaw || "").trim();
  if (!q) return { results: [], match_type: "empty" };

  // A Case ID (PH-00001) resolves to the case's voter — search on that
  // voter's EPIC (or name, for the rare EPIC-less field addition) instead,
  // so a returning voter's slip pulls up their whole record + case history.
  if (CASE_ID_PATTERN.test(q)) {
    const remark = await db
      .prepare("SELECT * FROM ph_remarks WHERE case_id = ? COLLATE NOCASE")
      .bind(q.toUpperCase())
      .first<Row>();
    if (!remark) return { results: [], match_type: "case_id_none" };
    const followUp = remark.epic_id || remark.name;
    if (!followUp) return { results: [], match_type: "case_id_none" };
    const inner = await searchAll(db, followUp);
    return { ...inner, match_type: "case_id", resolved_case_id: remark.case_id };
  }

  const resolvedKind: "epic" | "house" | "name" = EPIC_PATTERN.test(q) ? "epic" : !/\d/.test(q) ? "name" : "house";
  const { base } = tokenizeHouseNumber(q);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;
  const epicQ = q.toUpperCase().replace(/\s+/g, "");

  const elWhere = matchWhere(resolvedKind, "UPPER(REPLACE(epic_id,' ',''))");
  const elBinds = matchBinds(resolvedKind, resolvedKind === "epic" ? epicQ : q, base, qNum);
  const asddoWhere = matchWhere(resolvedKind, "epic_norm");
  const asddoBinds = matchBinds(resolvedKind, resolvedKind === "epic" ? epicQ : q, base, qNum);

  const [elRes, asddoRes, dsRes] = await Promise.all([
    db
      .prepare(
        `SELECT id, part_number, sr_no, house_number_raw, house_base, house_base_num, epic_id,
                UPPER(REPLACE(epic_id,' ','')) AS epic_norm, name, relation_type, relation_name, age, gender,
                added_in_field, verification_status, sub_category, verified_by, verified_at
           FROM electors WHERE ${elWhere} LIMIT 300`
      )
      .bind(...elBinds)
      .all(),
    db
      .prepare(
        `SELECT id, old_part, new_part, old_sr, s_no, house_number_raw, epic_id, epic_norm, name, relation_type,
                relation_name, age, gender, asddo_reason, base_elector_id, re_status, re_outcome,
                re_verified_by, re_verified_at
           FROM asddo WHERE ${asddoWhere} LIMIT 300`
      )
      .bind(...asddoBinds)
      .all(),
    db
      .prepare(
        `SELECT id, old_part, new_part, old_sr, house_number_raw, epic_id, epic_norm, name, relation_type,
                relation_name, age, gender, base_elector_id, in_draft, re_status, re_outcome,
                re_verified_by, re_verified_at
           FROM draft_sir WHERE in_draft = 1 AND (${asddoWhere}) LIMIT 300`
      )
      .bind(...asddoBinds)
      .all(),
  ]);

  const groups = new Map<string, Row>();
  const keyFor = (epicNorm: string | null, fallback: string) =>
    epicNorm && epicNorm.trim() ? epicNorm.trim() : fallback;

  for (const r of elRes.results as Row[]) {
    const k = keyFor(r.epic_norm, `elector:${r.id}`);
    groups.set(k, { key: k, elector: r, asddo: null, draftsir: null });
  }
  for (const r of asddoRes.results as Row[]) {
    const k = keyFor(r.epic_norm, `asddo:${r.id}`);
    const g = groups.get(k) || { key: k, elector: null, asddo: null, draftsir: null };
    g.asddo = r;
    groups.set(k, g);
  }
  for (const r of dsRes.results as Row[]) {
    const k = keyFor(r.epic_norm, `draftsir:${r.id}`);
    const g = groups.get(k) || { key: k, elector: null, asddo: null, draftsir: null };
    g.draftsir = r;
    groups.set(k, g);
  }

  const REASON_LABEL: Record<string, string> = {
    Death: "Death",
    "Permanently Shifted": "Permanently Shifted",
    "Untraceable/Absent": "Absent / Untraceable",
    "Already enrolled": "Already Enrolled",
  };

  const shaped = [...groups.values()].map((g) => {
    const e = g.elector,
      a = g.asddo,
      d = g.draftsir;
    const name = e?.name || d?.name || a?.name;
    const house = e?.house_number_raw || d?.house_number_raw || a?.house_number_raw || null;
    const epic = e?.epic_id || d?.epic_id || a?.epic_id || null;
    const relation = (e?.relation_name && `${e.relation_type || ""} ${e.relation_name}`.trim()) ||
      (d?.relation_name && `${d.relation_type || ""} ${d.relation_name}`.trim()) ||
      (a?.relation_name && `${a.relation_type || ""} ${a.relation_name}`.trim()) || null;
    const age = e?.age ?? d?.age ?? a?.age ?? null;
    const gender = e?.gender ?? d?.gender ?? a?.gender ?? null;

    let part: string | null, sr: string | null, partSource: string;
    if (e) { part = e.part_number; sr = e.sr_no; partSource = "base"; }
    else if (d) { part = d.new_part; sr = d.old_sr; partSource = "draftsir"; }
    else { part = a!.old_part; sr = a!.old_sr; partSource = "asddo"; }

    let sirStatusKind: string, sirStatusDetail: string | null = null;
    if (a) { sirStatusKind = "asddo"; sirStatusDetail = REASON_LABEL[a.asddo_reason] || a.asddo_reason; }
    else if (d) { sirStatusKind = "sir"; }
    else if (e && e.added_in_field) { sirStatusKind = "field_addition"; }
    else { sirStatusKind = "no_sir"; }

    // Most-updated field verification: base-roll verification vs. either
    // re-verification round, whichever has the later timestamp wins.
    const baseVerif = e && e.verification_status && e.verification_status !== "Not Started"
      ? { status: e.verification_status, sub: e.sub_category, by: e.verified_by, at: e.verified_at, round: "base" as const }
      : null;
    const reVerif =
      (a && a.re_status === "Done"
        ? { status: a.re_outcome, sub: null, by: a.re_verified_by, at: a.re_verified_at, round: "asddo" as const }
        : null) ||
      (d && d.re_status === "Done"
        ? { status: d.re_outcome, sub: null, by: d.re_verified_by, at: d.re_verified_at, round: "draftsir" as const }
        : null);
    let verif = null as null | { status: string; sub: string | null; by: string | null; at: string | null; round: string };
    if (baseVerif && reVerif) verif = (reVerif.at || "") >= (baseVerif.at || "") ? reVerif : baseVerif;
    else verif = reVerif || baseVerif;

    return {
      key: g.key,
      name,
      house_number_raw: house,
      epic_id: epic,
      relation,
      age,
      gender,
      part_number: part,
      sr_no: sr,
      part_source: partSource, // "base" | "draftsir" | "asddo" — which list the part/sr came from
      sir_status_kind: sirStatusKind, // "sir" | "asddo" | "no_sir" | "field_addition"
      sir_status_detail: sirStatusDetail, // ASDD reason, when sir_status_kind === "asddo"
      draft_part: d ? d.new_part : null,
      draft_sr: d ? d.old_sr : null,
      asddo_part: a ? a.new_part : null,
      asddo_sr: a ? a.s_no : null,
      verif_status: verif?.status || null,
      verif_sub: verif?.sub || null,
      verif_round: verif?.round || null, // "base" | "asddo" | "draftsir" | null (Not Started)
      verif_by: verif?.by || null,
      verif_at: verif?.at || null,
      in_base_roll: !!e,
      in_sir: !!d,
      in_asddo: !!a,
    };
  });

  shaped.sort((x, y) => (x.name || "").localeCompare(y.name || ""));
  const capped = shaped.slice(0, 200);

  if (!capped.length) return { results: [], match_type: "none" };

  const keys = capped.map((r) => r.key);
  const placeholders = keys.map(() => "?").join(",");
  const remarks = keys.length
    ? ((await db.prepare(`SELECT * FROM ph_remarks WHERE voter_key IN (${placeholders})`).bind(...keys).all())
        .results as Row[])
    : [];
  const remarkByKey = new Map(remarks.map((r) => [r.voter_key, r]));
  for (const r of capped as any[]) r.ph_remark = remarkByKey.get(r.key) || null;

  return { results: capped, match_type: resolvedKind, truncated: shaped.length > capped.length };
}

// --------------------------------------------------------------------------
// Government marking / status for a known set of voter_keys — the PH FOLLOW
// UP tab's "PH Status" tag. Same three-list logic searchAll() uses to shape
// sir_status_kind, but scoped to exactly the keys asked for (a page of PH
// cases, typically well under a couple hundred) rather than a live search, so
// it can enrich an already-loaded case list without re-running searchAll per
// row. Returns the raw asddo_reason (not pre-labelled) so the client
// translates it with the same asddoReasonX i18n keys the ASDD List tab uses.
// --------------------------------------------------------------------------
export interface VoterStatus {
  kind: "sir" | "asddo" | "no_sir" | "field_addition";
  reason: string | null; // asddo_reason, only when kind === "asddo"
}

export async function statusForKeys(db: D1Database, keys: string[]): Promise<Record<string, VoterStatus>> {
  const out: Record<string, VoterStatus> = {};
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (!uniq.length) return out;

  const epicKeys: string[] = [];
  const electorIds: number[] = [];
  for (const k of uniq) {
    if (k.startsWith("elector:")) {
      const id = parseInt(k.slice("elector:".length), 10);
      if (!isNaN(id)) electorIds.push(id);
    } else {
      epicKeys.push(k);
    }
  }

  const epicPh = epicKeys.length ? epicKeys.map(() => "?").join(",") : null;
  const idPh = electorIds.length ? electorIds.map(() => "?").join(",") : null;

  const [elRes, asddoRes, dsRes] = await Promise.all([
    epicPh || idPh
      ? db
          .prepare(
            `SELECT id, UPPER(REPLACE(epic_id,' ','')) AS epic_norm, added_in_field FROM electors
             WHERE ${epicPh ? `UPPER(REPLACE(epic_id,' ','')) IN (${epicPh})` : "0"}
                OR ${idPh ? `id IN (${idPh})` : "0"}`
          )
          .bind(...epicKeys, ...electorIds)
          .all()
      : Promise.resolve({ results: [] as any[] }),
    epicPh
      ? db.prepare(`SELECT epic_norm, asddo_reason FROM asddo WHERE epic_norm IN (${epicPh})`).bind(...epicKeys).all()
      : Promise.resolve({ results: [] as any[] }),
    epicPh
      ? db
          .prepare(`SELECT epic_norm FROM draft_sir WHERE in_draft = 1 AND epic_norm IN (${epicPh})`)
          .bind(...epicKeys)
          .all()
      : Promise.resolve({ results: [] as any[] }),
  ]);

  const electorByEpic = new Map<string, Row>();
  const electorById = new Map<number, Row>();
  for (const r of elRes.results as Row[]) {
    if (r.epic_norm) electorByEpic.set(r.epic_norm, r);
    electorById.set(r.id, r);
  }
  const asddoByEpic = new Map((asddoRes.results as Row[]).map((r) => [r.epic_norm, r]));
  const draftEpics = new Set((dsRes.results as Row[]).map((r) => r.epic_norm));

  for (const k of uniq) {
    const isElectorKey = k.startsWith("elector:");
    const elector = isElectorKey
      ? electorById.get(parseInt(k.slice("elector:".length), 10))
      : electorByEpic.get(k);
    const asddo = !isElectorKey ? asddoByEpic.get(k) : undefined;
    const inDraft = !isElectorKey && draftEpics.has(k);
    if (asddo) out[k] = { kind: "asddo", reason: asddo.asddo_reason || null };
    else if (inDraft) out[k] = { kind: "sir", reason: null };
    else if (elector && elector.added_in_field) out[k] = { kind: "field_addition", reason: null };
    else out[k] = { kind: "no_sir", reason: null };
  }
  return out;
}

// --------------------------------------------------------------------------
// Public Hearing
// --------------------------------------------------------------------------
const CASE_TYPES = ["Wrong ASDD Marking", "No SIR", "SIR Correction Request"];
const YES_NO = ["Yes", "No"];
const SIR_MODE = ["Online", "Offline"];
const CORRECTION_FIELDS = ["Name", "Address", "Age", "Sex", "Relative Name", "Relative Type", "Other"];
const PARTICIPATION_TYPES = ["Testimony", "Support / Assistance", "Other"];
const SUPPORT_TYPES = ["Form 6 - Self Filling", "Form 6 - Assisted", "Other"];
const PHONE_PATTERN = /^\d{10}$/;

// Booth-wise BLO contacts (owner-supplied, 2026-09-05), keyed by this SIR
// round's "old" part numbers 119-126. The redelimited "new" numbering
// (122-129) maps onto the same eight booths, offset by +3 — confirmed
// against the dominant old_part/new_part pairing already recorded on the
// asddo/draft_sir tables (a few boundary voters carry a different pairing;
// this offset is the modal one and the only one the owner's booth list
// covers). Exported so callers can resolve either numbering to one contact.
// Empty until Secunderabad Cantt BLO details are supplied. The Delhi contacts
// that used to live here were for a different constituency and were stripped;
// bloForPart() returns null for an unknown booth, so the Testimony follow-up
// shows no contact rather than a wrong one.
const BLO_BY_OLD_PART: Record<string, { name: string; phone: string }> = {};

// Secunderabad Cantt (AC 71): the 2026 SIR Draft Roll renumbered every part up
// by one against the 2025 Final Roll — 2025 part N is 2026 part N+1. Verified
// two ways: the polling-station section lists match at that offset (2025 p149
// "Kubara Towers / Shasatri Nagar" at St. Joseph School is 2026 p150 with an
// identical section list), and 484 of the 494 part-151 notice EPICs resolve
// into 2025 part 150. Delhi's offset was +3 (119-126 -> 122-129) — do not
// copy that mapping here.
const NEW_TO_OLD_PART: Record<string, string> = { "150": "149", "151": "150", "152": "151" };
const OLD_TO_NEW_PART: Record<string, string> = { "149": "150", "150": "151", "151": "152" };

// Returns both booth numbers for the resolved contact — a surveyor needs to
// match either numbering scheme against whatever's printed on the voter's
// slip, rather than guessing which one their part number belongs to (owner
// request, 2026-09-05).
export function bloForPart(partNumber: string | null | undefined) {
  if (!partNumber) return null;
  const p = String(partNumber).trim();
  const oldBooth = BLO_BY_OLD_PART[p] ? p : NEW_TO_OLD_PART[p] || null;
  if (!oldBooth) return null;
  const rec = BLO_BY_OLD_PART[oldBooth];
  if (!rec) return null;
  return { oldBooth, newBooth: OLD_TO_NEW_PART[oldBooth] || null, name: rec.name, phone: rec.phone };
}

export interface Stage1Payload {
  voter_key: string;
  name?: string | null;
  house_number_raw?: string | null;
  part_number?: string | null;
  epic_id?: string | null;
  case_type: string;
  sir_submitted?: string | null;
  sir_submit_mode?: string | null;
  sir_has_receipt?: string | null;
  correction_fields?: string[] | null;
  correction_other?: string | null;
  participation_type: string;
  phone: string;
  root_cause?: string | null; // Testimony — "Description of the Issue"
  support_type?: string | null; // Support / Assistance
  knows_blo?: string | null; // Support / Assistance — shares the BLO-contact share with Testimony's stage 2
  remarks?: string | null; // Other
}

export async function getRemark(db: D1Database, voterKey: string) {
  const row = await db.prepare("SELECT * FROM ph_remarks WHERE voter_key = ?").bind(voterKey).first();
  return row || null;
}

// Full dump for the offline cache — the SEARCH tab works with no signal the
// same way the roll/asddo/draft_sir caches do. Case count stays small (one
// row per public-hearing case), so shipping it whole each refresh is fine.
export async function allRemarks(db: D1Database) {
  const res = await db.prepare("SELECT * FROM ph_remarks").all();
  return res.results;
}

export async function saveStage1(db: D1Database, p: Stage1Payload, user: CurrentUser) {
  if (!p.voter_key) throw new Error("Missing voter");
  if (!CASE_TYPES.includes(p.case_type)) throw new Error(`Choose one of: ${CASE_TYPES.join(" / ")}`);

  let sirSubmitted: string | null = null, sirMode: string | null = null, sirReceipt: string | null = null;
  if (p.case_type === "No SIR") {
    sirSubmitted = YES_NO.includes(p.sir_submitted || "") ? (p.sir_submitted as string) : null;
    if (sirSubmitted === "Yes") {
      sirMode = SIR_MODE.includes(p.sir_submit_mode || "") ? (p.sir_submit_mode as string) : null;
      sirReceipt = YES_NO.includes(p.sir_has_receipt || "") ? (p.sir_has_receipt as string) : null;
    }
  }
  let correctionFields: string | null = null, correctionOther: string | null = null;
  if (p.case_type === "SIR Correction Request") {
    const fields = (p.correction_fields || []).filter((f) => CORRECTION_FIELDS.includes(f));
    correctionFields = fields.length ? JSON.stringify(fields) : null;
    correctionOther = fields.includes("Other") ? (p.correction_other || "").trim() || null : null;
  }

  // Public Hearing Participation — required for every case, along with a
  // verified contact number, regardless of case_type. Which extra field
  // comes with it depends on the branch: Testimony answers a description of
  // the issue right here (the BLO follow-up is a separate stage 2); Support
  // / Assistance picks a solution type and the case is complete right here
  // (no stage 2); Other just takes a note. Validated server-side too, not
  // just in the form, since a queued offline op replays through here as-is.
  if (!PARTICIPATION_TYPES.includes(p.participation_type))
    throw new Error(`Choose a Public Hearing Participation type: ${PARTICIPATION_TYPES.join(" / ")}`);
  const participationType = p.participation_type;
  const phone = (p.phone || "").trim();
  if (!PHONE_PATTERN.test(phone)) throw new Error("Enter a valid 10-digit contact number.");

  const existing = await getRemark(db, p.voter_key);
  // Branch-specific fields default to whatever the case already has, so
  // switching case_type/participation back and forth on an existing case
  // never wipes a field that belongs to a different branch (in particular,
  // Testimony's follow-up remarks, entered separately in Stage 2).
  let rootCause = (existing as any)?.root_cause ?? null;
  let supportType = (existing as any)?.support_type ?? null;
  let remarks = (existing as any)?.remarks ?? null;
  // knows_blo is shared with Testimony's stage-2 follow-up (saveStage2 below)
  // — only the Support / Assistance branch writes it here, since that branch
  // has no stage 2 of its own to ask it in (owner request, 2026-09-05: the
  // BLO-contact share applies to both Testimony and Support / Assistance).
  let knowsBlo = (existing as any)?.knows_blo ?? null;
  if (participationType === "Testimony") {
    rootCause = (p.root_cause || "").trim() || null;
  } else if (participationType === "Support / Assistance") {
    supportType = SUPPORT_TYPES.includes(p.support_type || "") ? p.support_type : null;
    knowsBlo = YES_NO.includes(p.knows_blo || "") ? (p.knows_blo as string) : null;
  } else {
    remarks = (p.remarks || "").trim() || null;
  }

  const now = utcnow();
  if (existing) {
    await db
      .prepare(
        `UPDATE ph_remarks SET name=?, house_number_raw=?, part_number=?, epic_id=?,
           case_type=?, sir_submitted=?, sir_submit_mode=?, sir_has_receipt=?,
           correction_fields=?, correction_other=?, participation_type=?, phone=?,
           root_cause=?, support_type=?, knows_blo=?, remarks=?, stage1_by=?, stage1_at=?, updated_at=?
         WHERE voter_key=?`
      )
      .bind(
        p.name || null, p.house_number_raw || null, p.part_number || null, p.epic_id || null,
        p.case_type, sirSubmitted, sirMode, sirReceipt, correctionFields, correctionOther,
        participationType, phone, rootCause, supportType, knowsBlo, remarks,
        user.email, now, now, p.voter_key
      )
      .run();
  } else {
    const res = await db
      .prepare(
        `INSERT INTO ph_remarks
          (voter_key, name, house_number_raw, part_number, epic_id, case_type,
           sir_submitted, sir_submit_mode, sir_has_receipt, correction_fields, correction_other,
           participation_type, phone, root_cause, support_type, knows_blo, remarks,
           stage1_by, stage1_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        p.voter_key, p.name || null, p.house_number_raw || null, p.part_number || null, p.epic_id || null,
        p.case_type, sirSubmitted, sirMode, sirReceipt, correctionFields, correctionOther,
        participationType, phone, rootCause, supportType, knowsBlo, remarks,
        user.email, now, now, now
      )
      .run();
    // Case ID is generated once, off the row's own id, so it's simple,
    // sequential and permanently unique — "PH-" + the id, zero-padded.
    // It never changes once assigned, even if the case is later edited.
    const newId = res.meta.last_row_id as number;
    const caseId = `PH-${String(newId).padStart(5, "0")}`;
    await db.prepare("UPDATE ph_remarks SET case_id = ? WHERE id = ?").bind(caseId, newId).run();
  }
  return getRemark(db, p.voter_key);
}

// Stage 2 — the Testimony follow-up only (Support/Assistance and Other are
// complete after Stage 1). "photo" is either a new data: URL to upload, an
// existing "ph/<id>/..." key to keep as-is, or null/"" to clear it — same
// convention as the reverification rounds' photo fields (src/worklist.ts).
export interface Stage2Payload {
  knows_blo?: string | null;
  brought_to_blo?: string | null;
  remarks?: string | null;
  photo?: string | null;
}

export async function saveStage2(
  db: D1Database,
  voterKey: string,
  p: Stage2Payload,
  user: CurrentUser,
  bucket?: R2Bucket
) {
  const existing: any = await getRemark(db, voterKey);
  if (!existing) throw new Error("Record the case type first.");
  const knowsBlo = YES_NO.includes(p.knows_blo || "") ? p.knows_blo : null;
  const broughtToBlo = knowsBlo === "Yes" && YES_NO.includes(p.brought_to_blo || "") ? p.brought_to_blo : null;
  const remarks = (p.remarks || "").trim() || null;

  const keyPrefix = `ph/${existing.id}/`;
  let photoKey: string | null = existing.photo_key || null;
  if (typeof p.photo === "string" && p.photo.startsWith("data:")) {
    if (bucket) photoKey = await savePhoto(bucket, existing.id, p.photo, "ph/");
  } else if (typeof p.photo === "string" && p.photo.startsWith(keyPrefix)) {
    photoKey = p.photo;
  } else if (p.photo === null || p.photo === "") {
    photoKey = null;
  }

  const now = utcnow();
  await db
    .prepare(
      `UPDATE ph_remarks SET knows_blo=?, brought_to_blo=?, remarks=?, photo_key=?,
         stage2_by=?, stage2_at=?, updated_at=? WHERE voter_key=?`
    )
    .bind(knowsBlo, broughtToBlo, remarks, photoKey, user.email, now, now, voterKey)
    .run();
  return getRemark(db, voterKey);
}
