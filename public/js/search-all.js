/* ============================================================================
   SEARCH tab — one box across the base roll (incl. field additions), the
   published Draft SIR 2026 roll and the ASDD list, merged by EPIC. Read-only
   voter data; the only thing this tab writes is a Public Hearing case
   (src/comprehensive_search.ts, migration_013 + migration_015).
   Offline-capable like every other tab: the merge runs against the same
   IndexedDB caches (store.js) when there's no signal, and both stages queue
   through the shared outbox (api.js) and apply optimistically.
   ========================================================================= */
import * as api from "./api.js";

let t = (k) => k;
let toast = () => {};
let esc = (s) => String(s == null ? "" : s);
let staffLabel = (e) => e || "—";
let fmtDateTime = () => "";

const S = { query: "", results: [], loading: false, openKey: null, saving: false, offline: false, photoDraft: {} };
const el = () => document.getElementById("searchAllView");
let cacheWarmedAt = 0;

const CASE_TYPES = [
  ["Wrong ASDD Marking", "saCaseWrongAsdd"],
  ["No SIR", "saCaseNoSir"],
  ["SIR Correction Request", "saCaseCorrection"],
];
const CORRECTION_FIELDS = [
  ["Name", "saFieldName"], ["Address", "saFieldAddress"], ["Age", "saFieldAge"],
  ["Sex", "saFieldSex"], ["Relative Name", "saFieldRelName"], ["Relative Type", "saFieldRelType"],
  ["Other", "saFieldOther"],
];
const PARTICIPATION_TYPES = [
  ["Testimony", "saPartTestimony"],
  ["Support / Assistance", "saPartSupport"],
  ["Other", "saPartOther"],
];
const SUPPORT_TYPES = [
  ["Form 6 - Self Filling", "saSupportForm6Self"],
  ["Form 6 - Assisted", "saSupportForm6Assisted"],
  ["Other", "saSupportOther"],
];
const YES_NO = [["Yes", "wlYes"], ["No", "wlNo"]];
const SIR_MODE = [["Online", "saOnline"], ["Offline", "saOffline"]];
const PHONE_PATTERN = /^\d{10}$/;

const ASDDO_REASON_KEY = {
  Death: "asddoReasonDeath",
  "Permanently Shifted": "asddoReasonShifted",
  "Absent / Untraceable": "asddoReasonAbsent",
  "Already Enrolled": "asddoReasonEnrolled",
};

// Booth-wise BLO contacts — mirrors src/comprehensive_search.ts's
// BLO_BY_OLD_PART/NEW_TO_OLD_PART/OLD_TO_NEW_PART exactly (see that file's
// comment for the old/new part numbering note). Duplicated on purpose so the
// Testimony follow-up can show this with no network signal, same as every
// other offline lookup in this tab — change both together.
const BLO_BY_OLD_PART = {};
// Secunderabad Cantt (AC 71): 2025 part N is 2026 part N+1 (Delhi's was +3).
const NEW_TO_OLD_PART = { "150": "149", "151": "150", "152": "151" };
const OLD_TO_NEW_PART = { "149": "150", "150": "151", "151": "152" };
// Returns both booth numbers for the resolved contact — the owner wants a
// surveyor to be able to match either numbering scheme against whatever's
// printed on the voter's slip, rather than guessing which one their part
// number belongs to (owner request, 2026-09-05).
function bloForPart(partNumber) {
  if (!partNumber) return null;
  const p = String(partNumber).trim();
  const oldBooth = BLO_BY_OLD_PART[p] ? p : NEW_TO_OLD_PART[p] || null;
  if (!oldBooth) return null;
  const rec = BLO_BY_OLD_PART[oldBooth];
  if (!rec) return null;
  return { oldBooth, newBooth: OLD_TO_NEW_PART[oldBooth] || null, name: rec.name, phone: rec.phone };
}
// Try every part number this voter row carries — whichever list it came
// from (base roll, Draft SIR or ASDD may each report a different numbering).
function bloForVoter(v) {
  return bloForPart(v.part_number) || bloForPart(v.draft_part) || bloForPart(v.asddo_part);
}

export function initSearchAll(helpers = {}) {
  if (helpers.t) t = helpers.t;
  if (helpers.showToast) toast = helpers.showToast;
  if (helpers.escapeHtml) esc = helpers.escapeHtml;
  if (helpers.staffLabel) staffLabel = helpers.staffLabel;
  if (helpers.fmtDateTime) fmtDateTime = helpers.fmtDateTime;
  // Warm every cache this tab's merge reads from — someone may open SEARCH
  // before ever visiting ASDD List / Draft SIR 2026, which is what normally
  // warms two of these. Throttled like those tabs' own warming.
  if (Date.now() - cacheWarmedAt > 5 * 60 * 1000) {
    cacheWarmedAt = Date.now();
    Promise.all([
      api.refreshRoll().catch(() => {}),
      api.refreshList("asddo", "asddo").catch(() => {}),
      api.refreshList("draftsir", "draftsir").catch(() => {}),
      api.refreshPhRemarks().catch(() => {}),
    ]).catch(() => {
      cacheWarmedAt = 0;
    });
  }
  render();
}

function render() {
  const root = el();
  if (!root) return;
  root.innerHTML = `
    <div class="sa-search">
      <input id="sa-q" placeholder="${esc(t("saPlaceholder"))}" value="${esc(S.query)}"
        onkeydown="if(event.key==='Enter')searchAll.run()" />
      <button onclick="searchAll.run()">${esc(t("wlSearchBtn"))}</button>
    </div>
    <div id="sa-results">${resultsHtml()}</div>`;
}

function resultsHtml() {
  if (S.loading) return `<div class="empty">${esc(t("wlLoading"))}</div>`;
  if (!S.query) return `<div class="empty">${esc(t("saIntro"))}</div>`;
  if (!S.results.length) return `<div class="empty">${esc(t("wlNoResults"))}</div>`;
  return `<div class="sa-summary">${S.results.length} ${esc(t("wlResults"))}${
    S.offline ? " &middot; " + esc(t("wlOfflineShort")) : ""
  }</div>
    <div class="sa-list">${S.results.map(cardHtml).join("")}</div>`;
}

function sirStatusHtml(v) {
  if (v.sir_status_kind === "asddo") {
    const rk = ASDDO_REASON_KEY[v.sir_status_detail];
    const label = rk ? t(rk) : v.sir_status_detail;
    const diffPart = v.asddo_part && v.part_source === "base" && v.asddo_part !== v.part_number;
    return `<span class="sa-tag sa-tag-asddo">${esc(t("saOnAsddo"))}: ${esc(label)}${
      diffPart ? ` &middot; ${esc(t("wlPart"))} ${esc(v.asddo_part)}, ${esc(t("saSrNo"))} ${esc(v.asddo_sr || "—")}` : ""
    }</span>`;
  }
  if (v.sir_status_kind === "sir") {
    const diffPart = v.draft_part && v.part_source === "base" && v.draft_part !== v.part_number;
    return `<span class="sa-tag sa-tag-sir">${esc(t("saPresentSir"))}${
      diffPart ? ` &middot; ${esc(t("wlPart"))} ${esc(v.draft_part)}, ${esc(t("saSrNo"))} ${esc(v.draft_sr || "—")}` : ""
    }</span>`;
  }
  if (v.sir_status_kind === "field_addition") {
    return `<span class="sa-tag sa-tag-add">${esc(t("saFieldAddNoSir"))}</span>`;
  }
  return `<span class="sa-tag sa-tag-nosir">${esc(t("saNoSir"))}</span>`;
}

function verifHtml(v) {
  if (!v.verif_status) return `<div class="sa-line"><span class="k">${esc(t("saFieldVerif"))}:</span> ${esc(t("saNotStarted"))}</div>`;
  // Only call out the round when it's a re-verification — "(base verification)"
  // on every ordinary row just added noise (owner feedback).
  const roundKey = { asddo: "saRoundAsddo", draftsir: "saRoundDraftsir" }[v.verif_round];
  return `<div class="sa-line"><span class="k">${esc(t("saFieldVerif"))}:</span> ${esc(v.verif_status)}${
    v.verif_sub ? " / " + esc(v.verif_sub) : ""
  }${roundKey ? ` <span class="sa-round">(${esc(t(roundKey))})</span>` : ""}</div>
  ${v.verif_by ? `<div class="sa-line"><span class="k">${esc(t("saVerifiedBy"))}:</span> ${esc(staffLabel(v.verif_by))}${
    v.verif_at ? " &middot; " + esc(fmtDateTime(v.verif_at)) : ""
  }</div>` : ""}`;
}

function cardHtml(v) {
  const open = S.openKey === v.key;
  const partBit = `${esc(t("wlPart"))} ${esc(v.part_number || "—")} &middot; ${esc(t("saSrNo"))} ${esc(v.sr_no || "—")}`;
  return `<div class="sa-card">
    <div class="v-top">
      <span class="v-name">${esc(v.name)}</span>
      <span class="v-meta">${esc(v.gender || "")}${v.age ? " / " + esc(v.age) : ""}</span>
    </div>
    ${v.relation ? `<div class="sa-line">${esc(v.relation)}</div>` : ""}
    <div class="sa-line"><span class="k">${esc(t("wlHouse"))}:</span> ${esc(v.house_number_raw || "—")}
      &middot; ${partBit}${v.epic_id ? ` &middot; ${esc(v.epic_id)}` : ""}</div>
    <div class="sa-tags">${sirStatusHtml(v)}</div>
    ${verifHtml(v)}
    <div class="sa-actions">
      <button class="secondary" onclick="searchAll.toggle('${escKey(v.key)}')">${esc(t("saPhRemarks"))} ${open ? "▾" : "▸"}</button>
      ${
        v.ph_remark && v.ph_remark.case_type
          ? `<span class="sa-caseid-badge">${esc(t("saCaseId"))}: ${
              v.ph_remark.case_id ? esc(v.ph_remark.case_id) : esc(t("saCaseIdPending"))
            }</span>`
          : ""
      }
    </div>
    ${open ? `<div id="sa-remark-${domId(v.key)}"></div>` : ""}
  </div>`;
}

function escKey(k) { return String(k).replace(/'/g, "\\'"); }
function domId(k) { return String(k).replace(/[^a-zA-Z0-9]/g, "_"); }

/* ------------------------------------------------------- PH remarks form */
function renderRemark(v) {
  const host = document.getElementById(`sa-remark-${domId(v.key)}`);
  if (!host) return;
  const r = v.ph_remark;
  host.innerHTML = `<div class="sa-remark">
    ${
      r && r.case_type
        ? `<div class="sa-caseid-banner">${esc(t("saCaseId"))}: <b>${
            r.case_id ? esc(r.case_id) : esc(t("saCaseIdPending"))
          }</b>
      <span class="sa-caseid-hint">${esc(t(r.case_id ? "saCaseIdHint" : "saCaseIdPendingHint"))}</span></div>`
        : ""
    }
    ${stage1Html(v, r)}
    ${r && r.case_type && r.participation_type === "Testimony" ? stage2Html(v, r) : ""}
  </div>`;
}

function stage1Html(v, r) {
  const cur = r?.case_type || "";
  const cf = (() => { try { return JSON.parse(r?.correction_fields || "[]"); } catch (e) { return []; } })();
  const pt = r?.participation_type || "";
  return `
    <div class="sa-stage">
      <div class="f-label">${esc(t("saCaseType"))}</div>
      <select id="sa-case-${domId(v.key)}" onchange="searchAll.onCaseType('${escKey(v.key)}')">
        <option value="">—</option>
        ${CASE_TYPES.map(([val, k]) => `<option value="${escAttr(val)}" ${cur === val ? "selected" : ""}>${esc(t(k))}</option>`).join("")}
      </select>
      <div id="sa-casesub-${domId(v.key)}">${caseSubHtml(v, cur, r, cf)}</div>

      <div class="f-label">${esc(t("saParticipation"))}</div>
      <select id="sa-part-${domId(v.key)}" onchange="searchAll.onParticipation('${escKey(v.key)}')">
        <option value="">—</option>
        ${PARTICIPATION_TYPES.map(([val, k]) => `<option value="${escAttr(val)}" ${pt === val ? "selected" : ""}>${esc(t(k))}</option>`).join("")}
      </select>
      <div class="f-label">${esc(t("saPhone"))}</div>
      <input type="tel" id="sa-phone-${domId(v.key)}" value="${esc(r?.phone || "")}" placeholder="${esc(t("saPhonePlaceholder"))}" />
      <div id="sa-partsub-${domId(v.key)}">${participationSubHtml(v, pt, r)}</div>

      <div class="f-actions">
        <button onclick="searchAll.saveStage1('${escKey(v.key)}')">${esc(t("saSaveCase"))}</button>
        <span class="save-msg" id="sa-msg1-${domId(v.key)}"></span>
      </div>
      ${r && r.stage1_by ? `<div class="sa-attrib">${esc(t("saCaseRecordedBy"))} <b>${esc(staffLabel(r.stage1_by))}</b> &middot; ${esc(fmtDateTime(r.stage1_at))}</div>` : ""}
    </div>`;
}

function caseSubHtml(v, caseType, r, cf) {
  if (caseType === "No SIR") {
    const submitted = r?.sir_submitted || "";
    return `
      <div class="f-label">${esc(t("saSirSubmitted"))}</div>
      <div class="f-radios">${YES_NO.map(([val, k]) =>
        `<label><input type="radio" name="sa-sirsub-${domId(v.key)}" value="${escAttr(val)}" ${submitted === val ? "checked" : ""}
           onchange="searchAll.refreshSub('${escKey(v.key)}')"> <span>${esc(t(k))}</span></label>`).join("")}</div>
      <div id="sa-sirextra-${domId(v.key)}">${sirExtraHtml(v, submitted, r)}</div>`;
  }
  if (caseType === "SIR Correction Request") {
    return `
      <div class="f-label">${esc(t("saCorrectionFields"))}</div>
      <div class="sa-checks">${CORRECTION_FIELDS.map(([val, k]) =>
        `<label><input type="checkbox" value="${escAttr(val)}" ${cf.includes(val) ? "checked" : ""}
           class="sa-cf-${domId(v.key)}" onchange="searchAll.onCorrectionField('${escKey(v.key)}')"> <span>${esc(t(k))}</span></label>`).join("")}</div>
      ${cf.includes("Other") ? `<input type="text" id="sa-cfother-${domId(v.key)}" placeholder="${esc(t("saOtherSpecify"))}" value="${esc(r?.correction_other || "")}" />` : `<input type="text" id="sa-cfother-${domId(v.key)}" placeholder="${esc(t("saOtherSpecify"))}" style="display:none" />`}`;
  }
  return "";
}

function sirExtraHtml(v, submitted, r) {
  if (submitted !== "Yes") return "";
  return `
    <div class="f-label">${esc(t("saSirMode"))}</div>
    <select id="sa-sirmode-${domId(v.key)}">${SIR_MODE.map(([val, k]) =>
      `<option value="${escAttr(val)}" ${r?.sir_submit_mode === val ? "selected" : ""}>${esc(t(k))}</option>`).join("")}</select>
    <div class="f-label">${esc(t("saSirReceipt"))}</div>
    <div class="f-radios">${YES_NO.map(([val, k]) =>
      `<label><input type="radio" name="sa-receipt-${domId(v.key)}" value="${escAttr(val)}" ${r?.sir_has_receipt === val ? "checked" : ""}>
         <span>${esc(t(k))}</span></label>`).join("")}</div>`;
}

// The field that comes with the chosen Public Hearing Participation branch:
// Testimony answers a description up front (the BLO follow-up, incl. its own
// knows-BLO question, is stage 2); Support / Assistance picks a solution type
// and also asks knows-BLO right here (owner request, 2026-09-05 — Support has
// no stage 2 of its own, so the BLO share has to happen in stage 1); Other
// just takes a note. Exactly one of these ever applies to a given case.
function participationSubHtml(v, pt, r) {
  if (pt === "Testimony") {
    return `<div class="f-label">${esc(t("saIssueDescription"))}</div>
      <textarea id="sa-issue-${domId(v.key)}" rows="3">${esc(r?.root_cause || "")}</textarea>`;
  }
  if (pt === "Support / Assistance") {
    const cur = r?.support_type || "";
    const knows = r?.knows_blo || "";
    return `<div class="f-label">${esc(t("saSupportType"))}</div>
      <select id="sa-support-${domId(v.key)}">
        <option value="">—</option>
        ${SUPPORT_TYPES.map(([val, k]) => `<option value="${escAttr(val)}" ${cur === val ? "selected" : ""}>${esc(t(k))}</option>`).join("")}
      </select>
      <div class="f-label">${esc(t("saKnowsBlo"))}</div>
      <div class="f-radios">${YES_NO.map(([val, k]) =>
        `<label><input type="radio" name="sa-supportknows-${domId(v.key)}" value="${escAttr(val)}" ${knows === val ? "checked" : ""}
           onchange="searchAll.onSupportKnowsBlo('${escKey(v.key)}')"> <span>${esc(t(k))}</span></label>`).join("")}</div>
      <div id="sa-supportblo-${domId(v.key)}">${bloCardHtml(v, knows)}</div>`;
  }
  if (pt === "Other") {
    return `<div class="f-label">${esc(t("saRemarks"))}</div>
      <textarea id="sa-otherremarks1-${domId(v.key)}" rows="3">${esc(r?.remarks || "")}</textarea>`;
  }
  return "";
}

function stage2Html(v, r) {
  const knows = r.knows_blo || "";
  return `
    <div class="sa-stage sa-stage2">
      <div class="sa-stage2-hd">${esc(t("saFollowUp"))}</div>
      <div class="f-label">${esc(t("saKnowsBlo"))}</div>
      <div class="f-radios">${YES_NO.map(([val, k]) =>
        `<label><input type="radio" name="sa-knowsblo-${domId(v.key)}" value="${escAttr(val)}" ${knows === val ? "checked" : ""}
           onchange="searchAll.onKnowsBlo('${escKey(v.key)}')"> <span>${esc(t(k))}</span></label>`).join("")}</div>
      <div id="sa-bloblock-${domId(v.key)}">${bloBlockHtml(v, knows, r)}</div>

      <div class="f-label">${esc(t("saOtherRemarks"))}</div>
      <textarea id="sa-remarks-${domId(v.key)}" rows="4">${esc(r.remarks || "")}</textarea>

      <div class="f-label">${esc(t("wlPhotoLabel"))}</div>
      <div id="sa-photo-${domId(v.key)}">${photoFieldHtml(v, r)}</div>

      <div class="sa-phone-confirm">${esc(t("saPhoneConfirmNote"))} <b>${esc(r.phone || "—")}</b></div>

      <div class="f-actions">
        <button onclick="searchAll.saveStage2('${escKey(v.key)}')">${esc(t("saSaveFollowUp"))}</button>
        <span class="save-msg" id="sa-msg2-${domId(v.key)}"></span>
      </div>
      ${r.stage2_by ? `<div class="sa-attrib">${esc(t("saFollowUpRecordedBy"))} <b>${esc(staffLabel(r.stage2_by))}</b> &middot; ${esc(fmtDateTime(r.stage2_at))}</div>` : ""}
    </div>`;
}

// The BLO contact card, looked up by the voter's part number (old or new
// numbering — bloForVoter/bloForPart handle the mapping). Shared by the
// Testimony follow-up (stage 2, via bloBlockHtml below) and the Support /
// Assistance branch (stage 1, via participationSubHtml above) — both share
// "no known BLO" the same way (owner request, 2026-09-05).
// New Booth No. only means anything for someone on the redelimited Draft SIR
// roll — the new numbering never applied to a pure ASDD removal, so that row
// is omitted unless v.in_sir is true (owner request, 2026-09-05). A voter
// who is in Draft SIR *and* flagged in ASDD (e.g. a "Wrong ASDD Marking"
// case) still gets it — the gate is "are they in Draft SIR", not "are they
// not in ASDD".
function bloCardHtml(v, knows) {
  if (knows !== "No") return "";
  const blo = bloForVoter(v);
  if (!blo) return `<div class="sa-blo-note">${esc(t("saBloUnknown"))}</div>`;
  return `<div class="sa-blo-card">
    <div class="sa-blo-row"><span class="k">${esc(t("saBloBoothOld"))}:</span> ${esc(blo.oldBooth)}</div>
    ${v.in_sir ? `<div class="sa-blo-row"><span class="k">${esc(t("saBloBoothNew"))}:</span> ${esc(blo.newBooth || "—")}</div>` : ""}
    <div class="sa-blo-row"><span class="k">${esc(t("saBloName"))}:</span> ${esc(blo.name)}</div>
    <div class="sa-blo-row"><span class="k">${esc(t("saBloPhone"))}:</span> ${esc(blo.phone)}</div>
  </div>`;
}

function bloBlockHtml(v, knows, r) {
  if (knows === "No") return bloCardHtml(v, knows);
  if (knows === "Yes") {
    return `<div class="f-label">${esc(t("saBroughtToBlo"))}</div>
      <div class="f-radios">${YES_NO.map(([val, k]) =>
        `<label><input type="radio" name="sa-blo-${domId(v.key)}" value="${escAttr(val)}" ${r.brought_to_blo === val ? "checked" : ""}>
           <span>${esc(t(k))}</span></label>`).join("")}</div>`;
  }
  return "";
}

// One optional photo on the Testimony follow-up. A staged (not-yet-saved)
// capture lives in S.photoDraft as a data: URL; once saved the server hands
// back a real "ph/<id>/..." key and the draft entry is cleared.
function photoFieldHtml(v, r) {
  const draft = Object.prototype.hasOwnProperty.call(S.photoDraft, v.key) ? S.photoDraft[v.key] : r.photo_key || null;
  if (draft) {
    const src = draft.slice(0, 5) === "data:" ? draft : `/api/uploads/${esc(draft)}`;
    return `<div class="sa-photo"><img src="${src}" alt="">
      <button type="button" onclick="searchAll.removePhoto('${escKey(v.key)}')">${esc(t("wlRemove"))}</button></div>`;
  }
  return `<label class="wl-add-photo">+ ${esc(t("wlAddPhoto"))}
    <input type="file" accept="image/*" capture="environment" onchange="searchAll.onPhoto('${escKey(v.key)}', this)"></label>`;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escAttr(s) { return String(s == null ? "" : s).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

/* --------------------------------------------------------------- handlers */
const handlers = {
  async run() {
    const inp = document.getElementById("sa-q");
    S.query = inp ? inp.value.trim() : "";
    S.openKey = null;
    if (!S.query) { S.results = []; render(); return; }
    S.loading = true; render();
    try {
      const data = await api.searchAll(S.query);
      S.results = data.results || [];
      S.offline = !!data.offline;
    } catch (e) {
      S.results = [];
      toast((e && e.detail && e.detail.detail) || (e && e.message) || t("wlErrSaving"));
    }
    S.loading = false;
    render();
  },
  toggle(key) {
    S.openKey = S.openKey === key ? null : key;
    render();
    if (S.openKey === key) {
      const v = S.results.find((r) => r.key === key);
      if (v) renderRemark(v);
    }
  },
  onCaseType(key) {
    const v = S.results.find((r) => r.key === key);
    const sel = document.getElementById(`sa-case-${domId(key)}`);
    const wrap = document.getElementById(`sa-casesub-${domId(key)}`);
    if (wrap) wrap.innerHTML = caseSubHtml(v, sel.value, v.ph_remark, []);
  },
  onParticipation(key) {
    const v = S.results.find((r) => r.key === key);
    const sel = document.getElementById(`sa-part-${domId(key)}`);
    const wrap = document.getElementById(`sa-partsub-${domId(key)}`);
    if (wrap) wrap.innerHTML = participationSubHtml(v, sel.value, v.ph_remark);
  },
  refreshSub(key) {
    const v = S.results.find((r) => r.key === key);
    const submitted = document.querySelector(`input[name="sa-sirsub-${domId(key)}"]:checked`)?.value || "";
    const wrap = document.getElementById(`sa-sirextra-${domId(key)}`);
    if (wrap) wrap.innerHTML = sirExtraHtml(v, submitted, v.ph_remark);
  },
  onCorrectionField(key) {
    const domKey = domId(key);
    const other = document.getElementById(`sa-cfother-${domKey}`);
    const checked = [...document.querySelectorAll(`.sa-cf-${domKey}:checked`)].map((c) => c.value);
    if (other) other.style.display = checked.includes("Other") ? "" : "none";
  },
  onKnowsBlo(key) {
    const v = S.results.find((r) => r.key === key);
    const knows = document.querySelector(`input[name="sa-knowsblo-${domId(key)}"]:checked`)?.value || "";
    const wrap = document.getElementById(`sa-bloblock-${domId(key)}`);
    if (wrap) wrap.innerHTML = bloBlockHtml(v, knows, v.ph_remark || {});
  },
  onSupportKnowsBlo(key) {
    const v = S.results.find((r) => r.key === key);
    const knows = document.querySelector(`input[name="sa-supportknows-${domId(key)}"]:checked`)?.value || "";
    const wrap = document.getElementById(`sa-supportblo-${domId(key)}`);
    if (wrap) wrap.innerHTML = bloCardHtml(v, knows);
  },
  async onPhoto(key, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      S.photoDraft[key] = await compressImage(file);
    } catch (e) {
      toast(t("wlErrSaving"));
      return;
    }
    const v = S.results.find((r) => r.key === key);
    const wrap = document.getElementById(`sa-photo-${domId(key)}`);
    if (wrap) wrap.innerHTML = photoFieldHtml(v, v.ph_remark || {});
  },
  removePhoto(key) {
    S.photoDraft[key] = null;
    const v = S.results.find((r) => r.key === key);
    const wrap = document.getElementById(`sa-photo-${domId(key)}`);
    if (wrap) wrap.innerHTML = photoFieldHtml(v, v.ph_remark || {});
  },
  async saveStage1(key) {
    const domKey = domId(key);
    const v = S.results.find((r) => r.key === key);
    const msg = document.getElementById(`sa-msg1-${domKey}`);
    if (msg) msg.textContent = "";
    const caseType = document.getElementById(`sa-case-${domKey}`)?.value || "";
    if (!caseType) { if (msg) msg.textContent = t("saPickCaseType"); return; }
    const participationType = document.getElementById(`sa-part-${domKey}`)?.value || "";
    if (!participationType) { if (msg) msg.textContent = t("saPickParticipation"); return; }
    const phone = (document.getElementById(`sa-phone-${domKey}`)?.value || "").trim();
    if (!PHONE_PATTERN.test(phone)) { if (msg) msg.textContent = t("saPhoneInvalid"); return; }

    const payload = {
      name: v.name, house_number_raw: v.house_number_raw,
      part_number: v.part_number, epic_id: v.epic_id, case_type: caseType,
      participation_type: participationType, phone,
    };
    if (caseType === "No SIR") {
      payload.sir_submitted = document.querySelector(`input[name="sa-sirsub-${domKey}"]:checked`)?.value || null;
      if (payload.sir_submitted === "Yes") {
        payload.sir_submit_mode = document.getElementById(`sa-sirmode-${domKey}`)?.value || null;
        payload.sir_has_receipt = document.querySelector(`input[name="sa-receipt-${domKey}"]:checked`)?.value || null;
      }
    } else if (caseType === "SIR Correction Request") {
      payload.correction_fields = [...document.querySelectorAll(`.sa-cf-${domKey}:checked`)].map((c) => c.value);
      payload.correction_other = document.getElementById(`sa-cfother-${domKey}`)?.value || "";
    }
    if (participationType === "Testimony") {
      payload.root_cause = document.getElementById(`sa-issue-${domKey}`)?.value || "";
    } else if (participationType === "Support / Assistance") {
      payload.support_type = document.getElementById(`sa-support-${domKey}`)?.value || "";
      payload.knows_blo = document.querySelector(`input[name="sa-supportknows-${domKey}"]:checked`)?.value || null;
    } else if (participationType === "Other") {
      payload.remarks = document.getElementById(`sa-otherremarks1-${domKey}`)?.value || "";
    }

    try {
      const { record } = await api.queuePhStage1(key, payload);
      v.ph_remark = record;
      if (api.state.online) {
        await api.syncNow();
        v.ph_remark = (await api.getPhRemark(key)) || v.ph_remark;
      }
      toast(t("saSaved"));
      renderRemark(v);
    } catch (e) {
      if (msg) msg.textContent = (e && e.detail && e.detail.detail) || (e && e.message) || t("wlErrSaving");
    }
  },
  async saveStage2(key) {
    const domKey = domId(key);
    const v = S.results.find((r) => r.key === key);
    const msg = document.getElementById(`sa-msg2-${domKey}`);
    if (msg) msg.textContent = "";
    const r = v.ph_remark || {};
    const payload = {
      knows_blo: document.querySelector(`input[name="sa-knowsblo-${domKey}"]:checked`)?.value || null,
      brought_to_blo: document.querySelector(`input[name="sa-blo-${domKey}"]:checked`)?.value || null,
      remarks: document.getElementById(`sa-remarks-${domKey}`)?.value || "",
      photo: Object.prototype.hasOwnProperty.call(S.photoDraft, key) ? S.photoDraft[key] : r.photo_key || null,
    };
    try {
      const { record } = await api.queuePhStage2(key, payload);
      v.ph_remark = record;
      delete S.photoDraft[key];
      if (api.state.online) {
        await api.syncNow();
        v.ph_remark = (await api.getPhRemark(key)) || v.ph_remark;
      }
      // The follow-up save is the last step of the case — call out the Case
      // ID here specifically so whoever just saved it can hand it to the voter.
      // It may still show as "pending" if this was saved offline.
      const saved = v.ph_remark;
      toast(saved && saved.case_id ? `${t("saSaved")} ${t("saCaseId")}: ${saved.case_id}` : t("saSaved"));
      renderRemark(v);
    } catch (e) {
      if (msg) msg.textContent = (e && e.detail && e.detail.detail) || (e && e.message) || t("wlErrSaving");
    }
  },
};

window.searchAll = handlers;
