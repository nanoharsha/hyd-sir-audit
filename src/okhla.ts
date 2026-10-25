// Okhla (AC 54) household-level SIR status register — READ-ONLY.
//
// Tables ok_* (migration_018.sql) hold one row per elector of the Jan-2025
// final roll, each tagged NOTICE / ASDD / DELETED / CLEARED / NO_SIR /
// PENDING / UNLINKED by okhla_import/build_okhla.py. Nothing here touches
// `electors` (Mangolpuri) and nothing here writes — verification fields come
// later.
//
// Why not reuse records.ts search: the whole constituency is 386k rows, so
// (a) house numbers repeat across 279 parts and 345+ blocks — a house search
// is per part; (b) name search uses the ok_tokens word index, not a LIKE
// '%x%' scan of every row (D1 bills rows read); (c) results are grouped into
// households (part + block + house) because the audit works door by door.

import { attachVerifications } from "./okhla_verify";
import { houseNorm } from "./okhla_house";

export const STATUSES = ["NOTICE", "ASDD", "DELETED", "CLEARED", "NO_SIR", "PENDING", "UNLINKED"] as const;

const COLS =
  "id, old_part, serial_2025, section_no, section_name, house_raw, hh_norm, hh_key, house_floor, supplement, epic_id, " +
  "name, relation_type, relation_name, age, gender, status, status_detail, deleted_source, deleted_reason, " +
  "deleted_month, conflict, new_part, new_part_src, draft_serial, in_2025_roll, added_month, name_partial, source, draft_basis, alt_epic_norm, block";

// The audited part range, the parts the team is canvassing, and the manually
// pinned "critical" parts all come from hyd.config.json. Change that file, not
// this one; see its notes for what each setting means.
import { AUDIT_MIN, AUDIT_MAX, CRITICAL_MANUAL, FOCUS_PARTS } from "./hyd_config";
export { AUDIT_MIN, AUDIT_MAX, FOCUS_PARTS };

// Parts outside the range stay fully searchable (EPIC, name, house number) and
// carry the same tags — they just get no picker entry or status tile.
const IN_AUDIT = `old_part BETWEEN ${AUDIT_MIN} AND ${AUDIT_MAX}`;

// The DASHBOARD counts only the booths the team is canvassing. It used to count
// the whole audited range, which put 3,150 electors and 1,312 ASD-D on screen
// when the team works two booths holding 1,839 — a number nobody could act on,
// and one that would be quoted as if it described the fieldwork (owner, 2026-10-25).
// Everything outside the focus stays in the database and stays searchable; it is
// only absent from these aggregates.
const IN_FOCUS = `old_part IN (${FOCUS_PARTS.join(",")})`;

const HH_ORDER = "ORDER BY p, s, n";
const PAGE_SIZE = 25;
const HOUSE_SAFETY_CAP = 6000; // a house search shows EVERY match; this only stops a runaway query
const NAME_LIMIT = 80;
const EPIC_PATTERN = /^[A-Za-z]{3}\d+$/;

// House identity (K78 = K-78, K-78/B = K-78-B = K-78\B ...) lives in ./okhla_house.ts, shared with the builder's rules.

function placeholders(n: number): string {
  return Array(n).fill("?").join(",");
}

// ---- meta: part list + status counts (all from pre-aggregated tables) ----
export async function okhlaMeta(db: D1Database) {
  const [parts, ps, meta, base, blocks] = await Promise.all([
    db
      .prepare(`SELECT old_part, label, localities, new_parts, draft_available, electors FROM ok_parts WHERE ${IN_FOCUS} ORDER BY old_part`)
      .all(),
    db.prepare(`SELECT old_part, status, n FROM ok_part_status WHERE ${IN_FOCUS}`).all(),
    db.prepare("SELECT key, value FROM ok_meta").all(),
    db
      .prepare(
        `SELECT old_part, roll_2025, struck_off_2025, monthly_added, monthly_deleted, draft_total, draft_added
           FROM ok_part_base WHERE ${IN_FOCUS} ORDER BY old_part`
      )
      .all(),
    // every block of every part: the block picker narrows a house search to one block (K-78, never G-78)
    db.prepare("SELECT old_part, block, label, electors FROM ok_blocks ORDER BY block, old_part").all(),
  ]);
  const totals: Record<string, number> = {};
  for (const r of ps.results as any[]) totals[r.status] = (totals[r.status] || 0) + r.n;
  // CRITICAL part = BOTH of:
  //   (ASDD + No SIR) as a share of the base roll total is above average, AND
  //   Notices as a share of the Draft SIR total is above average.
  // Averages are pooled across the FOCUS booths and recomputed on every load, so
  // they follow the data rather than a hard-coded list. No longer surfaced in the
  // picker (the Critical/Other grouping was removed), but still returned.
  const per = new Map<number, any>();
  for (const r of ps.results as any[]) {
    const x = per.get(r.old_part) || { asdd: 0, nosir: 0, notice: 0 };
    if (r.status === "ASDD") x.asdd = r.n;
    if (r.status === "NO_SIR") x.nosir = r.n;
    if (r.status === "NOTICE") x.notice = r.n;
    per.set(r.old_part, x);
  }
  let sAB = 0, sBase = 0, sNot = 0, sDraft = 0;
  const metric = (base.results as any[]).map((b) => {
    const x = per.get(b.old_part) || { asdd: 0, nosir: 0, notice: 0 };
    const baseTotal = b.roll_2025 + b.monthly_added - b.monthly_deleted;
    sAB += x.asdd + x.nosir; sBase += baseTotal; sNot += x.notice; sDraft += b.draft_total;
    return { old_part: b.old_part, ab: x.asdd + x.nosir, base: baseTotal, notice: x.notice, draft: b.draft_total };
  });
  const avgAB = sBase ? sAB / sBase : 0;
  const avgNotice = sDraft ? sNot / sDraft : 0;
  const byRule = metric
    .filter((m) => m.base && m.draft && m.ab / m.base > avgAB && m.notice / m.draft > avgNotice)
    .map((m) => m.old_part);
  // Parts the owner has marked critical by hand, on top of the rule (2026-10-08:
  // part 64 — ASDD count is high in absolute terms though its share is below average).
  const critical = [...new Set([...byRule, ...CRITICAL_MANUAL])].sort((a, b) => a - b);

  return {
    audit_parts: [AUDIT_MIN, AUDIT_MAX],
    // What the figures below actually cover. The client labels the dashboard with
    // this, so the heading can never claim a wider scope than the numbers.
    focus_parts: FOCUS_PARTS,
    critical,
    critical_manual: CRITICAL_MANUAL,
    critical_basis: { avg_asdd_nosir_of_base: avgAB, avg_notice_of_draft: avgNotice, parts: metric },
    parts: parts.results,
    part_status: ps.results,
    part_base: base.results, // the two dashboard headlines are derived from these
    blocks: blocks.results,
    totals,
    meta: Object.fromEntries((meta.results as any[]).map((r) => [r.key, r.value])),
  };
}

// ---- grouping ----
// What changed on the record since the Jan-2025 roll (ok_changes, migration_025.sql), carried on every member as c_*:
// c_fields = what differs on the Draft SIR roll (name,age,gender,relative,house), c_name / c_age / c_gender / c_rel / c_house = the
// draft's printed values, c_mod = months of the monthly modification lists. The card shows c_name as the latest name.
const CHG_COLS = "c.fields AS c_fields, c.d_name AS c_name, c.d_age AS c_age, c.d_gender AS c_gender, c.d_relation_name AS c_rel, c.d_house AS c_house, c.modified_in AS c_mod";
const E_COLS = COLS.split(", ").map((c) => "e." + c).join(", ");
// Possible duplicate entries (ok_twins, migration_026.sql): the same person listed twice on the roll under two EPICs. Carried on
// every member as `twins`, a JSON array of the other entries with their own tag, so a card can show both statuses.
const TWIN_COL =
  "(SELECT json_group_array(json_object('id', t.id, 'epic', t.epic_id, 'name', t.name, 'status', t.status, 'detail', t.status_detail, " +
  "'part', t.old_part, 'new_part', t.new_part, 'serial', t.serial_2025, 'rel_type', t.relation_type, 'rel', t.relation_name)) " +
  "FROM ok_twins w JOIN ok_electors t ON t.id = w.twin_id WHERE w.elector_id = e.id) AS twins";

export async function membersOf(db: D1Database, keys: string[]) {
  const rows: any[] = [];
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    const res = await db
      .prepare(
        `SELECT ${E_COLS}, ${CHG_COLS}, ${TWIN_COL} FROM ok_electors e LEFT JOIN ok_changes c ON c.elector_id = e.id
          WHERE e.hh_key IN (${placeholders(chunk.length)})
          ORDER BY e.old_part, CAST(e.section_no AS INTEGER), e.hh_sort, e.house_floor, e.serial_2025`
      )
      .bind(...chunk)
      .all();
    rows.push(...(res.results as any[]));
  }
  return rows;
}

export function groupHouseholds(rows: any[], keyOrder: string[]) {
  const by = new Map<string, any[]>();
  for (const r of rows) {
    if (!by.has(r.hh_key)) by.set(r.hh_key, []);
    by.get(r.hh_key)!.push(r);
  }
  const out: any[] = [];
  for (const k of keyOrder) {
    const members = by.get(k);
    if (!members) continue;
    // Label = the house number as most often printed for this household.
    const freq = new Map<string, number>();
    for (const m of members) {
      const h0 = String(m.house_raw || "").split(",")[0].trim(); // "K-78, Second Floor" -> "K-78"
      freq.set(h0, (freq.get(h0) || 0) + 1);
    }
    const label = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      hh_key: k,
      old_part: members[0].old_part,
      section_no: members[0].section_no,
      section_name: members[0].section_name,
      hh_norm: members[0].hh_norm,
      house_label: label,
      members,
    });
  }
  return out;
}

const keyOrderOf = (rows: any[]) => [...new Set(rows.map((r) => r.hh_key))];

// ---- search ----
export interface OkhlaQuery {
  q: string;
  part: number | null;
  status: string | null;
  page: number;
  block?: string | null;
}

export async function okhlaSearch(db: D1Database, p: OkhlaQuery) {
  const q = (p.q || "").trim();
  const status = p.status && (STATUSES as readonly string[]).includes(p.status) ? p.status : null;
  // A part outside the audit range is ignored (EPIC lookup is the only way in).
  const part = p.part && p.part >= AUDIT_MIN && p.part <= AUDIT_MAX ? p.part : null;
  const block = p.block && /^[A-Za-z]{1,2}$/.test(p.block) ? p.block.toUpperCase() : null;

  // ---- no query: browse one part, door by door
  if (!q) {
    if (!part) return { mode: "idle", households: [], total_households: 0, page: 0, page_size: PAGE_SIZE };
    const where = ["old_part = ?"];
    const binds: any[] = [part];
    if (block) {
      where.push("block = ?");
      binds.push(block);
    }
    if (status) {
      where.push("status = ?");
      binds.push(status);
    }
    const base = `FROM ok_electors WHERE ${where.join(" AND ")}`;
    const [tot, keys] = await Promise.all([
      db.prepare(`SELECT COUNT(DISTINCT hh_key) n ${base}`).bind(...binds).first<{ n: number }>(),
      db
        .prepare(
          `SELECT hh_key, MIN(old_part) p, MIN(CASE WHEN section_no = '' THEN 9999 ELSE CAST(section_no AS INTEGER) END) s, MIN(hh_sort) n
             ${base} GROUP BY hh_key ${HH_ORDER} LIMIT ? OFFSET ?`
        )
        .bind(...binds, PAGE_SIZE, Math.max(0, p.page) * PAGE_SIZE)
        .all(),
    ]);
    const order = (keys.results as any[]).map((r) => r.hh_key);
    const households = groupHouseholds(await membersOf(db, order), order);
    await attachVerifications(db, households);
    return {
      mode: "browse",
      households,
      total_households: tot?.n ?? 0,
      page: Math.max(0, p.page),
      page_size: PAGE_SIZE,
    };
  }

  let seed: any[] = []; // electors that matched the query itself
  let mode = "name";
  let truncated = false;

  const epicQ = q.toUpperCase().replace(/\s+/g, "");
  if (EPIC_PATTERN.test(epicQ)) {
    // EPIC is the one identifier every list shares, so it looks in EVERY part
    // (not only 59-69) and forgives spaces / case. No exact hit -> EPICs that
    // start with what was typed, so a mistyped last digit still lands nearby.
    mode = "epic";
    const pc = (part ? " AND old_part = ?" : "") + (block ? " AND block = ?" : "");
    const pbind = [...(part ? [part] : []), ...(block ? [block] : [])];
    let res = await db
      // alt_epic_norm: the other EPIC of a voter whose EPIC was re-issued — either finds them
      .prepare(`SELECT ${COLS} FROM ok_electors WHERE (epic_norm = ? OR alt_epic_norm = ?)${pc} LIMIT 20`)
      .bind(epicQ, epicQ, ...pbind)
      .all();
    if (!res.results.length && epicQ.length >= 6) {
      res = await db
        .prepare(`SELECT ${COLS} FROM ok_electors WHERE epic_norm LIKE ?${pc} ORDER BY epic_norm LIMIT 20`)
        .bind(epicQ + "%", ...pbind)
        .all();
      if (res.results.length) mode = "epic_prefix";
    }
    seed = res.results as any[];
  } else if (/\d/.test(q)) {
    mode = "house";
    const norm = houseNorm(q);
    const extra = (part ? " AND old_part = ?" : "") + (block ? " AND block = ?" : "");
    const pb = [...(part ? [part] : []), ...(block ? [block] : [])];
    // A house is the block letter + number (K78) and, optionally, sub-parts (K78/A). Typing "K-78" shows K78 and its
    // sub-houses K78/A, K78/B ... (they are different houses, listed one after the other). A bare "78" also shows the
    // lettered houses (K78 ...): in the chosen block if one is picked, otherwise in any block.
    const lettered = /^[A-Z]/.test(norm);
    const pats: string[] = [norm, norm + "/*"];
    if (!lettered) {
      if (block) pats.push(block + norm, block + norm + "/*");
      else pats.push("[A-Z]" + norm, "[A-Z]" + norm + "/*");
    }
    const cond = pats.map((x, i) => (i === 0 ? "hh_norm = ?" : "hh_norm GLOB ?")).join(" OR ");
    const sel = `SELECT hh_key, MIN(old_part) p, MIN(CASE WHEN section_no = '' THEN 9999 ELSE CAST(section_no AS INTEGER) END) s, MIN(hh_sort) n FROM ok_electors`;
    let res = await db
      .prepare(`${sel} WHERE (${cond})${extra} GROUP BY hh_key ${HH_ORDER} LIMIT ?`)
      .bind(...pats, ...pb, HOUSE_SAFETY_CAP)
      .all();
    if (!res.results.length && norm) {
      // nothing at that exact number: houses that START with what was typed ("25" -> 251, 25B ...)
      res = await db
        .prepare(`${sel} WHERE hh_norm LIKE ?${extra} GROUP BY hh_key ${HH_ORDER} LIMIT ?`)
        .bind(norm + "%", ...pb, HOUSE_SAFETY_CAP)
        .all();
      mode = "house_prefix";
    }
    const order = (res.results as any[]).map((r) => r.hh_key);
    let households = groupHouseholds(await membersOf(db, order), order);
    if (status) households = households.filter((h) => h.members.some((m: any) => m.status === status));
    if (mode === "house" && households.some((h) => h.hh_norm !== norm)) mode = "house_letter";
    const partsHit = new Set(households.map((h) => h.old_part));
    await attachVerifications(db, households);
    return {
      mode,
      households,
      truncated: false, // no limit: every household at that number is returned
      total_households: households.length,
      // A bare house number exists in many parts — nudge towards picking one.
      need_part: !part && !block && partsHit.size > 1,
      page: 0,
      page_size: households.length,
    };
  } else {
    // ---- name
    const words = q.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 2);
    if (!words.length) return { mode: "name", households: [], seed_ids: [], truncated: false };
    const filt = words.map(() => "e.name_upper LIKE ?");
    const likeBinds = words.map((w) => `%${w}%`);
    const stat = (status ? " AND e.status = ?" : "") + (block ? " AND e.block = ?" : "");
    const sb = [...(status ? [status] : []), ...(block ? [block] : [])];
    let res;
    if (part) {
      // One part is ~1,400 rows: scanning it is cheaper than the token join.
      res = await db
        .prepare(
          `SELECT ${COLS.split(", ").map((c) => "e." + c).join(", ")} FROM ok_electors e
            WHERE e.old_part = ? AND ${filt.join(" AND ")}${stat} ORDER BY e.name LIMIT ?`
        )
        .bind(part, ...likeBinds, ...sb, NAME_LIMIT + 1)
        .all();
    } else {
      const lead = [...words].sort((a, b) => b.length - a.length)[0];
      const hi = lead.slice(0, -1) + String.fromCharCode(lead.charCodeAt(lead.length - 1) + 1);
      res = await db
        .prepare(
          `SELECT ${COLS.split(", ").map((c) => "e." + c).join(", ")}
             FROM ok_tokens t JOIN ok_electors e ON e.id = t.elector_id
            WHERE t.token >= ? AND t.token < ? AND ${filt.join(" AND ")}${stat}
            ORDER BY e.name LIMIT ?`
        )
        .bind(lead, hi, ...likeBinds, ...sb, NAME_LIMIT + 1)
        .all();
    }
    seed = res.results as any[];
    if (seed.length > NAME_LIMIT) {
      truncated = true;
      seed = seed.slice(0, NAME_LIMIT);
    }
  }

  // EPIC / name: expand every matched elector to their whole household.
  const order = keyOrderOf(seed);
  const households = groupHouseholds(await membersOf(db, order), order);
  await attachVerifications(db, households);
  return {
    mode,
    households,
    seed_ids: seed.map((r) => r.id),
    truncated,
    need_part: false,
    page: 0,
    page_size: 25,
  };
}

// ---- offline copy: the audit parts' electors and saved visits, for searching and entering data with no signal ----
export async function okhlaOfflinePack(db: D1Database, part: number) {
  if (!(part >= AUDIT_MIN && part <= AUDIT_MAX)) return { part, rows: [] };
  const res = await db
    .prepare(`SELECT ${E_COLS}, e.epic_norm, e.hh_sort, ${CHG_COLS}, ${TWIN_COL} FROM ok_electors e LEFT JOIN ok_changes c ON c.elector_id = e.id WHERE e.old_part = ? ORDER BY e.id`)
    .bind(part)
    .all();
  return { part, rows: res.results };
}
export async function okhlaOfflineVisits(db: D1Database) {
  const res = await db.prepare(`SELECT * FROM ok_verification WHERE ${IN_AUDIT}`).all();
  return { rows: res.results };
}
