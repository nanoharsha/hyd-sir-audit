/* ============================================================================
   OKHLA (AC 54) — household-level SIR status. READ-ONLY for now.

   Every elector of the Jan-2025 roll, grouped door by door, tagged with where
   the SIR 2026 process put them: Notice / ASDD / Deleted / SIR Cleared /
   No SIR, or "Draft awaited" where we do not yet hold the Draft SIR roll for
   their part (so Cleared vs No SIR cannot be told apart). No verification
   fields yet. Backend: src/okhla.ts (isolated ok_* tables, migration_018).

   One persistent screen, top to bottom:
     1. Title + a one-line coverage note (how many parts have a draft roll).
     2. Six status tiles — counts for the chosen part (or all of Okhla). A tile
        is also a filter.
     3. Search: house number / EPIC / name, plus a Part picker. House numbers
        repeat across parts, so a house search is best with a part chosen.
     4. Results as households; each elector's card shows old part AND new part.
   With nothing typed and no part chosen, tapping a tile lists the parts that
   have electors in that status; tapping a part opens its households.

   Offline: okhla-offline.js keeps the electors of parts 59-69 and every saved visit on the phone, so search and the
   visit forms work with no signal; visits typed offline wait in the retry queue below and are sent automatically.
   ========================================================================= */
import * as api from "./api.js";
import * as off from "./okhla-offline.js";
import * as ph from "./okhla-hearing.js";
import { latestName, changesHtml, twinsHtml } from "./okhla-changes.js";

let t = (k) => k;
let esc = (s) => String(s ?? "");
let toast = () => {};
let staffLabel = (e) => e;
let fmtDateTime = (d) => d;
let confirmDialog = async () => true;

const STATUS_ORDER = ["NOTICE", "ASDD", "DELETED", "CLEARED", "NO_SIR", "PENDING"];
const STATUS_KEY = {
  NOTICE: "okSNotice",
  ASDD: "okSAsdd",
  DELETED: "okSDeleted",
  CLEARED: "okSCleared",
  NO_SIR: "okSNoSir",
  PENDING: "okSPending",
  UNLINKED: "okSUnlinked",
};
// The dashboard tile and the part list it opens call the group "Pre-SIR deletion"; the card badge
// and the status chips on a household keep the plain tag, "Deleted".
const TILE_KEY = { DELETED: "okTileDeleted" };

const S = {
  meta: null, // /okhla/meta
  q: "",
  part: 0, // 0 = all parts
  status: "",
  page: 0,
  result: null, // last /okhla/search response
  loading: false,
  error: "",
  block: "", // "" = every block; otherwise the block letter (K)
  view: "hearing", // hearing (the opening tab) | search | progress | list
  prog: null, // /okhla/progress
  progScope: "", // "" = everything the dashboard covers; otherwise a scope key from the server ("65", "61-G")
  progAt: null,
  list: null, // {kind, label, email}
  listPage: 0,
  offInfo: null, // what the offline copy on this phone holds: { electors, syncedAt, visitsAt }
  offSync: null, // { i, n } while the offline copy is downloading
  vf: null, // the open ASDD verification form: { epic, data, error, saving }
};
let started = false;

/* ----- nothing typed is lost -------------------------------------------------------------
   1. DRAFT: every answer typed into a visit form is kept on this phone as you go, until the visit is saved or you
      press Cancel. Closing the tab or losing signal no longer throws it away.
   2. QUEUE: a save that fails because of the connection (or a server hiccup) is kept on the phone and re-sent
      automatically — when the phone is back online, every 20 seconds, or when you press "Send now". */
const LS_DRAFT = "okhla_drafts_v1";
const LS_PEND = "okhla_pending_v1";
const lsGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "{}") || {};
  } catch (e) {
    return {};
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
const hasAnswer = (d) => Object.keys(d || {}).some((k) => k !== "wrong_reason" && String(d[k] || "").trim());
let draftTimer = null;
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!S.vf) return;
    const all = lsGet(LS_DRAFT);
    if (hasAnswer(S.vf.data)) {
      const m = findMember(S.vf.epic);
      all[S.vf.epic] = { data: { ...S.vf.data }, name: (m && m.name) || S.vf.epic, t: Date.now() };
    } else delete all[S.vf.epic];
    lsSet(LS_DRAFT, all);
  }, 250);
}
function dropDraft(epic) {
  clearTimeout(draftTimer);
  const all = lsGet(LS_DRAFT);
  delete all[epic];
  lsSet(LS_DRAFT, all);
}
function dropPending(epic) {
  const all = lsGet(LS_PEND);
  delete all[epic];
  lsSet(LS_PEND, all);
}
// what a card shows for an entry that is saved on the phone but not yet on the server
const pendingView = (epic, item, formType) => ({ ...item.data, form_type: formType, _pending: true, updated_at: new Date(item.t).toISOString() });
function decorate(result) {
  const pend = lsGet(LS_PEND);
  if (!result || !Object.keys(pend).length) return;
  for (const h of result.households || [])
    for (const m of h.members) {
      const it = m.epic_id && pend[normEpic(m.epic_id)];
      if (it) {
        m.pending = true;
        m.verification = pendingView(normEpic(m.epic_id), it, null);
      }
    }
}
let flushing = false;
async function flushPending() {
  if (flushing) return;
  const all = lsGet(LS_PEND);
  const keys = Object.keys(all).filter((k) => !all[k].error);
  if (!keys.length) return;
  flushing = true;
  let sent = 0;
  for (const epic of keys) {
    const item = all[epic];
    try {
      const saved = await api.request("/okhla/verify/" + epic, { method: "POST", body: item.data });
      off.rememberVisit(saved);
      dropPending(epic);
      dropDraft(epic);
      sent++;
      const m = findMember(epic);
      if (m) {
        m.verification = saved;
        m.pending = false;
      }
    } catch (e) {
      if (!e || e.status === 0 || e.status >= 500) break; // still offline / server busy: try again later
      const cur = lsGet(LS_PEND);
      if (cur[epic]) {
        cur[epic].error = (e && e.message) || "rejected";
        lsSet(LS_PEND, cur);
      }
    }
  }
  flushing = false;
  if (sent) toast(rep(t("okSentToast"), { n: sent }));
  render();
}

function unsavedBannerHtml() {
  const pend = lsGet(LS_PEND);
  const drafts = lsGet(LS_DRAFT);
  const waiting = Object.keys(pend).filter((k) => !pend[k].error);
  const rejected = Object.keys(pend).filter((k) => pend[k].error);
  const loose = Object.keys(drafts).filter((k) => !pend[k] && !(S.vf && S.vf.epic === k));
  if (!waiting.length && !rejected.length && !loose.length) return "";
  const row = (k, name, extra) =>
    `<div class="ok-unsaved-row"><span><b>${esc(name)}</b> <span class="muted">${esc(k)}</span>${extra ? " · " + esc(extra) : ""}</span>
       <button class="secondary" onclick="okhla.openUnsaved('${esc(k)}')">${esc(t("okOpen"))}</button></div>`;
  return `<div class="ok-unsaved">
    ${
      waiting.length
        ? `<div class="ok-unsaved-hd">⏳ ${esc(rep(t("okBannerWaiting"), { n: waiting.length }))}
             <button onclick="okhla.sendNow()">${esc(t("okSendNow"))}</button></div>${waiting.map((k) => row(k, pend[k].name)).join("")}`
        : ""
    }
    ${rejected.length ? `<div class="ok-unsaved-hd">⚠ ${esc(rep(t("okBannerRejected"), { n: rejected.length }))}</div>${rejected.map((k) => row(k, pend[k].name, pend[k].error)).join("")}` : ""}
    ${loose.length ? `<div class="ok-unsaved-hd">✎ ${esc(rep(t("okBannerDrafts"), { n: loose.length }))}</div>${loose.map((k) => row(k, drafts[k].name)).join("")}` : ""}
  </div>`;
}
const el = () => document.getElementById("areaOkhla");

export function initOkhla(helpers = {}) {
  if (helpers.t) t = helpers.t;
  if (helpers.escapeHtml) esc = helpers.escapeHtml;
  if (helpers.showToast) toast = helpers.showToast;
  if (helpers.staffLabel) staffLabel = helpers.staffLabel;
  if (helpers.fmtDateTime) fmtDateTime = helpers.fmtDateTime;
  if (helpers.confirmDialog) confirmDialog = helpers.confirmDialog;
  window.okhla = handlers;
  ph.initHearing({
    t, escapeHtml: esc, showToast: toast, rerender: render, staffLabel, fmtDateTime, confirmDialog,
    // the elector's history up to the hearing, for the exit desk: notice reasons + the field team's saved visit (no edit button)
    historyHtml: (m) =>
      noticeHtml(m) + (m.verification ? verifySummaryHtml(m).replace(/<button[^>]*ok-vbtn[\s\S]*?<\/button>/, "") : ""),
  });
  if (!started) {
    started = true;
    loadMeta();
    window.addEventListener("online", () => {
      flushPending();
      refreshOffline();
    });
    window.addEventListener("offline", render);
    setInterval(flushPending, 20000);
    setInterval(() => navigator.onLine && off.syncVisits().then(refreshInfo).catch(() => {}), 5 * 60000);
  }
  render();
  flushPending();
}

async function loadMeta() {
  try {
    S.meta = await api.request("/okhla/meta");
    off.cacheMeta(S.meta);
    refreshOffline();
  } catch (e) {
    // no signal: the part list and counts saved on this phone from the last time online
    const m = await off.cachedMeta();
    if (m) S.meta = m;
    else S.error = e.message || String(e);
  }
  S.offInfo = await off.offlineInfo();
  render();
}

/* ----- offline copy of the audit parts (search + visit forms with no signal) ----- */
async function refreshInfo() {
  S.offInfo = await off.offlineInfo();
  render();
}
let refreshing = false;
async function refreshOffline(force) {
  if (refreshing || !navigator.onLine) return;
  refreshing = true;
  try {
    if (!S.meta) S.meta = await api.request("/okhla/meta");
    await off.syncVisits(); // small: every saved visit, so the cards of other volunteers' work are current
    await off.syncElectors(S.meta, {
      force,
      onProgress: (i, n) => {
        S.offSync = i < n ? { i, n } : null;
        render();
      },
    });
  } catch (e) {
    S.offSync = null;
    if (force) toast(t("okOffSyncFail"));
  }
  refreshing = false;
  S.offInfo = await off.offlineInfo();
  render();
}
function offlineStripHtml() {
  const info = S.offInfo;
  const isOff = !navigator.onLine;
  const when = info && info.syncedAt ? new Date(info.syncedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  let msg;
  if (S.offSync) msg = rep(t("okOffDownloading"), { i: S.offSync.i, n: S.offSync.n });
  else if (info && info.electors) msg = rep(t("okOffReady"), { n: fmt(info.electors), when });
  else msg = t(isOff ? "okOffNone" : "okOffFirst");
  return `<div class="ok-offline${isOff ? " is-off" : ""}">
    <span>${isOff ? "⚡ " + esc(t("okOffNow")) + " · " : ""}${esc(msg)}</span>
    ${navigator.onLine && !S.offSync ? `<button class="secondary" onclick="okhla.updateOffline()">${esc(t("okOffUpdate"))}</button>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ data */
async function runSearch() {
  S.vf = null; // a new search closes any open form
  S.loading = true;
  S.error = "";
  render();
  const qs = new URLSearchParams();
  if (S.q.trim()) qs.set("q", S.q.trim());
  if (S.part) qs.set("part", S.part);
  if (S.block) qs.set("block", S.block);
  if (S.status) qs.set("status", S.status);
  if (S.page) qs.set("page", S.page);
  try {
    if (!navigator.onLine) throw new api.ApiError("offline", 0);
    S.result = await api.request("/okhla/search?" + qs.toString());
  } catch (e) {
    S.result = null;
    if (!e || e.status === 0 || e.status >= 500) {
      // no signal (or the server is busy): search the copy kept on this phone
      try {
        S.result = await off.offlineSearch({ q: S.q.trim(), part: S.part, block: S.block, status: S.status, page: S.page });
      } catch (e2) {}
    }
    if (!S.result) S.error = !e || e.status === 0 ? t("okOffNoCopy") : e.message || String(e);
  }
  decorate(S.result);
  S.loading = false;
  render();
}

const partCounts = () => {
  // status -> count for the chosen part, or all of Okhla.
  if (!S.meta) return {};
  if (!S.part) return S.meta.totals;
  const out = {};
  for (const r of S.meta.part_status) if (r.old_part === S.part) out[r.status] = r.n;
  return out;
};
const partInfo = (n) => (S.meta ? S.meta.parts.find((p) => p.old_part === n) : null);

/* ------------------------------------------------------------- rendering */
const fmt = (n) => (n || 0).toLocaleString("en-IN");
const rep = (s, o) => Object.entries(o).reduce((a, [k, v]) => a.replace(`{${k}}`, v), s);

function monthLabel(ym) {
  // "2026-03" or "2025-03, 2026-01" -> "Mar 2026"
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return String(ym || "")
    .split(/[;,]\s*/)
    .map((x) => {
      const m = /^(\d{4})-(\d{2})$/.exec(x.trim());
      return m ? `${M[+m[2] - 1]} ${m[1]}` : "";
    })
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .join(", ");
}

// The two headline numbers, first on the screen: how many electors the base roll
// holds once the monthly pooling changes are applied, and how many of them the
// Draft SIR 2026 includes. Both follow the chosen part (or all of 59-69).
function baseSums() {
  const rows = S.meta.part_base.filter((r) => !S.part || r.old_part === S.part);
  const z = { roll: 0, struck: 0, added: 0, deleted: 0, draft: 0, draftAdded: 0 };
  for (const r of rows) {
    z.roll += r.roll_2025;
    z.struck += r.struck_off_2025;
    z.added += r.monthly_added;
    z.deleted += r.monthly_deleted;
    z.draft += r.draft_total;
    z.draftAdded += r.draft_added;
  }
  z.base = z.roll + z.added - z.deleted;
  return z;
}

function headlineHtml() {
  const z = baseSums();
  return `
    <div class="ok-headlines">
      <div class="ok-head">
        <span class="big">${fmt(z.base)}</span>
        <span class="lbl">${esc(t("okBaseTotal"))}</span>
        <span class="sub">${esc(rep(t("okBaseSub"), { roll: fmt(z.roll), add: fmt(z.added), del: fmt(z.deleted) }))}</span>
      </div>
      <div class="ok-head">
        <span class="big">${fmt(z.draft)}</span>
        <span class="lbl">${esc(t("okDraftTotal"))}</span>
        <span class="sub">${esc(rep(t("okDraftSub"), { roll: fmt(z.draft - z.draftAdded), add: fmt(z.draftAdded) }))}</span>
      </div>
    </div>`;
}

function tilesHtml() {
  if (!S.meta) return "";
  const c = partCounts();
  const [lo, hi] = S.meta.audit_parts;
  const scope = S.part ? `${t("okOldPart")} ${S.part}` : rep(t("okAuditScope"), { range: `${lo}–${hi}` });
  return `
    <div class="ok-scope">${esc(scope)}</div>
    ${headlineHtml()}
    <div class="ok-tiles">
      ${STATUS_ORDER.filter((s) => s !== "PENDING" || c.PENDING).map(
        (s) => `
        <button class="ok-tile s-${s}${S.status === s ? " on" : ""}" onclick="okhla.setStatus('${s}')">
          <span class="big">${fmt(c[s])}</span>
          <span class="lbl">${esc(t(TILE_KEY[s] || STATUS_KEY[s]))}</span>
        </button>`
      ).join("")}
    </div>`;
}

function partOptions() {
  // Flat list, no Critical / Other grouping: "critical" was computed from ASD-D and
  // notice share, which made 2025 part 151 the top entry even though it is not the
  // area being canvassed — the opposite of useful (owner, 2026-10-23).
  //
  // Every option names BOTH numbers. The roll was renumbered (2025 part N = 2026
  // booth N+1), the elector cards show the 2026 number and this picker filters on
  // the 2025 one, so a bare number here is genuinely ambiguous in the field.
  //
  // Only the focus parts are listed. Anything else is still reachable through
  // "All parts", which is what a surveyor wants for a house they come across
  // outside the area.
  if (!S.meta) return "";
  const focus = new Set(S.meta.focus_parts || []);
  const opt = (p) => {
    const locs = (p.localities || "").split(/\s*[|;]\s*/).filter(Boolean);
    const loc = locs.length ? locs[0].replace(/^\d+-/, "") + (locs.length > 1 ? ` +${locs.length - 1}` : "") : "";
    const label = `${t("okBoothWord")} ${p.new_parts} (2026) · ${t("okPartWord")} ${p.old_part} (2025)${loc ? ` — ${loc}` : ""}`;
    return `<option value="${p.old_part}"${S.part === p.old_part ? " selected" : ""}>${esc(label)}</option>`;
  };
  const listed = S.meta.parts.filter((p) => focus.has(p.old_part));
  return `<option value="0">${esc(t("okAllParts"))}</option>${listed.map(opt).join("")}`;
}

// Blocks to pick from: the chosen part's blocks, or every block letter in Okhla.
function blockList() {
  if (!S.meta || !S.meta.blocks) return [];
  const rows = S.part ? S.meta.blocks.filter((b) => b.old_part === S.part) : S.meta.blocks;
  return [...new Set(rows.map((b) => b.block))].sort();
}
function blockOptions() {
  const sel = blockList();
  return `<option value="">${esc(t("okAllBlocks"))}</option>${sel
    .map((b) => `<option value="${esc(b)}"${S.block === b ? " selected" : ""}>${esc(t("okBlockWord"))} ${esc(b)}</option>`)
    .join("")}`;
}

function searchBarHtml() {
  return `
    <div class="wl-search ok-search">
      <input id="ok-q" placeholder="${esc(t("okSearchPlaceholder"))}" value="${esc(S.q)}"
        onkeydown="if(event.key==='Enter')okhla.search()" />
      <select id="ok-part" onchange="okhla.setPart(this.value)" aria-label="${esc(t("okPartWord"))}">${partOptions()}</select>
      <button onclick="okhla.search()">${esc(t("wlSearchBtn"))}</button>
      ${
        S.q || S.part || S.block || S.status
          ? `<button class="secondary" onclick="okhla.clear()">${esc(t("okClear"))}</button>`
          : ""
      }
    </div>
    <div class="ok-hint">${esc(t("okPartHint"))}</div>`;
}

function badge(m) {
  const assumed = m.status === "CLEARED" && m.draft_basis === "assumed";
  const label = assumed ? t("okSClearedAssumed") : t(STATUS_KEY[m.status] || m.status);
  return `<span class="ok-badge s-${m.status}${assumed ? " assumed" : ""}"${
    assumed ? ` title="${esc(m.status_detail)}"` : ""
  }>${esc(label)}</span>`;
}

/* ------------------------------------------------------- notice reasons */
// A notice can carry several reasons (5,296 of 71,972 do). Each is shown on its own
// line: the ECI label as printed, and a plain-language line saying what it means.
const NOTICE_REASON_KEY = {
  "Parent Name Mismatch": "okNrParentName",
  "Self Name Mismatch": "okNrSelfName",
  "Unmapped with Last SIR": "okNrUnmapped",
  "Progeny >= 6": "okNrProgeny6",
  "Progeny Age Gap <9 Month": "okNrProgenyGap",
  "Parent Age Difference <15": "okNrParentLt15",
  "Parent Age difference >50": "okNrParentGt50",
  "Grandparent Age difference <40": "okNrGrandLt40",
  "Parent Marked ineligible in Last SIR": "okNrParentIneligible",
  "Reason not printed on the notice list": "okNrBlank",
};

function noticeHtml(m) {
  if (m.status !== "NOTICE") return "";
  const reasons = String(m.status_detail || "")
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  const list = reasons.length ? reasons : ["Reason not printed on the notice list"];
  return `
    <div class="ok-notice">
      <div class="ok-notice-hd">${esc(t("okNoticeWhy"))}${list.length > 1 ? ` · ${esc(rep(t("okNoticeCount"), { n: list.length }))}` : ""}</div>
      ${list
        .map((r) => {
          const k = NOTICE_REASON_KEY[r];
          return `<div class="ok-nr"><b>${esc(r === "Reason not printed on the notice list" ? t("okNrBlankLabel") : r)}</b>${
            k ? `<span>${esc(t(k))}</span>` : ""
          }</div>`;
        })
        .join("")}
    </div>`;
}

function newPartLabel(m) {
  if (!m.new_part) return `${t("okNewPart")} —`;
  const how = m.new_part_src === "estimated" ? t("okEst") : m.new_part_src === "household" ? t("okFromHH") : "";
  return `${t("okNewPart")} ${m.new_part}${how ? ` <i>(${esc(how)})</i>` : ""}`;
}

function memberHtml(m, hit) {
  const rel = m.relation_name ? `${m.relation_type ? esc(m.relation_type) + " " : ""}${esc(m.relation_name)}` : "";
  const meta = [m.age ? `${esc(m.age)}` : "", m.gender ? esc(m.gender) : "", rel].filter(Boolean).join(" · ");
  let reason = "";
  if (m.status === "DELETED") {
    reason =
      m.deleted_source === "roll_stamp"
        ? rep(t("okDelRoll"), { r: esc(m.deleted_reason) })
        : rep(t("okDelMonthly"), { m: esc(monthLabel(m.deleted_month)) });
  } else if (m.status === "ASDD") {
    reason = esc(m.status_detail);
  }
  // The name tile carries the new part right beside the name, with the status
  // badge on the far side, so the SIR 2026 booth is visible at a glance.
  return `
    <div class="wl-voter ok-member${hit ? " hit" : ""}">
      <div class="v-top">
        <span class="ok-who"><span class="v-name">${esc(latestName(m))}</span>
          <span class="ok-np${m.new_part ? "" : " none"}">${newPartLabel(m)}</span></span>
        ${badge(m)}
      </div>
      <div class="v-meta">${meta}</div>
      <div class="v-epic">${m.epic_id ? esc(m.epic_id) : esc(t("okNoEpic"))}${m.alt_epic_norm ? ` · ${esc(t("okAltEpic"))} ${esc(m.alt_epic_norm)}` : ""}</div>
      ${twinsHtml(m, t, esc, (st) => t(STATUS_KEY[st] || st), "okhla.goEpic")}
      ${changesHtml(m, t, esc)}
      ${noticeHtml(m)}
      <div class="v-tags">
        <span class="tag part">${esc(t("okOldPart"))} ${m.old_part ?? "—"}</span>
        ${m.in_2025_roll ? "" : `<span class="tag added">${esc(m.added_month ? rep(t("okAddedMonth"), { m: monthLabel(m.added_month) }) : t("okAddedSince"))}</span>`}
        ${m.name_partial ? `<span class="tag dc">${esc(t("okNamePartial"))}</span>` : ""}
        ${m.house_floor ? `<span class="tag">${esc(m.house_floor)} ${esc(t("okFloor"))}</span>` : ""}
        ${m.supplement ? `<span class="tag">${esc(t("okSupplement"))}</span>` : ""}
        ${reason ? `<span class="tag reason">${reason}</span>` : ""}
        ${m.conflict ? `<span class="tag hist">↺ ${esc(m.conflict)}</span>` : ""}
      </div>
      ${verifyHtml(m)}
    </div>`;
}

/* ------------------------------------------------------ field verification */
// One inline form per elector, chosen by the card's CURRENT tag (the server decides again):
//   ASDD    marking correct?; Enumeration Form; Form 6 now? -> help -> given; phone
//   NOTICE  physical copy received?; hearing status; required documents given to the BLO?
//   DELETED wrongful / valid; (wrongful) aware of the reason?; got the enumeration form? ->
//           submitted it to the BLO?; phone
// Questions appear only when they apply; the server re-validates (src/okhla_verify.ts).
const normEpic = (e) => String(e || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const FORM_STATUSES = ["ASDD", "NOTICE", "DELETED"];
const ENUM_OPTS = ["yes", "not_generated", "blo_did_not_collect", "other"]; // not_received_from_blo kept in ENUM_KEY only to show old visits
const ENUM_KEY = { yes: "okEnYes", not_received_from_blo: "okEnNotRecv", not_generated: "okEnNotGen", blo_did_not_collect: "okEnNotColl", other: "okEnOther" };
const WRONG_KEY = { shifted: "okWrShifted", dead: "okWrDead", absent: "okWrAbsent", duplicate: "okWrDup" };
const YN_KEY = { yes: "okYes", no: "okNo", unable: "okUnable" };
const HEARING_KEY = { completed: "okHrCompleted", due: "okHrDue", not_known: "okHrNotKnown" };
const DOCS_KEY = { yes: "okYes", no: "okNo", unaware: "okDocUnaware" };
const DELSTAT_KEY = { wrongful: "okDelWrongful", valid: "okDelValid" };
const DATA_KEYS = [
  "asdd_correct", "wrong_reason", "enum_form", "form6_submitted", "needs_assistance", "form6_given", "phone", "remarks",
  "notice_received", "hearing_status", "docs_submitted", "del_status", "del_aware", "del_got_form", "del_submitted_form",
];

function findMember(epic) {
  for (const h of (S.result && S.result.households) || [])
    for (const m of h.members) if (normEpic(m.epic_id) === epic) return m;
  return null;
}

function verifySummaryHtml(m) {
  const v = m.verification;
  const b = (x) => `<b>${esc(x)}</b>`;
  const lines = [];
  if (m.status === "ASDD") {
    lines.push(`${t("okQCorrect")}: ${b(t(YN_KEY[v.asdd_correct]))}${v.wrong_reason ? ` — ${esc(t(WRONG_KEY[v.wrong_reason]))}` : ""}`);
    if (v.enum_form) lines.push(`${t("okQEnum")}: ${b(t(ENUM_KEY[v.enum_form]))}`);
    if (v.form6_submitted)
      lines.push(
        `${t("okQForm6")}: ${b(t(YN_KEY[v.form6_submitted]))}` +
          (v.needs_assistance ? ` · ${t("okQAssist")}: ${b(t(YN_KEY[v.needs_assistance]))}` : "") +
          (v.form6_given ? ` · ${t("okQGiven")}: ${b(t(YN_KEY[v.form6_given]))}` : "")
      );
  } else if (m.status === "NOTICE") {
    lines.push(`${t("okQNoticeRecv")}: ${b(t(YN_KEY[v.notice_received]))}`);
    if (v.hearing_status) lines.push(`${t("okQHearing")}: ${b(t(HEARING_KEY[v.hearing_status]))}`);
    if (v.docs_submitted) lines.push(`${t("okQDocs")}: ${b(t(DOCS_KEY[v.docs_submitted]))}`);
  } else {
    lines.push(`${t("okQDelStatus")}: ${b(t(DELSTAT_KEY[v.del_status]))}`);
    if (v.del_aware) lines.push(`${t("okQDelAware")}: ${b(t(YN_KEY[v.del_aware]))}`);
    if (v.del_got_form)
      lines.push(
        `${t("okQDelGot")}: ${b(t(YN_KEY[v.del_got_form]))}` +
          (v.del_submitted_form ? ` · ${t("okQDelSubmitted")}: ${b(t(YN_KEY[v.del_submitted_form]))}` : "")
      );
  }
  if (v.phone) lines.push(`${t("okQPhone")}: ${b(v.phone)}`);
  if (v.remarks) lines.push(`${t("okQRemarks")}: ${esc(v.remarks)}`);
  return `
    <div class="ok-vsum">
      <div class="ok-vsum-hd">${
        m.pending ? `⏳ ${esc(t("okWaiting"))}` : `✓ ${esc(t("okVerified"))} · ${esc(staffLabel(v.updated_by))} · ${esc(fmtDateTime(v.updated_at))}`
      }</div>
      ${lines.map((l) => `<div>${l}</div>`).join("")}
      <button class="secondary ok-vbtn" onclick="okhla.vopen('${normEpic(m.epic_id)}')">${esc(t("okEditVisit"))}</button>
    </div>`;
}

function radios(field, opts, keyMap, cur) {
  return `<div class="f-radios">${opts
    .map(
      (o) => `<label><input type="radio" name="okv-${field}" ${cur === o ? "checked" : ""}
        onchange="okhla.vset('${field}','${o}')" /> ${esc(t(keyMap[o]))}</label>`
    )
    .join("")}</div>`;
}

function guideHtml(m) {
  const steps = [1, 2, 3, 4, 5, 6, 7].map((i) =>
    rep(t("okGuide" + i), { epic: esc(m.epic_id || "—"), part: m.old_part ?? "—" })
  );
  return `<div class="ok-guide"><b>${esc(t("okGuideHd"))}</b><ol>${steps.map((x) => `<li>${x}</li>`).join("")}</ol></div>`;
}

function formHtml(m) {
  const d = S.vf.data;
  const q = (label, body) => `<div class="f-label">${esc(label)}</div>${body}`;
  const YN = ["yes", "no"];
  const phoneQ = () =>
    q(
      t("okQPhoneOpt"),
      `<input type="tel" inputmode="tel" maxlength="16" placeholder="${esc(t("okPhoneHint"))}" value="${esc(d.phone || "")}"
        oninput="okhla.vtext('phone',this.value)" />`
    );
  let h = S.vf.restored ? `<div class="ok-hint">${esc(t("okRestored"))}</div>` : "";
  if (m.status === "ASDD") {
    h += q(t("okQCorrect"), radios("asdd_correct", ["yes", "no", "unable"], YN_KEY, d.asdd_correct));
    // "Yes" (marking is correct) or "unable to verify" ends the form; only "No" goes on to the follow-up questions
    if (d.asdd_correct === "no") {
      h += q(t("okQEnum"), radios("enum_form", ENUM_OPTS, ENUM_KEY, d.enum_form));
      h += q(t("okQForm6"), radios("form6_submitted", YN, YN_KEY, d.form6_submitted));
      if (d.form6_submitted === "no") {
        h += q(t("okQAssist"), radios("needs_assistance", YN, YN_KEY, d.needs_assistance));
        if (d.needs_assistance === "yes") {
          h += guideHtml(m);
          h += q(t("okQGiven"), radios("form6_given", YN, YN_KEY, d.form6_given));
        }
      }
      h += phoneQ();
    }
  } else if (m.status === "NOTICE") {
    h += q(t("okQNoticeRecv"), radios("notice_received", ["yes", "no", "unable"], YN_KEY, d.notice_received));
    // "Unable to verify" ends the form
    if (d.notice_received !== "unable") {
      h += q(t("okQHearing"), radios("hearing_status", ["completed", "due", "not_known"], HEARING_KEY, d.hearing_status));
      h += q(t("okQDocs"), radios("docs_submitted", ["yes", "no", "unaware"], DOCS_KEY, d.docs_submitted));
      h += phoneQ();
    }
  } else {
    h += q(t("okQDelStatus"), radios("del_status", ["wrongful", "valid"], DELSTAT_KEY, d.del_status));
    // "Valid deletion" ends the form; only "wrongful deletion" goes on to the follow-up questions
    if (d.del_status === "wrongful") {
      h += q(t("okQDelAware"), radios("del_aware", YN, YN_KEY, d.del_aware));
      h += q(t("okQDelGot"), radios("del_got_form", YN, YN_KEY, d.del_got_form));
      if (d.del_got_form === "yes") h += q(t("okQDelSubmitted"), radios("del_submitted_form", YN, YN_KEY, d.del_submitted_form));
      h += phoneQ();
    }
  }
  h += q(t("okQRemarks"), `<textarea rows="3" oninput="okhla.vtext('remarks',this.value)">${esc(d.remarks || "")}</textarea>`);
  h += `${S.vf.error ? `<div class="field-hint" style="color:var(--danger-text)">${esc(S.vf.error)}</div>` : ""}
    <div class="f-actions">
      <button onclick="okhla.vsave()" ${S.vf.saving ? "disabled" : ""}>${esc(S.vf.saving ? t("okSaving") : t("okSave"))}</button>
      <button class="secondary" onclick="okhla.vcancel()">${esc(t("okCancel"))}</button>
    </div>`;
  return `<div class="wl-form ok-vform">${h}</div>`;
}

function verifyHtml(m) {
  if (!FORM_STATUSES.includes(m.status) || !m.epic_id) return "";
  const epic = normEpic(m.epic_id);
  if (S.vf && S.vf.epic === epic) return `<div class="ok-vf" id="ok-vf-${epic}">${formHtml(m)}</div>`;
  if (m.verification) return `<div class="ok-vf">${verifySummaryHtml(m)}</div>`;
  return `<div class="ok-vf"><button class="ok-vbtn" onclick="okhla.vopen('${epic}')">${esc(t("okVerifyBtn"))}</button></div>`;
}

function householdHtml(h, hitIds) {
  const counts = {};
  for (const m of h.members) counts[m.status] = (counts[m.status] || 0) + 1;
  const chips = STATUS_ORDER.concat(["UNLINKED"])
    .filter((s) => counts[s])
    .map((s) => `<span class="ok-chip s-${s}">${counts[s]} ${esc(t(STATUS_KEY[s]))}</span>`)
    .join("");
  const house = h.hh_norm ? h.house_label : t("okNoHouse");
  const place = h.section_name || t("okNoBlock");
  const shown = h.members; // every elector of the house, however many — no "show more"
  const sizeText = h.members.length === 1 ? t("okMember1") : rep(t("okMembers"), { n: h.members.length });
  return `
    <div class="wl-house open ok-house">
      <div class="ok-house-hd">
        <div>
          <div class="ok-house-no">${/^(h\.?\s*no|house)/i.test(house) ? "" : esc(t("okHouse")) + " "}<b>${esc(house)}</b></div>
          <div class="ok-house-sub">${esc(t("okOldPart"))} ${h.old_part ?? "—"} · ${esc(place)} · ${esc(sizeText)}</div>
        </div>
        <div class="ok-chips">${chips}</div>
      </div>
      <div class="wl-voters">
        ${shown.map((m) => memberHtml(m, hitIds.has(m.id))).join("")}
      </div>
    </div>`;
}

function pagerHtml(r) {
  if ((r.mode !== "browse" && r.mode !== "list") || !r.total_households) return "";
  const pages = Math.ceil(r.total_households / r.page_size);
  if (pages <= 1) return "";
  return `
    <div class="ok-pager">
      <button class="secondary" ${r.page <= 0 ? "disabled" : ""} onclick="okhla.page(${r.page - 1})">${esc(t("okPrev"))}</button>
      <span>${esc(rep(t("okPage"), { a: r.page + 1, b: pages }))}</span>
      <button class="secondary" ${r.page + 1 >= pages ? "disabled" : ""} onclick="okhla.page(${r.page + 1})">${esc(t("okNext"))}</button>
    </div>`;
}

function partListHtml() {
  // No part, no query, a status chosen: which parts have electors in that status?
  const rows = S.meta.part_status
    .filter((r) => r.status === S.status && r.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!rows.length) return `<div class="empty">${esc(t("okNoResults"))}</div>`;
  return `
    <div class="ok-partlist-hd">${esc(rep(t("okPartsWith"), { s: t(TILE_KEY[S.status] || STATUS_KEY[S.status]) }))}</div>
    <div class="ok-partlist">
      ${rows
        .map((r) => {
          const p = partInfo(r.old_part);
          const loc = p ? (p.localities || "").split(" | ")[0] : "";
          return `<button class="ok-partrow" onclick="okhla.openPart(${r.old_part})">
            <span><b>${esc(t("okOldPart"))} ${r.old_part}</b> <span class="muted">${esc(loc)}</span></span>
            <span class="ct">${fmt(r.n)}</span></button>`;
        })
        .join("")}
    </div>`;
}

function resultsHtml() {
  if (S.error) return `<div class="empty">${esc(S.error)}</div>`;
  if (S.loading) return `<div class="empty">${esc(t("wlLoading"))}</div>`;
  const r = S.result;
  if (!r || r.mode === "idle") {
    if (S.status && !S.part && !S.q.trim() && S.meta) return partListHtml();
    const [lo, hi] = S.meta ? S.meta.audit_parts : [59, 69];
    return `<div class="empty">${esc(rep(t("okIdle"), { range: `${lo}–${hi}` }))}</div>`;
  }
  const hits = new Set(r.seed_ids || []);
  if (!r.households.length) return `<div class="empty">${esc(t("okNoResults"))}</div>`;
  const notes = [];
  if (r.offline) notes.push(t("okOffResults"));
  if (r.need_part) notes.push(t("okNeedPart"));
  if (r.mode === "epic_prefix") notes.push(t("okEpicPrefix"));
  if (r.mode === "house_letter") notes.push(t("okLetterHouse"));
  if (r.mode === "house_prefix") notes.push(t("okPrefixHouse"));
  if (r.truncated) notes.push(rep(t("okTruncated"), { n: r.mode.startsWith("house") ? r.page_size : 80 }));
  if (r.mode === "browse" || r.mode.startsWith("house")) notes.push(rep(t("okHouseholdsCount"), { n: fmt(r.total_households) }));
  return `
    ${notes.map((n) => `<div class="ok-hint">${esc(n)}</div>`).join("")}
    ${r.households.map((h) => householdHtml(h, hits)).join("")}
    ${pagerHtml(r)}`;
}

/* ------------------------------------------------------------ progress */
const KIND_KEY = {
  electors_done: "okKElectorsDone", electors_left: "okKElectorsLeft", asdd_done: "okKAsddDone", asdd_left: "okKAsddLeft",
  notice_done: "okKNoticeDone", notice_left: "okKNoticeLeft", deleted_done: "okKDeletedDone", deleted_left: "okKDeletedLeft",
  asdd_wrong: "okKAsddWrong", asdd_right: "okKAsddRight", asdd_unable: "okKAsddUnable", notice_not_received: "okKNoticeNotRecv",
  hearing_due: "okKHearingDue", notice_unable: "okKNoticeUnable", docs_not_submitted: "okKDocsNo", wrongful_deletion: "okKWrongful", total_cases: "okKTotalCases", today: "okKToday",
  houses_done: "okKHousesDone", houses_partial: "okKHousesPartial", houses_none: "okKHousesNone", houses_all: "okKHousesAll",
};

async function loadProgress() {
  S.error = "";
  try {
    S.prog = await api.request("/okhla/progress" + (S.progScope ? "?scope=" + encodeURIComponent(S.progScope) : ""));
    S.progAt = new Date();
  } catch (e) {
    S.error = e.message || String(e);
  }
  render();
}

async function runList() {
  S.vf = null;
  S.loading = true;
  S.error = "";
  render();
  const qs = new URLSearchParams({ kind: S.list.kind, page: S.listPage });
  if (S.progScope) qs.set("scope", S.progScope);
  if (S.list.email) qs.set("email", S.list.email);
  try {
    S.result = await api.request("/okhla/list?" + qs.toString());
    decorate(S.result);
  } catch (e) {
    S.result = null;
    S.error = e.message || String(e);
  }
  S.loading = false;
  render();
}

// a number that opens the list behind it
const num = (n, kind, extra = "") =>
  n ? `<span class="drill-num" onclick="okhla.openList('${kind}'${extra})">${fmt(n)}</span>` : `<span class="muted">0</span>`;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);

function progressHtml() {
  const P = S.prog;
  if (S.error && !P) return `<div class="empty">${esc(S.error)}</div>`;
  if (!P) return `<div class="empty">${esc(t("wlLoading"))}</div>`;
  const E = P.electors;
  const tot = ["ASDD", "NOTICE", "DELETED"].reduce((a, k) => a + ((E[k] || {}).total || 0), 0);
  const done = ["ASDD", "NOTICE", "DELETED"].reduce((a, k) => a + ((E[k] || {}).done || 0), 0);
  const H = P.houses;
  const asddVisits = (E.ASDD || {}).done || 0;
  const wrong = P.asdd.no || 0;
  const notRecv = P.notice.filter((r) => r.recv === "no" && r.hearing !== "completed" && r.docs !== "yes").reduce((a, r) => a + r.n, 0);
  const noticeVisits = (E.NOTICE || {}).done || 0;
  const delVisits = (E.DELETED || {}).done || 0;
  const found = (kind, n, label, sub, tone = "") => `
    <div class="dash-stat${tone ? " tone-" + tone : ""}${n ? " clickable" : ""}"${n ? ` onclick="okhla.openList('${kind}')"` : ""}>
      <b>${fmt(n)}</b><span class="dash-label">${esc(label)}</span>
      ${sub ? `<div class="dash-def">${esc(sub)}</div>` : ""}
      ${n ? `<div class="drill-hint">${esc(t("viewList"))}</div>` : ""}</div>`;
  const inScope = P.scopes || [];
  const single = inScope.length === 1; // only one part is being worked on: no part picker, no by-part table
  const partOpts = `<option value="0">${esc(t("okAllInScope"))}</option>${inScope
    .map((x) => `<option value="${esc(x.key)}"${S.progScope === x.key ? " selected" : ""}>${esc(x.label)}</option>`)
    .join("")}`;
  const at = S.progAt ? S.progAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
  return `
    <div class="ok-progbar">
      ${
        single
          ? `<b>${esc(inScope[0].label)}</b>`
          : `<select onchange="okhla.setProgPart(this.value)" aria-label="${esc(t("okPartWord"))}">${partOpts}</select>`
      }
      <button class="secondary" onclick="okhla.refreshProgress()">${esc(t("okRefresh"))}</button>
      <span class="muted">${esc(t("okUpdated"))} ${esc(at)}</span>
    </div>

    <div class="dash-grid">
      <div class="dash-stat headline">
        <span class="dash-label">${esc(t("okElectorsCovered"))}</span>
        <b>${num(done, "electors_done")} <small>/ ${fmt(tot)}</small></b>
        <div class="progress-bar"><span style="width:${Math.min(100, pct(done, tot))}%"></span></div>
        <div class="dash-def"><b class="inl">${pct(done, tot)}%</b> ${esc(t("okDone"))} · ${num(tot - done, "electors_left")} ${esc(t("okLeft"))}</div>
      </div>
      <div class="dash-stat headline">
        <span class="dash-label">${esc(t("okHousesCovered"))}</span>
        <b>${num(H.done, "houses_done")} <small>/ ${fmt(H.total)}</small></b>
        <div class="progress-bar"><span style="width:${Math.min(100, pct(H.done, H.total))}%"></span></div>
        <div class="dash-def">${num(H.partial, "houses_partial")} ${esc(t("okHousesPartly"))} · ${num(H.none, "houses_none")} ${esc(t("okHousesNotStarted"))}</div>
      </div>
      ${found("total_cases", wrong + (P.deleted.wrongful || 0), t("okKTotalCases"), t("okTotalCasesSub"), "total")}
      ${found("asdd_wrong", wrong, t("okKAsddWrong"), rep(t("okOfAsddVisits"), { n: fmt(asddVisits), p: pct(wrong, asddVisits) }), "asdd")}
      ${found("wrongful_deletion", P.deleted.wrongful || 0, t("okKWrongful"), rep(t("okOfDelVisits"), { n: fmt(delVisits) }), "deleted")}
      ${found("notice_not_received", notRecv, t("okKNoticeNotRecv"), rep(t("okOfNoticeVisits"), { n: fmt(noticeVisits), p: pct(notRecv, noticeVisits) }), "notice")}
      ${found("today", P.today, t("okVisitsToday"), t("okVisitsTodaySub"))}
    </div>

    <div class="section-title">${esc(t("okProgVolunteers"))}</div>
    ${
      P.volunteers.length
        ? `<table class="parts"><thead><tr><th>${esc(t("okVolunteer"))}</th><th>${esc(t("okToday"))}</th><th>${esc(t("okTotal"))}</th></tr></thead><tbody>
          ${P.volunteers
            .map(
              (v) => `<tr><td>${esc(v.name)}</td>
                <td>${num(v.today, "volunteer_today", `,'${esc(v.email)}'`)}</td>
                <td>${num(v.total, "volunteer", `,'${esc(v.email)}'`)}</td></tr>`
            )
            .join("")}</tbody></table>`
        : `<div class="empty">${esc(t("okNoVisitsYet"))}</div>`
    }

    ${
      S.progScope || single
        ? ""
        : `<div class="section-title">${esc(t("okProgByPart"))}</div>
    <table class="parts"><thead><tr><th>${esc(t("okPartWord"))}</th><th>${esc(t("okHousesTouched"))}</th><th>${esc(t("okElectorsCovered"))}</th><th>${esc(t("okLeft"))}</th><th>${esc(t("okKAsddWrong"))}</th></tr></thead><tbody>
      ${P.parts
        .map(
          (r) => `<tr><td><span class="drill-num" onclick="okhla.setProgPart('${esc(r.key)}')">${esc(r.label)}</span></td>
            <td>${fmt(r.houses_touched)} / ${fmt(r.houses)}</td>
            <td>${fmt(r.done)} / ${fmt(r.total)} <span class="muted">(${pct(r.done, r.total)}%)</span></td>
            <td>${num(r.total - r.done, "electors_left", `,null,'${esc(r.key)}'`)}</td>
            <td>${num(r.wrong, "asdd_wrong", `,null,'${esc(r.key)}'`)}</td></tr>`
        )
        .join("")}</tbody></table>`
    }`;
}

function subnavHtml() {
  const tab = (v, label) =>
    `<button class="ok-subtab${v === "hearing" ? " ph" : ""}${S.view === v || (v === "progress" && S.view === "list") ? " on" : ""}" onclick="okhla.setView('${v}')">${esc(label)}</button>`;
  return `<div class="ok-subnav">${tab("hearing", t("okTabHearing"))}${tab("hearingdash", t("okTabHearingDash"))}${tab("search", t("okTabSearch"))}${tab("progress", t("okTabProgress"))}</div>`;
}

function listHeaderHtml() {
  const L = S.list;
  const r = S.result;
  const label = L.label || t(KIND_KEY[L.kind] || "okKHousesAll");
  const sc = S.prog && S.prog.scopes ? S.prog.scopes.find((x) => x.key === S.progScope) || (S.prog.scopes.length === 1 ? S.prog.scopes[0] : null) : null;
  const scope = sc ? ` · ${sc.label}` : "";
  return `<div class="ok-listhd">
    <button class="secondary" onclick="okhla.backToProgress()">← ${esc(t("okBackToProgress"))}</button>
    <div class="ok-listtitle"><b>${esc(label)}</b>${esc(scope)}${
      r && r.mode === "list" ? `<div class="muted">${esc(rep(t("okListCount"), { e: fmt(r.total_electors), h: fmt(r.total_households) }))}</div>` : ""
    }</div></div>`;
}

function render() {
  const root = el();
  if (!root) return;
  const focus = document.activeElement && document.activeElement.id === "ok-q";
  const body =
    S.view === "hearingdash"
      ? ph.dashHtml()
      : S.view === "hearing"
      ? ph.hearingHtml()
      : S.view === "progress"
      ? progressHtml()
      : S.view === "list"
      ? `${listHeaderHtml()}<div id="ok-results">${resultsHtml()}</div>`
      : `${offlineStripHtml()}${tilesHtml()}${unsavedBannerHtml()}${searchBarHtml()}<div id="ok-results">${resultsHtml()}</div>`;
  root.innerHTML = `
    <div class="section-title">${esc(t("okTitle"))}</div>
    ${subnavHtml()}
    ${S.view !== "search" && S.view !== "hearing" && S.view !== "hearingdash" ? unsavedBannerHtml() : ""}
    ${body}`;
  if (focus) {
    const i = document.getElementById("ok-q");
    if (i) {
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }
  }
}

/* -------------------------------------------------------------- handlers */
const readQ = () => {
  const i = document.getElementById("ok-q");
  if (i) S.q = i.value;
};

const handlers = {
  // open another entry (a possible duplicate) by its EPIC
  goEpic(epic) {
    S.view = "search";
    S.q = epic;
    S.part = 0;
    S.block = "";
    S.status = "";
    S.page = 0;
    runSearch();
  },
  search() {
    readQ();
    S.page = 0;
    if (!S.q.trim() && !S.part) {
      S.result = null;
      return render();
    }
    runSearch();
  },
  setBlock(v) {
    readQ();
    S.block = v || "";
    S.page = 0;
    if (S.part || S.block || S.q.trim()) runSearch();
    else {
      S.result = null;
      render();
    }
  },
  setPart(v) {
    readQ();
    S.part = parseInt(v, 10) || 0;
    if (S.block && !blockList().includes(S.block)) S.block = ""; // that part has no such block
    S.page = 0;
    if (S.part || S.q.trim()) runSearch();
    else {
      S.result = null;
      render();
    }
  },
  openPart(n) {
    S.part = n;
    S.page = 0;
    runSearch();
  },
  setStatus(s) {
    readQ();
    S.status = S.status === s ? "" : s;
    S.page = 0;
    if (S.part || S.q.trim()) runSearch();
    else {
      S.result = null;
      render();
    }
  },
  page(n) {
    if (S.view === "list") {
      S.listPage = n;
      runList();
      return;
    }
    S.page = n;
    runSearch();
  },
  setView(v) {
    readQ();
    S.view = v;
    S.vf = null;
    if (v === "hearingdash") {
      S.result = null;
      render();
      ph.loadDash();
    } else if (v === "hearing") {
      S.result = null;
      render();
      const i = document.getElementById("ph-q");
      if (i) i.focus();
    } else if (v === "progress") {
      S.result = null;
      loadProgress();
    } else {
      S.result = null;
      render();
      if (S.part || S.q.trim()) runSearch();
    }
  },
  setProgPart(v) {
    S.progScope = v || "";
    S.view = "progress";
    S.prog = null;
    loadProgress();
  },
  refreshProgress() {
    S.prog = null;
    loadProgress();
  },
  openList(kind, email, scope) {
    if (scope) S.progScope = scope;
    S.list = { kind, email: email || "", label: "" };
    if (email) {
      const v = S.prog && S.prog.volunteers.find((x) => x.email === email);
      S.list.label = `${v ? v.name : email} — ${t(kind === "volunteer_today" ? "okToday" : "okTotal")}`;
    }
    S.listPage = 0;
    S.view = "list";
    runList();
  },
  backToProgress() {
    S.view = "progress";
    S.result = null;
    S.vf = null;
    loadProgress(); // the numbers moved while you were on the list
  },
  clear() {
    S.q = "";
    S.part = 0;
    S.block = "";
    S.status = "";
    S.page = 0;
    S.result = null;
    render();
  },
  rerender: render,
  updateOffline() {
    refreshOffline(true);
  },

  // ---- field verification forms (ASDD / Notice / Deleted)
  vopen(epic) {
    const m = findMember(epic);
    if (!m) return;
    const v = m.verification;
    const data = {};
    for (const k of DATA_KEYS) data[k] = (v && v[k]) || "";
    // an entry kept on this phone (waiting to send, or a draft that was never saved) comes back first
    const keep = lsGet(LS_PEND)[epic] || lsGet(LS_DRAFT)[epic];
    let restored = false;
    if (keep && keep.data && (!v || v._pending || keep.t > Date.parse(v.updated_at || 0))) {
      for (const k of DATA_KEYS) data[k] = keep.data[k] || "";
      restored = true;
    }
    S.vf = { epic, error: "", saving: false, data, restored };
    render();
    const box = document.getElementById("ok-vf-" + epic);
    if (box) box.scrollIntoView({ block: "nearest" });
  },
  vset(field, value) {
    if (!S.vf) return;
    const d = S.vf.data;
    d[field] = value;
    // an answer that no longer applies is cleared, so nothing stale is ever saved
    if (field === "asdd_correct" && value !== "no") {
      d.enum_form = d.form6_submitted = d.needs_assistance = d.form6_given = d.phone = "";
    }
    if (field === "del_status" && value !== "wrongful") {
      d.del_aware = d.del_got_form = d.del_submitted_form = d.phone = "";
    }
    if (field === "notice_received" && value === "unable") {
      d.hearing_status = d.docs_submitted = d.phone = "";
    }
    if (field === "form6_submitted" && value !== "no") {
      d.needs_assistance = "";
      d.form6_given = "";
    }
    if (field === "needs_assistance" && value !== "yes") d.form6_given = "";
    if (field === "del_status" && value !== "wrongful") d.del_aware = "";
    if (field === "del_got_form" && value !== "yes") d.del_submitted_form = "";
    S.vf.error = "";
    saveDraftSoon();
    const m = findMember(S.vf.epic);
    const box = document.getElementById("ok-vf-" + S.vf.epic);
    if (m && box) box.innerHTML = formHtml(m); // redraw only this form — keeps scroll and typed text
  },
  vtext(field, value) {
    if (S.vf) {
      S.vf.data[field] = value; // typing: no redraw
      saveDraftSoon();
    }
  },
  vcancel() {
    if (S.vf) {
      dropDraft(S.vf.epic);
      dropPending(S.vf.epic);
    }
    S.vf = null;
    render();
  },
  sendNow() {
    const all = lsGet(LS_PEND);
    for (const k of Object.keys(all)) delete all[k].error; // try the rejected ones once more as well
    lsSet(LS_PEND, all);
    flushPending();
  },
  async openUnsaved(epic) {
    S.q = epic;
    S.part = 0;
    S.block = "";
    S.status = "";
    S.page = 0;
    await runSearch();
    handlers.vopen(epic);
  },
  async vsave() {
    if (!S.vf || S.vf.saving) return;
    const d = S.vf.data;
    const epic = S.vf.epic;
    const m = findMember(epic);
    const fail = (k) => {
      S.vf.error = t(k);
      const box = document.getElementById("ok-vf-" + epic);
      if (m && box) box.innerHTML = formHtml(m);
    };
    // nothing is mandatory; a typed phone number must still be a real 10-digit number, and an empty visit is not saved
    const typedPhone = String(d.phone || "").trim();
    const phoneOk = /^\d{10}$/.test(typedPhone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""));
    if (typedPhone && !phoneOk) return fail("okErrPhoneOpt");
    const answered = DATA_KEYS.some((k) => k !== "wrong_reason" && String(d[k] || "").trim());
    if (!answered) return fail("okErrEmptyVisit");
    S.vf.saving = true;
    const box = document.getElementById("ok-vf-" + epic);
    if (m && box) box.innerHTML = formHtml(m);
    try {
      const saved = await api.request("/okhla/verify/" + epic, { method: "POST", body: d });
      off.rememberVisit(saved);
      dropDraft(epic);
      dropPending(epic);
      if (m) {
        m.verification = saved;
        m.pending = false;
      }
      S.vf = null;
      render();
      const mg = saved && saved._merge;
      if (mg && mg.by_other)
        toast(
          rep(t("okMergedToast"), { name: mg.other || t("okSomeoneElse") }) +
            (mg.conflicts && mg.conflicts.length ? rep(t("okMergedChanged"), { n: mg.conflicts.length }) : "")
        );
      else toast(t("okSavedToast"));
    } catch (e) {
      if (!e || e.status === 0 || e.status >= 500) {
        // no signal / server busy: keep the entry on the phone and send it again by itself
        const all = lsGet(LS_PEND);
        all[epic] = { data: { ...d }, name: (m && m.name) || epic, t: Date.now(), tries: 0 };
        lsSet(LS_PEND, all);
        dropDraft(epic);
        if (m) {
          m.pending = true;
          m.verification = pendingView(epic, all[epic], null);
        }
        S.vf = null;
        render();
        toast(t("okQueuedToast"));
        return;
      }
      S.vf.saving = false;
      S.vf.error = (e && e.message) || t("okErrSave");
      const mm = findMember(epic);
      const bx = document.getElementById("ok-vf-" + epic);
      if (mm && bx) bx.innerHTML = formHtml(mm);
    }
  },
};
