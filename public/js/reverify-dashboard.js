/* ============================================================================
   Re-verification Dashboard. Read-only. Layers "how far has re-verification
   got and what did it conclude" on top of the frozen ASDD List / Draft SIR
   worklists — without touching those tabs or their counts.

   Backend: src/reverify.ts  (GET /api/reverify/dashboard, /api/reverify/tile/:list/:tile)
   ========================================================================= */
import * as api from "./api.js";

let t = (k) => k;
let esc = (s) => String(s == null ? "" : s);
let staffLabel = (e) => e || "—";
let fmtDateTime = () => "";

const S = { view: "tiles", list: null, tile: null };
const el = () => document.getElementById("reverifyView");
const nf = (n) => Number(n || 0).toLocaleString("en-IN");

export function initReverify(helpers = {}) {
  if (helpers.t) t = helpers.t;
  if (helpers.escapeHtml) esc = helpers.escapeHtml;
  if (helpers.staffLabel) staffLabel = helpers.staffLabel;
  if (helpers.fmtDateTime) fmtDateTime = helpers.fmtDateTime;
  render();
}

async function render() {
  const root = el();
  if (!root) return;
  root.innerHTML = `<div class="empty">${esc(t("wlLoading"))}</div>`;
  if (S.view === "tile") return renderTile();
  return renderTiles();
}

async function renderTiles() {
  let data;
  try {
    data = await api.request("/reverify/dashboard");
  } catch (e) {
    el().innerHTML = `<div class="empty">${esc(t("wlOffline"))}</div>`;
    return;
  }
  el().innerHTML = `
    <div class="rv-head">
      <h2>${esc(t("rvTitle"))}</h2>
    </div>
    ${data.lists
      .map(
        (grp) => `
      <div class="rv-group">
        <h3>${esc(grp.label)}</h3>
        <div class="rv-tiles">
          ${grp.tiles.map((b) => tileCard(grp.list, b)).join("")}
        </div>
      </div>`
      )
      .join("")}
    <div class="rv-generated">${esc(t("rvUpdated"))}: ${esc(fmtDateTime(data.generated))}</div>`;
}

function bar(b) {
  const total = Math.max(b.frozen, 1);
  const seg = (n, cls) =>
    n > 0 ? `<span class="rv-seg ${cls}" style="flex:${n}" title="${nf(n)}"></span>` : "";
  return `<div class="rv-bar">
    ${seg(b.confirmed, "ok")}${seg(b.refuted, "no")}${seg(b.other, "other")}${seg(b.pending, "pend")}
  </div>`;
}

function tileCard(list, b) {
  const dcLine = b.dc > 0 ? ` &middot; +${nf(b.dc)} ${esc(t("rvDoubleCheck"))} (${nf(b.dc_done)} ${esc(t("rvDone"))})` : "";
  return `<button class="rv-tile" onclick="reverify.open('${list}','${b.key}')">
    <div class="rv-big">${nf(b.confirmed)}</div>
    <div class="rv-lbl">${esc(b.label)}</div>
    ${bar(b)}
    <div class="rv-prog">${nf(b.done)}/${nf(b.frozen)} ${esc(t("rvReverified"))}${
    b.pending > 0 ? ` &middot; ${nf(b.pending)} ${esc(t("rvLeft"))}` : ` &middot; ${esc(t("rvSettled"))}`
  }${dcLine}</div>
    <div class="rv-chips">
      ${b.refuted > 0 ? `<span class="rv-chip no">${nf(b.refuted)} ${esc(t("rvRefuted"))}</span>` : ""}
      ${b.other > 0 ? `<span class="rv-chip other">${nf(b.other)} ${esc(t("rvOther"))}</span>` : ""}
      ${b.base_changes > 0 ? `<span class="rv-chip warn">&#9888; ${nf(b.base_changes)} ${esc(t("rvBaseChanges"))}</span>` : ""}
    </div>
  </button>`;
}

async function renderTile() {
  let d;
  try {
    d = await api.request(`/reverify/tile/${S.list}/${S.tile}`);
  } catch (e) {
    el().innerHTML = `<div class="empty">${esc(t("wlOffline"))}</div>`;
    return;
  }
  const count = (v) => (v === "pending" ? d.pending || 0 : d.members.filter((m) => m.verdict === v).length);
  const verdictChip = (v) =>
    ({
      confirmed: `<span class="rv-vd ok">${esc(t("rvVdConfirmed"))}</span>`,
      refuted: `<span class="rv-vd no">${esc(t("rvVdRefuted"))}</span>`,
      other: `<span class="rv-vd other">${esc(t("rvVdOther"))}</span>`,
      pending: `<span class="rv-vd pend">${esc(t("rvVdPending"))}</span>`,
    }[v] || "");

  const memberRow = (m) => {
    let photos = 0;
    try {
      const p = typeof m.re_photos === "string" ? JSON.parse(m.re_photos) : m.re_photos;
      if (p) for (const k of Object.keys(p)) photos += (p[k] || []).length;
    } catch (e) {}
    return `<div class="rv-row">
      <div class="rv-r-main">
        <span class="rv-r-name">${esc(m.name)}</span>
        <span class="rv-r-meta">${esc(m.gender || "")}${m.age ? " / " + esc(m.age) : ""} &middot; ${esc(m.epic_id || "")} &middot; ${esc(t("wlPart"))} ${esc(m.old_part || m.new_part || "—")}${
      m.house_number_raw ? " &middot; " + esc(t("wlHouse")) + " " + esc(m.house_number_raw) : ""
    }</span>
      </div>
      <div class="rv-r-verdict">
        ${verdictChip(m.verdict)}
        ${m.re_outcome && m.re_outcome !== "Other" ? `<span class="rv-r-out">${esc(m.re_outcome)}</span>` : ""}
        ${photos ? `<span class="rv-r-ph">&#128247; ${photos}</span>` : ""}
      </div>
      ${m.re_notes ? `<div class="rv-r-note">&ldquo;${esc(m.re_notes)}&rdquo;</div>` : ""}
      ${
        m.re_verified_by
          ? `<div class="rv-r-by">${esc(t("rvBy"))} ${staffLabel(m.re_verified_by)}${
              m.re_verified_at ? " &middot; " + esc(fmtDateTime(m.re_verified_at)) : ""
            }</div>`
          : ""
      }
    </div>`;
  };

  const changedRow = (r) => `<div class="rv-row warn">
    <div class="rv-r-main"><span class="rv-r-name">${esc(r.name)}</span>
      <span class="rv-r-meta">${esc(r.epic_id || "")} &middot; ${esc(t("wlPart"))} ${esc(r.old_part || r.new_part || "—")}${
    r.house_number_raw ? " &middot; " + esc(r.house_number_raw) : ""
  }</span></div>
    <div class="rv-r-change">${esc(t("rvWas"))} <b>${esc(r.prior_status || "—")}${
    r.prior_sub ? " / " + esc(r.prior_sub) : ""
  }</b> &rarr; ${esc(t("rvNow"))} <b>${esc(r.now_status || "—")}${r.now_sub ? " / " + esc(r.now_sub) : ""}</b></div>
    ${
      r.now_by
        ? `<div class="rv-r-by">${esc(t("rvBy"))} ${staffLabel(r.now_by)}${r.now_at ? " &middot; " + esc(fmtDateTime(r.now_at)) : ""}</div>`
        : ""
    }
  </div>`;

  const candRow = (r) => `<div class="rv-row warn">
    <div class="rv-r-main"><span class="rv-r-name">${esc(r.name)}</span>
      <span class="rv-r-meta">${esc(r.gender || "")}${r.age ? " / " + esc(r.age) : ""} &middot; ${esc(r.epic_id || "")} &middot; ${esc(t("wlPart"))} ${esc(r.old_part || "—")}${
    r.house_number_raw ? " &middot; " + esc(t("wlHouse")) + " " + esc(r.house_number_raw) : ""
  }</span></div>
    <div class="rv-r-change">${esc(t("rvNow"))} <b>${esc(r.now_status || "—")}${r.now_sub ? " / " + esc(r.now_sub) : ""}</b></div>
    ${
      r.now_by
        ? `<div class="rv-r-by">${esc(t("rvBy"))} ${staffLabel(r.now_by)}${r.now_at ? " &middot; " + esc(fmtDateTime(r.now_at)) : ""}</div>`
        : ""
    }
  </div>`;

  const done = d.members;
  const pending = d.pending || 0;
  el().innerHTML = `
    <div class="rv-head">
      <div class="rv-crumb"><a onclick="reverify.home()">&lsaquo; ${esc(t("rvAllTiles"))}</a></div>
      <h2>${esc(d.label)}</h2>
      <p class="rv-summary">
        <b>${nf(count("confirmed"))}</b> ${esc(t("rvVdConfirmed"))} &middot;
        ${nf(count("refuted"))} ${esc(t("rvVdRefuted"))} &middot;
        ${nf(count("other"))} ${esc(t("rvVdOther"))} &middot;
        ${nf(pending)} ${esc(t("rvVdPending"))}
      </p>
    </div>
    <div class="rv-list">${done.map(memberRow).join("") || `<div class="empty">${esc(t("rvNoneDone"))}</div>`}</div>
    ${pending > 0 ? `<div class="rv-prog">${nf(pending)} ${esc(t("rvPendingNote"))}</div>` : ""}
    ${
      d.changed && d.changed.length
        ? `<h4 class="rv-sec warn">&#9888; ${esc(t("rvChangedSince"))} (${nf(d.changed.length)})</h4>
           <div class="rv-list">${d.changed.map(changedRow).join("")}</div>`
        : ""
    }
    ${
      d.candidates && d.candidates.length
        ? `<h4 class="rv-sec warn">&#9888; ${esc(t("rvNewCandidates"))} (${nf(d.candidates.length)})</h4>
           <div class="rv-list">${d.candidates.map(candRow).join("")}</div>`
        : ""
    }`;
}

window.reverify = {
  home() {
    S.view = "tiles";
    S.list = S.tile = null;
    render();
  },
  open(list, tile) {
    S.view = "tile";
    S.list = list;
    S.tile = tile;
    render();
  },
};
