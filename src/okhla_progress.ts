// Field-verification PROGRESS: how much of the audit worklist (the focus parts in hyd.config.json,
// Deleted) has a saved visit, house by house and elector by elector, and what the visits found.
// Every figure on the dashboard has a `kind` here that returns the matching list (okhlaList), shown as household cards.

import { membersOf, groupHouseholds } from "./okhla";
import { attachVerifications } from "./okhla_verify";
import { FOCUS_PARTS, partLabel } from "./hyd_config";

const PAGE = 25;
// The dashboard covers only what the field team has started. Built from the focus
// parts in hyd.config.json, so taking on another booth is a config change rather
// than an edit here. A part outside the focus list stays fully searchable and
// keeps its status tiles (AUDIT_MIN/MAX in okhla.ts) — it just has no fieldwork row.
//
// `block` is null throughout: Secunderabad house numbers are not block-lettered
// the way Okhla's K-78 / G-10 are, so there is nothing to split a part by. If a
// constituency ever needs block-level rows, add them here by hand. Delhi's
// entries were part 65 and parts 61 block G / F.
//
// Labels come from partLabel(), which always names BOTH numbering schemes: a
// surveyor holds 2026 paperwork while this query filters on 2025 numbers, so a
// bare number means different places to the reader and to the code.
export const PROGRESS_SCOPE: { key: string; part: number; block: string | null; label: string }[] =
  FOCUS_PARTS.map((part) => ({ key: String(part), part, block: null, label: partLabel(part) }));
const TODAY = "date(v.verified_at,'+330 minutes') = date('now','+330 minutes')"; // IST

// The worklist: one row per elector who needs a visit, with their saved visit (if the visit matches the current tag).
const WORKLIST = `
  FROM ok_electors e
  LEFT JOIN ok_verification v ON v.voter_key = e.epic_norm
       AND v.form_type = CASE e.status
             WHEN 'ASDD' THEN 'asdd' WHEN 'NOTICE' THEN 'notice'
             WHEN 'CLEARED' THEN 'cleared' WHEN 'NO_SIR' THEN 'nosir' ELSE 'deleted' END
  WHERE (${PROGRESS_SCOPE.map((x) => `(e.old_part = ${x.part}${x.block ? ` AND e.block = '${x.block}'` : ""})`).join(" OR ")})
    AND e.status IN ('ASDD','NOTICE','DELETED','CLEARED','NO_SIR')`;

// A reason filter narrows the worklist to one ASD-D or notice reason, so a team can
// work "everyone marked Dead" in one pass. Joins ok_elector_reasons rather than
// matching substrings of status_detail — see migration_027.sql for why.
function reasonClause(reason: string | null) {
  if (!reason) return { sql: "", binds: [] as any[] };
  return {
    sql: " AND EXISTS (SELECT 1 FROM ok_elector_reasons r WHERE r.elector_id = e.id AND r.reason = ?)",
    binds: [reason],
  };
}

function scope(key: string | null) {
  const x = key ? PROGRESS_SCOPE.find((y) => y.key === key) : null;
  if (!x) return { sql: "", binds: [] as any[], key: null as string | null };
  return { sql: ` AND e.old_part = ?${x.block ? " AND e.block = ?" : ""}`, binds: x.block ? [x.part, x.block] : [x.part], key: x.key };
}

export async function okhlaProgress(db: D1Database, key: string | null, reason: string | null = null) {
  const sc = scope(key);
  const rc = reasonClause(reason);
  // Every figure below is filtered the same way, so a chosen reason narrows the
  // whole dashboard rather than only the list underneath it.
  const scoped = sc.sql + rc.sql;
  const allBinds = [...sc.binds, ...rc.binds];
  const q = (sql: string) => db.prepare(sql).bind(...allBinds).all();
  const [byStatus, houses, asdd, notice, deleted, byPart, today, who, clearedQ, nosirQ] = await Promise.all([
    q(`SELECT e.status s, COUNT(*) total, SUM(v.voter_key IS NOT NULL) done ${WORKLIST}${scoped} GROUP BY e.status`),
    q(`SELECT COUNT(*) total, SUM(d = n) done, SUM(d > 0 AND d < n) partial, SUM(d = 0) none FROM
         (SELECT e.hh_key, COUNT(*) n, SUM(v.voter_key IS NOT NULL) d ${WORKLIST}${scoped} GROUP BY e.hh_key)`),
    q(`SELECT COALESCE(v.asdd_correct,'blank') a, COUNT(*) n ${WORKLIST}${scoped} AND e.status='ASDD' AND v.voter_key IS NOT NULL GROUP BY 1`),
    q(`SELECT COALESCE(v.notice_received,'blank') recv, COALESCE(v.hearing_status,'blank') hearing, COALESCE(v.docs_submitted,'blank') docs, COUNT(*) n
         ${WORKLIST}${scoped} AND e.status='NOTICE' AND v.voter_key IS NOT NULL GROUP BY 1,2,3`),
    q(`SELECT COALESCE(v.del_status,'blank') st, COUNT(*) n ${WORKLIST}${scoped} AND e.status='DELETED' AND v.voter_key IS NOT NULL GROUP BY 1`),
    Promise.all(
      PROGRESS_SCOPE.map(async (x) => {
        const cond = `${WORKLIST}${rc.sql} AND e.old_part = ?${x.block ? " AND e.block = ?" : ""}`;
        const r: any = await db
          .prepare(
            `SELECT COUNT(*) total, SUM(v.voter_key IS NOT NULL) done, SUM(e.status='ASDD' AND v.asdd_correct='no') wrong,
                    COUNT(DISTINCT e.hh_key) houses, COUNT(DISTINCT CASE WHEN v.voter_key IS NOT NULL THEN e.hh_key END) houses_touched
               ${cond}`
          )
          .bind(...rc.binds, ...(x.block ? [x.part, x.block] : [x.part]))
          .first();
        return { p: x.part, key: x.key, label: x.label, total: r.total || 0, done: r.done || 0, wrong: r.wrong || 0, houses: r.houses || 0, houses_touched: r.houses_touched || 0 };
      })
    ),
    q(`SELECT COUNT(*) n ${WORKLIST}${scoped} AND v.voter_key IS NOT NULL AND ${TODAY}`),
    db
      .prepare(
        `SELECT v.verified_by email, COUNT(*) total, SUM(${TODAY}) today
           ${WORKLIST}${scoped}
            AND v.voter_key IS NOT NULL GROUP BY v.verified_by ORDER BY today DESC, total DESC`
      )
      .bind(...allBinds)
      .all(),
    // SIR Cleared: of the visits made, how many found something to correct, and how
    // many of those still have no Form 8 filed — the follow-up a team must chase.
    q(`SELECT SUM(COALESCE(v.cl_corrections,'') NOT IN ('','none')) needs_fix,
              SUM(COALESCE(v.cl_corrections,'') = 'none') clean,
              SUM(COALESCE(v.cl_corrections,'') NOT IN ('','none') AND COALESCE(v.cl_form8,'') = 'no') form8_pending,
              SUM(COALESCE(v.cl_corrections,'') NOT IN ('','none') AND v.cl_form8 = 'yes') form8_filed
         ${WORKLIST}${scoped} AND e.status='CLEARED' AND v.voter_key IS NOT NULL`),
    // NO SIR: removed with no published reason. Form 6 is the remedy, so the figure
    // that matters is how many have filed one and how, and how many have not.
    q(`SELECT SUM(v.form6_mode = 'no') no_form6,
              SUM(v.form6_mode IN ('online','offline','both')) form6_filed,
              SUM(COALESCE(v.ns_has_id,'') = 'no') no_id
         ${WORKLIST}${scoped} AND e.status='NO_SIR' AND v.voter_key IS NOT NULL`),
  ]);
  // names: a second small query keeps the SQL above simple
  const names = new Map<string, string>();
  for (const r of (await db.prepare("SELECT email, name FROM users WHERE name IS NOT NULL AND name <> ''").all()).results as any[]) names.set(r.email, r.name);
  const st: Record<string, { total: number; done: number }> = {};
  for (const r of byStatus.results as any[]) st[r.s] = { total: r.total, done: r.done };
  const h: any = (houses.results as any[])[0] || { total: 0, done: 0, partial: 0, none: 0 };
  const reasons = await db
    .prepare(
      `SELECT r.status st, r.reason, COUNT(*) n
         FROM ok_elector_reasons r JOIN ok_electors e ON e.id = r.elector_id
        WHERE ${PROGRESS_SCOPE.map((x) => `e.old_part = ${x.part}`).join(" OR ")}
        GROUP BY 1, 2 ORDER BY n DESC`
    )
    .all();

  return {
    scope: sc.key,
    reason,
    // The menu lists every reason in the focus parts, counted WITHOUT the current
    // filter applied — filtering the menu by its own selection would hide all the
    // other options and leave no way back.
    reasons: (reasons.results as any[]).map((r) => ({ status: r.st, reason: r.reason, n: r.n })),
    scopes: PROGRESS_SCOPE.map((x) => ({ key: x.key, part: x.part, block: x.block, label: x.label })),
    electors: st,
    houses: { total: h.total || 0, done: h.done || 0, partial: h.partial || 0, none: h.none || 0 },
    asdd: Object.fromEntries((asdd.results as any[]).map((r) => [r.a, r.n])),
    notice: notice.results,
    deleted: Object.fromEntries((deleted.results as any[]).map((r) => [r.st, r.n])),
    cleared: ((clearedQ.results as any[])[0]) || {},
    nosir: ((nosirQ.results as any[])[0]) || {},
    today: ((today.results as any[])[0] || {}).n || 0,
    parts: byPart,
    volunteers: (who.results as any[]).map((r) => ({ email: r.email, name: names.get(r.email) || r.email.split("@")[0], total: r.total, today: r.today || 0 })),
  };
}

// kind -> the condition that picks the electors behind that number
const KIND: Record<string, string> = {
  electors_done: "v.voter_key IS NOT NULL",
  electors_left: "v.voter_key IS NULL",
  asdd_done: "e.status='ASDD' AND v.voter_key IS NOT NULL",
  asdd_left: "e.status='ASDD' AND v.voter_key IS NULL",
  notice_done: "e.status='NOTICE' AND v.voter_key IS NOT NULL",
  notice_left: "e.status='NOTICE' AND v.voter_key IS NULL",
  deleted_done: "e.status='DELETED' AND v.voter_key IS NOT NULL",
  deleted_left: "e.status='DELETED' AND v.voter_key IS NULL",
  cleared_done: "e.status='CLEARED' AND v.voter_key IS NOT NULL",
  cleared_left: "e.status='CLEARED' AND v.voter_key IS NULL",
  nosir_done: "e.status='NO_SIR' AND v.voter_key IS NOT NULL",
  nosir_left: "e.status='NO_SIR' AND v.voter_key IS NULL",
  cleared_needs_correction: "e.status='CLEARED' AND COALESCE(v.cl_corrections,'') NOT IN ('','none')",
  cleared_form8_pending: "e.status='CLEARED' AND COALESCE(v.cl_corrections,'') NOT IN ('','none') AND v.cl_form8='no'",
  nosir_no_form6: "e.status='NO_SIR' AND v.form6_mode='no'",
  asdd_wrong: "e.status='ASDD' AND v.asdd_correct='no'",
  asdd_right: "e.status='ASDD' AND v.asdd_correct='yes'",
  asdd_unable: "e.status='ASDD' AND v.asdd_correct='unable'",
  // not received AND still open: hearing not yet completed and documents not yet submitted (those done are no longer a case)
  notice_not_received: "e.status='NOTICE' AND v.notice_received='no' AND COALESCE(v.hearing_status,'') <> 'completed' AND COALESCE(v.docs_submitted,'') <> 'yes'",
  notice_unable: "e.status='NOTICE' AND v.notice_received='unable'",
  hearing_due: "e.status='NOTICE' AND v.hearing_status='due'",
  docs_not_submitted: "e.status='NOTICE' AND v.docs_submitted IN ('no','unaware')",
  wrongful_deletion: "e.status='DELETED' AND v.del_status='wrongful'",
  total_cases: "((e.status='ASDD' AND v.asdd_correct='no') OR (e.status='DELETED' AND v.del_status='wrongful'))",
  today: `v.voter_key IS NOT NULL AND ${TODAY}`,
};
// house lists: every worklist elector of the houses in that state
const HOUSE_KIND: Record<string, string> = {
  houses_done: "d = n",
  houses_partial: "d > 0 AND d < n",
  houses_none: "d = 0",
  houses_all: "1 = 1",
};

export interface ListQuery {
  kind: string;
  scope: string | null;
  page: number;
  email?: string | null;
  /** One ASD-D or notice reason, so a team can work a single reason in one pass. */
  reason?: string | null;
}

export async function okhlaList(db: D1Database, p: ListQuery) {
  const sc = scope(p.scope);
  const rc = reasonClause(p.reason || null);
  const scoped = sc.sql + rc.sql;
  let keysSql: string;
  let binds: any[];
  let seedCond: string | null = null;
  let seedBinds: any[] = [];
  if (HOUSE_KIND[p.kind]) {
    keysSql = `SELECT hh_key, MIN(old_part) p, MIN(sec) s, MIN(hh_sort) n FROM
        (SELECT e.hh_key, e.old_part, e.hh_sort, CASE WHEN e.section_no = '' THEN 9999 ELSE CAST(e.section_no AS INTEGER) END sec,
                COUNT(*) OVER (PARTITION BY e.hh_key) n, SUM(v.voter_key IS NOT NULL) OVER (PARTITION BY e.hh_key) d
           ${WORKLIST}${scoped}) WHERE ${HOUSE_KIND[p.kind]} GROUP BY hh_key ORDER BY p, s, n`;
    binds = [...sc.binds, ...rc.binds];
  } else {
    let cond = KIND[p.kind];
    let extra: any[] = [];
    if (p.kind === "volunteer" && p.email) {
      cond = "v.voter_key IS NOT NULL AND v.verified_by = ?";
      extra = [p.email];
    } else if (p.kind === "volunteer_today" && p.email) {
      cond = `v.voter_key IS NOT NULL AND v.verified_by = ? AND ${TODAY}`;
      extra = [p.email];
    }
    if (!cond) return { mode: "list", households: [], total_households: 0, total_electors: 0, page: 0, page_size: PAGE, seed_ids: [] };
    keysSql = `SELECT e.hh_key, MIN(e.old_part) p, MIN(CASE WHEN e.section_no = '' THEN 9999 ELSE CAST(e.section_no AS INTEGER) END) s, MIN(e.hh_sort) n
                 ${WORKLIST}${scoped} AND ${cond} GROUP BY e.hh_key ORDER BY p, s, n`;
    binds = [...sc.binds, ...rc.binds, ...extra];
    seedCond = cond;
    seedBinds = [...sc.binds, ...rc.binds, ...extra];
  }
  const all = await db.prepare(keysSql).bind(...binds).all();
  const allKeys = (all.results as any[]).map((r) => r.hh_key);
  const page = Math.max(0, p.page | 0);
  const order = allKeys.slice(page * PAGE, page * PAGE + PAGE);
  const households = groupHouseholds(await membersOf(db, order), order);
  // the electors that made the household appear (highlighted), and how many electors the list holds in all
  let seed_ids: number[] = [];
  let total_electors = 0;
  if (seedCond && order.length) {
    const r = await db
      .prepare(`SELECT e.id ${WORKLIST}${scoped} AND ${seedCond} AND e.hh_key IN (${order.map(() => "?").join(",")})`)
      .bind(...seedBinds, ...order)
      .all();
    seed_ids = (r.results as any[]).map((x) => x.id);
  }
  if (seedCond) {
    // a figure opens only the electors it counts, not everyone else in their houses
    const hit = new Set(seed_ids);
    for (const h of households) h.members = h.members.filter((m: any) => hit.has(m.id));
  }
  await attachVerifications(db, households);
  if (seedCond) {
    total_electors = (((await db.prepare(`SELECT COUNT(*) n ${WORKLIST}${scoped} AND ${seedCond}`).bind(...seedBinds).first()) as any) || {}).n || 0;
  } else if (allKeys.length) {
    // house lists: the electors who need a visit in those houses
    for (let i = 0; i < allKeys.length; i += 80) {
      const chunk = allKeys.slice(i, i + 80);
      const r: any = await db.prepare(`SELECT COUNT(*) n ${WORKLIST} AND e.hh_key IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).first();
      total_electors += (r && r.n) || 0;
    }
  }
  return { mode: "list", households, total_households: allKeys.length, total_electors, page, page_size: PAGE, seed_ids };
}
