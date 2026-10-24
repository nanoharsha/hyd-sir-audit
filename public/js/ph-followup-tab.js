/* ============================================================================
   PH FOLLOW UP tab. A post-hearing follow-up note against one voter — four
   Yes/No questions, saved to a table separate from ph_remarks (see
   migration_016.sql / src/ph_followup.ts for why they're split).

   One persistent screen, top to bottom:
     1. Search bar — searches EVERY voter (base roll + Draft SIR + ASDD, via
        the same /search-all the SEARCH tab uses), not only people who
        already have a Public Hearing case, so a follow-up note can be
        opened for anyone at the door. Replaces the whole screen below with
        results while active; "Back" returns here.
     2. Title.
     3. Part -> House browse, always here, unfiltered — every Public Hearing
        case (ph_remarks) PLUS every voter who has a follow-up note but no
        case at all (search-any-voter entries), grouped old part -> house,
        same shape as the printed household lists. See buildCaseUniverse()
        for why the union matters, not ph_remarks alone.
     4. The six dashboard tiles (households/cases flagged vs completed, then
        % BLO contacted / Form 6 submitted / need assistance / notice
        received — see the TILE_FILTERS comment for exactly what each
        counts).
     5. Clicking any tile reveals a part-wise list of completed cases (Form 6
        Submitted = Yes) below the tiles — the same single destination for
        every tile, for now.

   No live grouping query server-side: ph_remarks and ph_followup are both
   small, fully cached tables (same "ship it whole" reasoning as the SEARCH
   tab's PH cache) — the part/house grouping happens here, in JS, off the
   cached arrays, so it works offline exactly the same as online with no
   separate offline code path to keep in sync.

   State lives at module scope (not inside initPhFollowup), same as
   search-all.js — a tab switch away and back must not lose where the surveyor
   was.
   ========================================================================= */
import * as api from "./api.js";
import { store } from "./store.js";

const YES_NO = [
  ["Yes", "wlYes"],
  ["No", "wlNo"],
];

let t = (k) => k;
let toast = () => {};
let esc = (s) => String(s == null ? "" : s);
let staffLabel = (e) => e || "-";
let fmtDateTime = () => "";

const escAttr = (s) => String(s == null ? "" : s).replace(/'/g, "\\'").replace(/"/g, "&quot;");
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const el = () => document.getElementById("phFollowupView");

// Government marking/status label — the "PH Status" tag. Raw asddo_reason
// values translate through the same asddoReasonX keys the ASDD List tab
// uses; the other three kinds get their own phGov* keys. Keep in sync with
// VoterStatus in src/comprehensive_search.ts.
const ASDD_REASON_KEY = {
  Death: "asddoReasonDeath",
  "Permanently Shifted": "asddoReasonShifted",
  "Untraceable/Absent": "asddoReasonAbsent",
  "Already enrolled": "asddoReasonEnrolled",
};
function govStatusLabel(status) {
  if (!status) return null;
  if (status.kind === "asddo") return t(ASDD_REASON_KEY[status.reason] || status.reason || "");
  if (status.kind === "sir") return t("phGovInDraft");
  if (status.kind === "field_addition") return t("phGovFieldAddition");
  return t("phGovNoSir");
}
// Search results already carry this (searchAll's own shaping) — no extra
// fetch needed there, unlike the browse list which reads from ph_remarks and
// has no government-status field of its own.
function govStatusLabelFromSearch(v) {
  if (v.sir_status_kind === "asddo") return v.sir_status_detail || govStatusLabel({ kind: "asddo", reason: null });
  if (v.sir_status_kind === "sir") return t("phGovInDraft");
  if (v.sir_status_kind === "field_addition") return t("phGovFieldAddition");
  return t("phGovNoSir");
}

// The six dashboard tile numbers. A "household" is (part_number,
// house_number_raw) — same grouping the browse list uses. Definitions:
//   - Household "completed" = EVERY case at that house has Form 6 Submitted
//     = Yes. Strict AND, not "at least one" — a household isn't done until
//     everyone in it is.
//   - BLO Contacted / Need Assistance / Notice Received = household counts
//     as Yes if ANY case at that house has that answer Yes. These are
//     genuinely per-person facts (one member's BLO visit, one member's
//     notice) that still describe the household as a whole once true for
//     anyone there.
//   - % denominator is always the total households flagged for follow-up
//     (i.e. every household with at least one Public Hearing case) — not
//     just households already touched by a follow-up visit. A low
//     percentage is meant to read as "still to reach", not divide away.
// What a tile click shows: for now, every tile opens the same thing — a
// part-wise list of individually completed cases (Form 6 Submitted = Yes),
// below the tiles. Per-tile drill-down (e.g. "just the BLO-contacted ones")
// is not built yet.

const S = {
  view: "main", // "main" | "search"
  query: "",
  selectedPart: null,
  selectedHouse: null,
  showCompleted: false, // the part-wise completed-cases section below the tiles
  openKey: null, // voter_key of the open follow-up form
  snapByKey: {}, // voter_key -> { name, house_number_raw, part_number, epic_id } — sent on save
  vCache: {}, // voter_key -> the existing ph_followup row backing the open form (prefill)
  statusByKey: {}, // voter_key -> {kind, reason} — "PH Status", fetched for whatever cases are on screen
};
let cacheWarmedAt = 0;

export function initPhFollowup(helpers = {}) {
  if (helpers.t) t = helpers.t;
  if (helpers.showToast) toast = helpers.showToast;
  if (helpers.escapeHtml) esc = helpers.escapeHtml;
  if (helpers.staffLabel) staffLabel = helpers.staffLabel;
  if (helpers.fmtDateTime) fmtDateTime = helpers.fmtDateTime;
  if (Date.now() - cacheWarmedAt > 5 * 60 * 1000) {
    cacheWarmedAt = Date.now();
    Promise.all([api.refreshPhRemarks().catch(() => {}), api.refreshPhFollowup().catch(() => {})]).catch(() => {
      cacheWarmedAt = 0;
    });
  }
  window.phFollowup = handlers;
  render();
}

/* -------------------------------------------------------------- rendering */
function searchBarHtml() {
  return `
    <div class="wl-search">
      <input id="phf-q" placeholder="${esc(t("phfSearchPlaceholder"))}" value="${esc(S.query)}"
        onkeydown="if(event.key==='Enter')phFollowup.runSearch()" />
      <button onclick="phFollowup.runSearch()">${esc(t("wlSearchBtn"))}</button>
      ${S.view !== "main" ? `<button class="secondary" onclick="phFollowup.home()">${esc(t("wlBack"))}</button>` : ""}
    </div>`;
}
const titleHtml = () => `<div class="section-title">${esc(t("phfTitle"))}</div>`;

async function render() {
  const root = el();
  if (!root) return;
  root.innerHTML = `${searchBarHtml()}${titleHtml()}<div class="empty">${esc(t("wlLoading"))}</div>`;
  if (S.view === "search") return renderSearch();
  return renderMain();
}

// The full universe this tab tracks: every ph_remarks case, PLUS every
// ph_followup row that has no matching case at all. That second group is
// real and expected — the search bar deliberately lets a follow-up be opened
// for "any voter", not only someone who already filed a Public Hearing case
// (owner request). Building the browse list / tiles / completed section from
// ph_remarks alone silently drops that second group entirely, which is
// exactly the bug reported 2026-09-16: field verifiers followed up with
// people via search, the answers saved correctly to ph_followup, and none of
// it ever showed up here because nothing looked at ph_followup except by
// walking ph_remarks first. Fix: always union the two by voter_key. A
// case-less entry gets a synthetic record from the follow-up's own name/
// house/part/epic snapshot, with case_id/case_type left null — caseHtml()
// already renders that as "no Public Hearing case on file", same tag the
// search view uses.
function buildCaseUniverse(remarksRows, followupRows) {
  const byKey = new Map();
  for (const c of remarksRows) byKey.set(c.voter_key, c);
  for (const f of followupRows) {
    if (byKey.has(f.voter_key)) continue;
    byKey.set(f.voter_key, {
      voter_key: f.voter_key, name: f.name, house_number_raw: f.house_number_raw,
      part_number: f.part_number, epic_id: f.epic_id, case_id: null, case_type: null,
    });
  }
  return [...byKey.values()];
}

// One row per household: every case at that house, plus the three "did
// anyone answer Yes" flags and whether every case there is fully submitted.
function computeHouseholds(cases, followupByKey) {
  const map = new Map();
  for (const c of cases) {
    const part = c.part_number || "—";
    const house = c.house_number_raw || "(no house recorded)";
    const key = part + "|" + house;
    const fu = followupByKey[c.voter_key] || null;
    const closed = !!(fu && fu.form6_submitted === "Yes");
    let hh = map.get(key);
    if (!hh) {
      hh = { part, house, cases: [], hasBlo: false, hasNotice: false, hasAssistance: false, allSubmitted: true };
      map.set(key, hh);
    }
    hh.cases.push({ c, fu, closed, hasFollowup: !!fu });
    if (fu && fu.blo_contacted === "Yes") hh.hasBlo = true;
    if (fu && fu.notice_received === "Yes") hh.hasNotice = true;
    if (fu && fu.form6_assistance === "Yes") hh.hasAssistance = true;
    if (!closed) hh.allSubmitted = false;
  }
  return [...map.values()];
}

function computeStats(cases, households) {
  const totalHouseholds = households.length;
  const completedHouseholds = households.filter((h) => h.allSubmitted).length;
  const completedCases = households.reduce((a, h) => a + h.cases.filter((e) => e.closed).length, 0);
  const bloCount = households.filter((h) => h.hasBlo).length;
  const assistCount = households.filter((h) => h.hasAssistance).length;
  const noticeCount = households.filter((h) => h.hasNotice).length;
  const pct = (n) => (totalHouseholds ? Math.round((100 * n) / totalHouseholds) : 0);
  return {
    totalHouseholds, completedHouseholds, totalCases: cases.length, completedCases,
    bloCount, bloPct: pct(bloCount),
    form6Pct: pct(completedHouseholds),
    assistCount, assistPct: pct(assistCount),
    noticeCount, noticePct: pct(noticeCount),
  };
}

function groupHouseholdsByPart(households) {
  const parts = {};
  for (const hh of households) {
    const p = (parts[hh.part] ||= { part: hh.part, houses: [], total: 0, closed: 0 });
    p.houses.push(hh);
    p.total += hh.cases.length;
    p.closed += hh.cases.filter((e) => e.closed).length;
  }
  return Object.keys(parts)
    .sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999))
    .map((pk) => {
      const p = parts[pk];
      p.houses.sort((a, b) => a.house.localeCompare(b.house, undefined, { numeric: true }));
      return p;
    });
}

// Individually completed cases (Form 6 Submitted = Yes), grouped part ->
// house, always fully expanded (no select needed — this is a read view of a
// subset, not the general browse). What every tile click shows, for now.
function completedCasesByPart(cases, followupByKey) {
  const parts = {};
  for (const c of cases) {
    const fu = followupByKey[c.voter_key] || null;
    if (!fu || fu.form6_submitted !== "Yes") continue;
    const part = c.part_number || "—";
    const house = c.house_number_raw || "(no house recorded)";
    const p = (parts[part] ||= { part, houses: {} });
    const h = (p.houses[house] ||= { house, cases: [] });
    h.cases.push({ c, fu, closed: true, hasFollowup: true });
  }
  return Object.keys(parts)
    .sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999))
    .map((pk) => {
      const p = parts[pk];
      const houses = Object.keys(p.houses)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((hk) => p.houses[hk]);
      return { part: pk, houses };
    });
}

/* --------------------------------------------------------------- tiles */
function tileButtonHtml(big, label, sub) {
  return `<button class="wl-tile" onclick="phFollowup.showCompleted()">
    <div class="big">${big}</div>
    <div class="lbl">${label}</div>
    <div class="sub">${sub}</div>
  </button>`;
}

function tilesHtml(stats) {
  const hUnit = t(stats.totalHouseholds === 1 ? "wlHouseWord" : "wlHouses");
  const ofHouseholds = (n) => `${nf(n)} / ${nf(stats.totalHouseholds)} ${esc(hUnit)}`;
  return `<div class="wl-tiles-head"><h2>${esc(t("phfTilesTitle"))}</h2></div>
  <div class="wl-tiles">
    ${tileButtonHtml(
      `${nf(stats.completedHouseholds)} / ${nf(stats.totalHouseholds)}`,
      esc(t("phfTileHouseholdsLabel")), esc(t("phfCompletedWord"))
    )}
    ${tileButtonHtml(
      `${nf(stats.completedCases)} / ${nf(stats.totalCases)}`,
      esc(t("phfTileCasesLabel")), esc(t("phfCompletedWord"))
    )}
    ${tileButtonHtml(`${stats.bloPct}%`, esc(t("phfTileBloLabel")), ofHouseholds(stats.bloCount))}
    ${tileButtonHtml(`${stats.form6Pct}%`, esc(t("phfTileForm6Label")), ofHouseholds(stats.completedHouseholds))}
    ${tileButtonHtml(`${stats.assistPct}%`, esc(t("phfTileAssistLabel")), ofHouseholds(stats.assistCount))}
    ${tileButtonHtml(`${stats.noticePct}%`, esc(t("phfTileNoticeLabel")), ofHouseholds(stats.noticeCount))}
  </div>`;
}

function completedSectionHtml(groups) {
  const total = groups.reduce((a, p) => a + p.houses.reduce((b, h) => b + h.cases.length, 0), 0);
  const body = !total
    ? `<div class="empty">${esc(t("phfNoHouseholds"))}</div>`
    : `<div class="wl-summary">${nf(total)} ${esc(t(total === 1 ? "phfCaseWord" : "phfCases"))}</div>` +
      groups
        .map(
          (p) => `<div class="wl-part open">
            <div class="wl-part-hd"><span class="pt">${esc(t("wlPart"))} ${esc(p.part)}</span></div>
            <div class="wl-houses">
              ${p.houses
                .map(
                  (h) => `<div class="wl-house open">
                    <div class="wl-house-hd"><span>${esc(t("wlHouse"))} <b>${esc(h.house)}</b></span></div>
                    <div class="wl-voters">${h.cases.map((e) => caseHtml(e, S.statusByKey[e.c.voter_key])).join("")}</div>
                  </div>`
                )
                .join("")}
            </div>
          </div>`
        )
        .join("");
  return `<div class="wl-crumb" style="margin-top:var(--sp-5)"><a onclick="phFollowup.hideCompleted()">&times; ${esc(
    t("phfHideCompleted")
  )}</a></div>
    <div class="wl-tiles-head"><h2>${esc(t("phfCompletedByPartTitle"))}</h2></div>
    ${body}`;
}

async function renderMain() {
  const [remarks, followups] = await Promise.all([store.allPhRemarks(), store.allPhFollowups()]);
  const followupByKey = {};
  for (const f of followups) followupByKey[f.voter_key] = f;
  const cases = buildCaseUniverse(remarks, followups);
  S.snapByKey = {};
  for (const c of cases)
    S.snapByKey[c.voter_key] = {
      name: c.name, house_number_raw: c.house_number_raw, part_number: c.part_number, epic_id: c.epic_id,
    };

  if (!cases.length) {
    el().innerHTML = `${searchBarHtml()}${titleHtml()}<div class="empty">${esc(t("phfCasesEmpty"))}</div>`;
    return;
  }

  const households = computeHouseholds(cases, followupByKey);
  const stats = computeStats(cases, households);
  const parts = groupHouseholdsByPart(households);

  // Keep the selection valid if the underlying data moved under it — fall
  // back to "nothing selected" rather than pointing at a part/house that no
  // longer exists.
  const partObj = parts.find((p) => p.part === S.selectedPart) || null;
  if (!partObj) S.selectedPart = null;
  const houseObj = (partObj && partObj.houses.find((h) => h.house === S.selectedHouse)) || null;
  if (!houseObj) S.selectedHouse = null;

  const completedGroups = S.showCompleted ? completedCasesByPart(cases, followupByKey) : null;

  const keysNeeded = new Set();
  if (houseObj) for (const e of houseObj.cases) keysNeeded.add(e.c.voter_key);
  if (completedGroups) for (const p of completedGroups) for (const h of p.houses) for (const e of h.cases) keysNeeded.add(e.c.voter_key);
  const missing = [...keysNeeded].filter((k) => !(k in S.statusByKey));
  if (missing.length) Object.assign(S.statusByKey, await api.voterStatus(missing).catch(() => ({})));

  const totalCasesInView = households.reduce((a, h) => a + h.cases.length, 0);
  const summaryLine = `<div class="wl-summary">${nf(households.length)} ${esc(
    t(households.length === 1 ? "wlHouseWord" : "wlHouses")
  )} &middot; ${nf(totalCasesInView)} ${esc(t(totalCasesInView === 1 ? "phfCaseWord" : "phfCases"))}</div>`;

  el().innerHTML = `
    ${searchBarHtml()}
    ${titleHtml()}
    ${summaryLine}
    ${partSelectHtml(parts)}
    ${partObj ? houseSelectHtml(partObj) : ""}
    ${
      houseObj
        ? `<div class="wl-voters">${houseObj.cases
            .map((entry) => caseHtml(entry, S.statusByKey[entry.c.voter_key]))
            .join("")}</div>`
        : ""
    }
    ${tilesHtml(stats)}
    ${S.showCompleted ? completedSectionHtml(completedGroups) : ""}`;
  if (S.openKey) renderForm(S.openKey);
}

function partSelectHtml(parts) {
  return `<div class="f-label">${esc(t("phfSelectPart"))}</div>
    <select onchange="phFollowup.onPartChange(this.value)">
      <option value="">${esc(t("phfChoose"))}</option>
      ${parts
        .map(
          (p) =>
            `<option value="${escAttr(p.part)}" ${S.selectedPart === p.part ? "selected" : ""}>${esc(
              t("wlPart")
            )} ${esc(p.part)} — ${nf(p.total)} ${esc(t(p.total === 1 ? "phfCaseWord" : "phfCases"))}${
              p.closed ? ` (${nf(p.closed)} ${esc(t("phfClosedWord"))})` : ""
            }</option>`
        )
        .join("")}
    </select>`;
}

function houseSelectHtml(partObj) {
  return `<div class="f-label">${esc(t("phfSelectHouse"))}</div>
    <select onchange="phFollowup.onHouseChange(this.value)">
      <option value="">${esc(t("phfChoose"))}</option>
      ${partObj.houses
        .map((h) => {
          const closedCount = h.cases.filter((e) => e.closed).length;
          return `<option value="${escAttr(h.house)}" ${S.selectedHouse === h.house ? "selected" : ""}>${esc(
            t("wlHouse")
          )} ${esc(h.house)} — ${nf(h.cases.length)} ${esc(t(h.cases.length === 1 ? "phfCaseWord" : "phfCases"))}${
            closedCount ? ` (${nf(closedCount)} ${esc(t("phfClosedWord"))})` : ""
          }</option>`;
        })
        .join("")}
    </select>`;
}

function caseHtml(entry, status) {
  const { c, fu, closed, hasFollowup } = entry;
  const openForm = S.openKey === c.voter_key;
  const govLabel = govStatusLabel(status);
  return `<div class="wl-voter ${closed ? "done" : ""}">
    <div class="v-top">
      <span class="v-name">${esc(c.name)}</span>
      <span class="v-meta">${c.epic_id ? esc(c.epic_id) : ""}</span>
    </div>
    <div class="v-tags">
      ${
        c.case_id
          ? `<span class="tag">${esc(c.case_id)}</span><span class="tag">${esc(c.case_type || "")}</span>`
          : `<span class="tag">${esc(t("phfNoCaseTag"))}</span>`
      }
      ${govLabel ? `<span class="tag reason">${esc(t("phfGovLabel"))}: ${esc(govLabel)}</span>` : ""}
      ${closed ? `<span class="tag ok">${esc(t("phfClosedTag"))}</span>` : ""}
    </div>
    ${
      fu && fu.updated_by
        ? `<div class="v-line"><span class="k">${esc(t("phfUpdatedBy"))}</span> ${staffLabel(fu.updated_by)}${
            fu.updated_at ? ` &middot; ${esc(fmtDateTime(fu.updated_at))}` : ""
          }</div>`
        : ""
    }
    ${fu && fu.notes ? `<div class="v-line note">${esc(fu.notes)}</div>` : ""}
    <div class="v-actions">
      <button class="${hasFollowup ? "secondary" : ""}" onclick="phFollowup.toggleForm('${escAttr(c.voter_key)}')">${
    hasFollowup ? esc(t("phfEditBtn")) : esc(t("phfFollowUpBtn"))
  }</button>
    </div>
    ${openForm ? `<div id="phf-form-${c.voter_key}"></div>` : ""}
  </div>`;
}

/* --------------------------------------------------------------- search */
async function renderSearch() {
  let data;
  try {
    data = await api.searchAll(S.query);
  } catch (e) {
    el().innerHTML = searchBarHtml() + titleHtml() + `<div class="empty">${esc(t("wlOffline"))}</div>`;
    return;
  }
  const rows = data.results || [];
  S.snapByKey = {};
  for (const v of rows)
    S.snapByKey[v.key] = {
      name: v.name, house_number_raw: v.house_number_raw, part_number: v.part_number, epic_id: v.epic_id,
    };
  const fus = await Promise.all(rows.map((v) => store.getPhFollowup(v.key).catch(() => null)));
  rows.forEach((v, i) => (v._followup = fus[i]));

  el().innerHTML = `
    ${searchBarHtml()}
    ${titleHtml()}
    <div class="wl-summary">${nf(rows.length)} ${esc(t("wlResults"))}${
    data.offline ? " &middot; " + esc(t("wlOfflineShort")) : ""
  }</div>
    ${
      rows.length
        ? `<div class="wl-voters flat">${rows.map((v) => searchVoterHtml(v)).join("")}</div>`
        : `<div class="empty">${esc(t("phfNoResults"))}</div>`
    }`;
  if (S.openKey) renderForm(S.openKey);
}

function searchVoterHtml(v) {
  const fu = v._followup;
  const closed = !!(fu && fu.form6_submitted === "Yes");
  const hasFollowup = !!fu;
  const openForm = S.openKey === v.key;
  return `<div class="wl-voter ${closed ? "done" : ""}">
    <div class="v-top">
      <span class="v-name">${esc(v.name)}</span>
      <span class="v-meta">${esc(v.gender || "")}${v.age ? " / " + esc(v.age) : ""}${
    v.epic_id ? " &middot; " + esc(v.epic_id) : ""
  }</span>
    </div>
    <div class="v-line"><span class="k">${esc(t("wlPart"))}</span> ${esc(v.part_number || "—")}${
    v.house_number_raw ? ` &middot; <span class="k">${esc(t("wlHouse"))}</span> ${esc(v.house_number_raw)}` : ""
  }</div>
    <div class="v-tags">
      ${
        v.ph_remark && v.ph_remark.case_id
          ? `<span class="tag">${esc(v.ph_remark.case_id)}</span><span class="tag">${esc(v.ph_remark.case_type || "")}</span>`
          : `<span class="tag">${esc(t("phfNoCaseTag"))}</span>`
      }
      <span class="tag reason">${esc(t("phfGovLabel"))}: ${esc(govStatusLabelFromSearch(v))}</span>
      ${closed ? `<span class="tag ok">${esc(t("phfClosedTag"))}</span>` : ""}
    </div>
    ${fu && fu.notes ? `<div class="v-line note">${esc(fu.notes)}</div>` : ""}
    <div class="v-actions">
      <button class="${hasFollowup ? "secondary" : ""}" onclick="phFollowup.toggleForm('${escAttr(v.key)}')">${
    hasFollowup ? esc(t("phfEditBtn")) : esc(t("phfFollowUpBtn"))
  }</button>
    </div>
    ${openForm ? `<div id="phf-form-${v.key}"></div>` : ""}
  </div>`;
}

/* ----------------------------------------------------------------- form */
function currentAnswer(voterKey, qname) {
  const radios = document.getElementsByName(`phf-${qname}-${voterKey}`);
  for (const r of radios) if (r.checked) return r.value;
  return "";
}

function radiosHtml(voterKey, qname, curVal, onChangeCall) {
  return YES_NO.map(
    ([val, key]) =>
      `<label><input type="radio" name="phf-${qname}-${escAttr(voterKey)}" value="${val}" ${
        curVal === val ? "checked" : ""
      } ${onChangeCall ? `onchange="${onChangeCall}"` : ""}> <span>${esc(t(key))}</span></label>`
  ).join("");
}

function q3Html(voterKey, cur) {
  const q2 = currentAnswer(voterKey, "q2") || cur.form6_submitted || "";
  if (q2 === "Yes") {
    return `<div class="v-tags"><span class="tag ok">${esc(t("phfClosedTag"))}</span></div>`;
  }
  return `<div class="f-label">${esc(t("phfQ3"))}</div>
    <div class="f-radios">${radiosHtml(voterKey, "q3", cur.form6_assistance, null)}</div>`;
}

async function renderForm(voterKey) {
  const host = document.getElementById(`phf-form-${voterKey}`);
  if (!host) return;
  let fu = null;
  try {
    fu = (await api.getPhFollowup(voterKey)) || null;
  } catch (e) {
    fu = null;
  }
  S.vCache[voterKey] = fu || {};
  const cur = fu || {};
  host.innerHTML = `
    <div class="wl-form">
      <div class="f-label">${esc(t("phfQ1"))}</div>
      <div class="f-radios">${radiosHtml(voterKey, "q1", cur.blo_contacted, null)}</div>
      <div class="f-label">${esc(t("phfQ2"))}</div>
      <div class="f-radios">${radiosHtml(
        voterKey, "q2", cur.form6_submitted, `phFollowup.onQ2Change('${escAttr(voterKey)}')`
      )}</div>
      <div id="phf-q3-${voterKey}">${q3Html(voterKey, cur)}</div>
      <div class="f-label">${esc(t("phfQ4"))}</div>
      <div class="f-radios">${radiosHtml(voterKey, "q4", cur.notice_received, null)}</div>
      <div class="f-label">${esc(t("phfNotesLabel"))}</div>
      <textarea id="phf-notes-${voterKey}" rows="4" placeholder="${esc(t("phfNotesPlaceholder"))}">${esc(
    cur.notes || ""
  )}</textarea>
      <div class="f-actions">
        <button onclick="phFollowup.save('${escAttr(voterKey)}')">${esc(t("phfSaveBtn"))}</button>
        <button class="secondary" onclick="phFollowup.toggleForm('${escAttr(voterKey)}')">${esc(t("wlCancel"))}</button>
        <span class="save-msg" id="phf-msg-${voterKey}"></span>
      </div>
    </div>`;
}

/* -------------------------------------------------------------- handlers */
const handlers = {
  home() {
    S.view = "main";
    S.openKey = null;
    render();
  },
  showCompleted() {
    S.showCompleted = true;
    render().then(() => {
      const head = document.querySelector("#phFollowupView .wl-crumb");
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  },
  hideCompleted() {
    S.showCompleted = false;
    render();
  },
  onPartChange(value) {
    S.selectedPart = value || null;
    S.selectedHouse = null;
    S.openKey = null;
    render();
  },
  onHouseChange(value) {
    S.selectedHouse = value || null;
    S.openKey = null;
    render();
  },
  toggleForm(voterKey) {
    const opening = S.openKey !== voterKey;
    S.openKey = opening ? voterKey : null;
    if (!opening) delete S.vCache[voterKey];
    render().then(() => {
      if (S.openKey === voterKey) renderForm(voterKey);
    });
  },
  onQ2Change(voterKey) {
    const wrap = document.getElementById(`phf-q3-${voterKey}`);
    if (wrap) wrap.innerHTML = q3Html(voterKey, S.vCache[voterKey] || {});
  },
  runSearch() {
    const inp = document.getElementById("phf-q");
    S.query = inp ? inp.value.trim() : "";
    if (!S.query) return handlers.home();
    S.view = "search";
    S.openKey = null;
    render();
  },
  async save(voterKey) {
    const msg = document.getElementById(`phf-msg-${voterKey}`);
    const q2 = currentAnswer(voterKey, "q2");
    const notesEl = document.getElementById(`phf-notes-${voterKey}`);
    const snap = S.snapByKey[voterKey] || {};
    const payload = Object.assign({}, snap, {
      blo_contacted: currentAnswer(voterKey, "q1"),
      form6_submitted: q2,
      form6_assistance: q2 === "No" ? currentAnswer(voterKey, "q3") : "",
      notice_received: currentAnswer(voterKey, "q4"),
      notes: notesEl ? notesEl.value.trim() : "",
    });
    try {
      await api.queuePhFollowup(voterKey, payload);
      S.openKey = null;
      delete S.vCache[voterKey];
      toast(t("phfSaved"));
      if (api.state.online) await api.syncNow();
      render();
    } catch (e) {
      if (msg) msg.textContent = (e && e.detail && e.detail.detail) || (e && e.message) || t("phfErrSaving");
    }
  },
};
