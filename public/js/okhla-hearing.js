/* ============================================================================
   OKHLA — PUBLIC HEARING desk (Okhla tab, third sub-tab).

   Desk flow:
     1. Type an EPIC number or house number; the matching electors come up (any part, any block).
     2. Press PUBLIC HEARING next to the elector who has come. Their name, EPIC, house, part, block and SIR status
        are filled in from the roll; the desk adds a phone number.
     3. Issue token: a full-screen token (PH-K12) flashes so it can be read out to the elector.
     4. EXIT DESK (next to a token): testimony at the hearing, what was done (several can apply) and remarks. It
        can be reopened and edited at any time; every save is logged on the server.
   One token per elector: if they already have one, it is shown again. Tokens need a connection (the number
   comes from the server so two desks can never issue the same one). Backend: src/okhla_hearing.ts.
   ========================================================================= */
import * as api from "./api.js";
import { latestName, changesHtml, twinsHtml } from "./okhla-changes.js";

let t = (k) => k;
let esc = (s) => String(s ?? "");
let toast = () => {};
let rerender = () => {};
let staffLabel = (e) => e;
let fmtDateTime = (d) => d;
let historyHtml = () => "";
let confirmDialog = async () => true;

const P = {
  q: "",
  result: null, // /okhla/hearing/search response
  loading: false,
  error: "",
  form: null, // { id, phone, error, saving }
  issued: null, // { token, name, epic, existing }
  exit: null, // the open exit-desk form: { id, testimony, statuses: [], remarks, error, saving }
  dash: null, // /okhla/hearing/dashboard
  dashAt: null,
  dashError: "",
};

const EXIT_OPTS = [
  ["form6_filled", "phS1"],
  ["form6_submitted", "phS2"],
  ["ack_received", "phS3"],
  ["notice_help", "phS4"],
  ["first_time_form6", "phS5"],
];

const STATUS_KEY = {
  NOTICE: "okSNotice", ASDD: "okSAsdd", DELETED: "okSDeleted", CLEARED: "okSCleared",
  NO_SIR: "okSNoSir", PENDING: "okSPending", UNLINKED: "okSUnlinked",
};

// Counter the elector goes to: G and K have their own counters, every other block (or no block) goes to OTHER.
const counterOf = (blockKey) => (blockKey === "K" || blockKey === "G" ? blockKey : "OTHER");

export function initHearing(h = {}) {
  if (h.t) t = h.t;
  if (h.escapeHtml) esc = h.escapeHtml;
  if (h.showToast) toast = h.showToast;
  if (h.rerender) rerender = h.rerender;
  if (h.staffLabel) staffLabel = h.staffLabel;
  if (h.fmtDateTime) fmtDateTime = h.fmtDateTime;
  if (h.historyHtml) historyHtml = h.historyHtml;
  if (h.confirmDialog) confirmDialog = h.confirmDialog;
  window.okhlaPh = handlers;
}

const findMember = (id) => {
  for (const hh of (P.result && P.result.households) || []) for (const m of hh.members) if (m.id === id) return m;
  return null;
};

/* ------------------------------------------------------------------ views */
function memberRow(m) {
  const rel = m.relation_name ? `${m.relation_type ? esc(m.relation_type) + " " : ""}${esc(m.relation_name)}` : "";
  const meta = [m.age ? esc(m.age) : "", m.gender ? esc(m.gender) : "", rel].filter(Boolean).join(" · ");
  const action = m.hearing
    ? `<div class="ph-has"><span class="ph-pill">${esc(m.hearing.token)}</span>
         <button class="ph-exit-btn" onclick="okhlaPh.openExit(${m.id})">${esc(t("phExitBtn"))}</button></div>${exitSummaryHtml(m)}`
    : `<button class="ph-btn" onclick="okhlaPh.open(${m.id})">${esc(t("phBtn"))}</button>`;
  return `
    <div class="wl-voter ok-member">
      <div class="v-top">
        <span class="ok-who"><span class="v-name">${esc(latestName(m))}</span></span>
        <span class="ok-badge s-${esc(m.status)}">${esc(t(STATUS_KEY[m.status] || m.status))}</span>
      </div>
      <div class="v-meta">${meta}</div>
      <div class="v-epic">${m.epic_id ? esc(m.epic_id) : esc(t("okNoEpic"))}</div>
      ${twinsHtml(m, t, esc, (st) => t(STATUS_KEY[st] || st), "okhlaPh.goEpic")}
      ${changesHtml(m, t, esc)}
      <div class="v-tags">
        <span class="tag part">${esc(t("okOldPart"))} ${m.old_part ?? "—"}</span>
        <span class="tag">${esc(t("okNewPart"))} ${m.new_part ?? "—"}</span>
        <span class="tag">${esc(t("phLBlock"))} ${m.block ? esc(m.block) : "—"}</span>
      </div>
      <div class="ph-act">${action}</div>
      ${P.form && P.form.id === m.id ? formHtml(m) : ""}
      ${P.exit && P.exit.id === m.id ? exitFormHtml(m) : ""}
    </div>`;
}

const exitSaved = (h) => !!(h && (h.exit_testimony || h.exit_status || h.exit_remarks));

function exitSummaryHtml(m) {
  const h = m.hearing;
  if (!exitSaved(h) || (P.exit && P.exit.id === m.id)) return "";
  const done = (h.exit_status || "").split(",").filter(Boolean);
  const labels = EXIT_OPTS.filter(([v]) => done.includes(v)).map(([, key]) => `<li>${esc(t(key))}</li>`).join("");
  return `
    <div class="ph-exit-sum">
      <div class="ph-exit-sum-hd">${esc(t("phExitRecorded"))}</div>
      ${h.exit_testimony ? `<div><span class="ph-k">${esc(t("phQTestimony"))}</span> <b>${esc(t(h.exit_testimony === "yes" ? "phYes" : "phNo"))}</b></div>` : ""}
      ${labels ? `<ul>${labels}</ul>` : ""}
      ${h.exit_remarks ? `<div class="ph-exit-rem">${esc(h.exit_remarks)}</div>` : ""}
      <div class="ph-k">${esc(t("phExitSavedBy"))} ${esc(staffLabel(h.exit_by) || "—")} · ${esc(fmtDateTime(h.exit_at))}</div>
    </div>`;
}

function exitFormHtml(m) {
  const x = P.exit;
  const yn = (v, key) => `<label><input type="radio" name="ph-testimony" ${x.testimony === v ? "checked" : ""}
      onchange="okhlaPh.setExit('testimony','${v}')" /> ${esc(t(key))}</label>`;
  return `
    <div class="wl-form ph-form">
      <div class="ph-form-hd">${esc(t("phExitTitle"))} · ${esc(m.hearing.token)}</div>
      ${detailsHtml(m)}
      <div class="ph-grid ph-token-info">
        <div class="ph-k">${esc(t("phLToken"))}</div><div class="ph-v"><b>${esc(m.hearing.token)}</b> · ${esc(fmtDateTime(m.hearing.issued_at))} · ${esc(staffLabel(m.hearing.issued_by) || "—")}</div>
        <div class="ph-k">${esc(t("phPhoneShort"))}</div><div class="ph-v">${esc(m.hearing.phone || "—")}</div>
      </div>
      ${historyHtml(m)}
      <div class="f-label">${esc(t("phQTestimony"))}</div>
      <div class="f-radios">${yn("yes", "phYes")}${yn("no", "phNo")}</div>
      <div class="f-label">${esc(t("phQStatus"))}</div>
      <div class="f-radios">${EXIT_OPTS.map(
        ([v, key]) => `<label><input type="checkbox" ${x.statuses.includes(v) ? "checked" : ""}
          onchange="okhlaPh.toggleExit('${v}',this.checked)" /> ${esc(t(key))}</label>`
      ).join("")}</div>
      <div class="f-label">${esc(t("phQRemarks"))}</div>
      <textarea rows="3" oninput="okhlaPh.setExit('remarks',this.value)">${esc(x.remarks)}</textarea>
      ${x.error ? `<div class="field-hint" style="color:var(--danger-text)">${esc(x.error)}</div>` : ""}
      <div class="f-actions">
        <button onclick="okhlaPh.saveExit()" ${x.saving ? "disabled" : ""}>${esc(x.saving ? t("okSaving") : t("phExitSave"))}</button>
        <button class="secondary" onclick="okhlaPh.cancelExit()">${esc(t("okCancel"))}</button>
      </div>
    </div>`;
}

// the elector's details from the roll, filled in for the token form and shown again at the exit desk
function detailsHtml(m) {
  const row = (label, value) => `<div class="ph-k">${esc(label)}</div><div class="ph-v">${value}</div>`;
  const rel = m.relation_name ? `${m.relation_type ? m.relation_type + " " : ""}${m.relation_name}` : "—";
  const house = [String(m.house_raw || "").split(",")[0].trim() || "—", m.house_floor ? `${m.house_floor} ${t("okFloor")}` : ""].filter(Boolean).join(" · ");
  const detail = m.status_detail ? ` · ${esc(m.status_detail)}` : "";
  return `
      <div class="ph-grid">
        ${row(t("phLName"), `<b>${esc(latestName(m))}</b>`)}
        ${row(t("phLRelative"), esc(rel))}
        ${row(t("phLAgeSex"), esc([m.age, m.gender].filter(Boolean).join(" / ") || "—"))}
        ${row(t("phLEpic"), esc(m.epic_id || t("okNoEpic")))}
        ${row(t("phLHouse"), esc(house))}
        ${row(t("phLParts"), `${esc(t("okOldPart"))} ${m.old_part ?? "—"} · ${esc(t("okNewPart"))} ${m.new_part ?? "—"}`)}
        ${row(t("phLBlock"), m.block ? esc(m.block) : `<i>${esc(t("phBlockNone"))}</i>`)}
        ${row(t("phLStatus"), esc(t(STATUS_KEY[m.status] || m.status)) + detail)}
      </div>`;
}

function formHtml(m) {
  const f = P.form;
  return `
    <div class="wl-form ph-form">
      <div class="ph-form-hd">${esc(t("phFormTitle"))}</div>
      ${detailsHtml(m)}
      <div class="f-label">${esc(t("phPhone"))}</div>
      <input type="tel" inputmode="tel" maxlength="16" placeholder="${esc(t("phPhoneHint"))}" value="${esc(f.phone)}"
        oninput="okhlaPh.set('phone',this.value)" />
      ${f.error ? `<div class="field-hint" style="color:var(--danger-text)">${esc(f.error)}</div>` : ""}
      <div class="f-actions">
        <button onclick="okhlaPh.submit()" ${f.saving ? "disabled" : ""}>${esc(f.saving ? t("phIssuing") : t("phIssue"))}</button>
        <button class="secondary" onclick="okhlaPh.cancel()">${esc(t("okCancel"))}</button>
      </div>
    </div>`;
}

function householdHtml(h) {
  const house = h.hh_norm ? h.house_label : t("okNoHouse");
  const place = h.section_name || t("okNoBlock");
  return `
    <div class="wl-house open ok-house">
      <div class="ok-house-hd"><div>
        <div class="ok-house-no">${esc(t("okHouse"))} <b>${esc(house)}</b></div>
        <div class="ok-house-sub">${esc(t("okPartWord"))} ${h.old_part ?? "—"} · ${esc(place)}</div>
      </div></div>
      <div class="wl-voters">${h.members.map(memberRow).join("")}</div>
    </div>`;
}

function resultsHtml() {
  if (P.loading) return `<div class="empty">${esc(t("wlLoading"))}</div>`;
  if (P.error) return `<div class="empty">${esc(P.error)}</div>`;
  const r = P.result;
  if (!r) return `<div class="empty">${esc(t("phIdle"))}</div>`;
  if (!(r.households || []).length) return `<div class="empty">${esc(t("okNoResults"))}</div>`;
  const hits = new Set(r.seed_ids || []);
  // an EPIC / name search lists the matched elector's whole household; the person who came is highlighted
  void hits;
  return r.households.map(householdHtml).join("");
}

function overlayHtml() {
  const i = P.issued;
  if (!i) return "";
  return `
    <div class="ph-overlay" role="dialog" aria-modal="true" aria-label="${esc(t("phTokenTitle"))}">
      <div class="ph-card">
        <div class="ph-card-hd">${esc(t("phTokenTitle"))}</div>
        <div class="ph-token">${esc(i.token)}</div>
        <div class="ph-counter"><span>${esc(t("phCounter"))}</span><b>${esc(counterOf(i.block_key))}</b></div>
        <div class="ph-card-who"><b>${esc(i.name)}</b><br>${esc(i.epic || "")}</div>
        <div class="ph-card-say">${esc(t("phTellThem"))}</div>
        ${i.existing ? `<div class="ph-card-note">${esc(t("phExisting"))}</div>` : ""}
        <button class="ph-done" onclick="okhlaPh.done()">${esc(t("phDone"))}</button>
      </div>
    </div>`;
}

export function hearingHtml() {
  return `
    <div class="wl-search ok-search">
      <input id="ph-q" placeholder="${esc(t("phPlaceholder"))}" value="${esc(P.q)}" autocomplete="off"
        onkeydown="if(event.key==='Enter')okhlaPh.search()" />
      <button onclick="okhlaPh.search()">${esc(t("wlSearchBtn"))}</button>
      ${P.q || P.result ? `<button class="secondary" onclick="okhlaPh.clear()">${esc(t("okClear"))}</button>` : ""}
    </div>
    <div class="ok-hint">${esc(t("phHint"))}</div>
    <div id="ph-results">${resultsHtml()}</div>
    ${overlayHtml()}`;
}

/* ------------------------------------------------------------------ dashboard */
// Counts only: tokens issued, by the elector's SIR tag at the time (ASDD / Notice / ...), by counter, by desk volunteer, and exit desk progress.
export async function loadDash() {
  P.dashError = "";
  try {
    P.dash = await api.request("/okhla/hearing/dashboard");
    P.dashAt = new Date();
  } catch (e) {
    P.dashError = !e || e.status === 0 ? t("phOffline") : e.message || String(e);
  }
  rerender();
}

export function dashHtml() {
  if (P.dashError) return `<div class="empty">${esc(P.dashError)}</div>`;
  const d = P.dash;
  if (!d) return `<div class="empty">${esc(t("wlLoading"))}</div>`;
  const fmt = (n) => (n || 0).toLocaleString("en-IN");
  const st = d.by_status || {};
  const known = ["ASDD", "NOTICE", "DELETED", "CLEARED"];
  const other = Object.entries(st).filter(([k]) => !known.includes(k)).reduce((a, [, n]) => a + n, 0);
  const tile = (cls, n, label) => `<div class="ok-tile static ${cls}"><span class="big">${fmt(n)}</span><span class="lbl">${esc(label)}</span></div>`;
  const pct = (n) => (d.total ? Math.round((100 * n) / d.total) : 0);
  const cats = [["ASDD", "okSAsdd"], ["NOTICE", "okSNotice"], ["DELETED", "okTileDeleted"], ["CLEARED", "okSCleared"]];
  const ex = d.exit || {};
  const exitRows = [
    ["phDashExitDone", ex.recorded],
    ["phQTestimony", null],
    ["phDashTestYes", ex.testimony_yes],
    ["phDashTestNo", ex.testimony_no],
    ["phS1", ex.form6_filled],
    ["phS2", ex.form6_submitted],
    ["phS3", ex.ack_received],
    ["phS4", ex.notice_help],
    ["phS5", ex.first_time_form6],
  ];
  const when = P.dashAt ? P.dashAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
  return `
    <div class="ok-progbar">
      <span class="ok-scope">${esc(t("phDashTitle"))}${when ? " · " + esc(t("phDashAt")) + " " + esc(when) : ""}</span>
      <button class="secondary" onclick="okhlaPh.refreshDash()">${esc(t("phDashRefresh"))}</button>
    </div>
    <div class="ok-tiles">
      ${tile("total", d.total, t("phDashTotal"))}
      ${cats.map(([k, key]) => tile("s-" + k, st[k], t(key))).join("")}
      ${other ? tile("", other, t("phDashOther")) : ""}
    </div>
    <div class="section-title">${esc(t("phDashByCounter"))}</div>
    <table class="parts"><thead><tr><th>${esc(t("phDashCounter"))}</th><th>${esc(t("phDashTokens"))}</th><th>%</th></tr></thead><tbody>
      ${["K", "G", "OTHER"].map((c) => `<tr><td>${esc(c)}</td><td>${fmt((d.by_counter || {})[c])}</td><td>${pct((d.by_counter || {})[c] || 0)}%</td></tr>`).join("")}
    </tbody></table>
    <div class="section-title">${esc(t("phDashExit"))}</div>
    <table class="parts"><tbody>
      ${exitRows
        .map(([key, n]) =>
          n === null
            ? `<tr><th colspan="2">${esc(t(key))}</th></tr>`
            : `<tr><td>${esc(t(key))}</td><td>${fmt(n)}${key === "phDashExitDone" && d.total ? ` <span class="muted">(${pct(n)}%)</span>` : ""}</td></tr>`
        )
        .join("")}
    </tbody></table>
    <div class="section-title">${esc(t("phDashIssuers"))}</div>
    <table class="parts"><thead><tr><th>${esc(t("phDashVolunteer"))}</th><th>${esc(t("phDashTokens"))}</th></tr></thead><tbody>
      ${(d.by_issuer || []).map((r) => `<tr><td>${esc(staffLabel(r.email) || "—")}</td><td>${fmt(r.n)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`}
    </tbody></table>`;
}

/* ------------------------------------------------------------------ actions */
async function runSearch() {
  const q = (document.getElementById("ph-q") || { value: P.q }).value.trim();
  P.q = q;
  P.form = null;
  P.exit = null;
  if (!q) {
    P.result = null;
    P.error = "";
    return rerender();
  }
  P.loading = true;
  P.error = "";
  rerender();
  try {
    if (!navigator.onLine) throw new api.ApiError("offline", 0);
    P.result = await api.request("/okhla/hearing/search?q=" + encodeURIComponent(q));
  } catch (e) {
    P.result = null;
    P.error = !e || e.status === 0 ? t("phOffline") : e.message || String(e);
  }
  P.loading = false;
  rerender();
  const i = document.getElementById("ph-q");
  if (i) i.focus();
}

const handlers = {
  refreshDash() {
    P.dash = null;
    loadDash();
  },
  search: runSearch,
  // open the other entry of a possible duplicate
  goEpic(epic) {
    const i = document.getElementById("ph-q");
    if (i) i.value = epic;
    runSearch();
  },
  clear() {
    P.q = "";
    P.result = null;
    P.error = "";
    P.form = null;
    P.exit = null;
    rerender();
  },
  open(id) {
    const m = findMember(id);
    if (!m) return;
    P.form = { id, phone: "", error: "", saving: false };
    P.exit = null;
    rerender();
  },
  openExit(id) {
    const m = findMember(id);
    if (!m || !m.hearing) return;
    const h = m.hearing;
    P.exit = {
      id,
      testimony: h.exit_testimony || "",
      statuses: (h.exit_status || "").split(",").filter(Boolean),
      remarks: h.exit_remarks || "",
      error: "",
      saving: false,
    };
    P.form = null;
    rerender();
  },
  cancelExit() {
    P.exit = null;
    rerender();
  },
  setExit(field, v) {
    if (!P.exit) return;
    P.exit[field] = v;
    P.exit.error = "";
  },
  toggleExit(v, on) {
    if (!P.exit) return;
    const set = new Set(P.exit.statuses);
    if (on) set.add(v);
    else set.delete(v);
    P.exit.statuses = [...set];
    P.exit.error = "";
  },
  async saveExit() {
    const x = P.exit;
    if (!x || x.saving) return;
    if (!x.testimony && !x.statuses.length && !(x.remarks || "").trim()) {
      x.error = t("phExitNeedAny");
      return rerender();
    }
    const m = findMember(x.id);
    x.saving = true;
    x.error = "";
    rerender();
    try {
      if (!navigator.onLine) throw new api.ApiError("offline", 0);
      const r = await api.request("/okhla/hearing/exit", {
        method: "POST",
        body: { elector_id: x.id, testimony: x.testimony, statuses: x.statuses, remarks: x.remarks },
      });
      if (m && m.hearing)
        Object.assign(m.hearing, {
          exit_testimony: r.exit_testimony, exit_status: r.exit_status, exit_remarks: r.exit_remarks, exit_by: r.exit_by, exit_at: r.exit_at,
        });
      P.exit = null;
      rerender();
      toast(t("phExitSaved"));
    } catch (e) {
      x.saving = false;
      x.error = !e || e.status === 0 ? t("phOffline") : e.message || t("phErrIssue");
      rerender();
    }
  },
  cancel() {
    P.form = null;
    rerender();
  },
  set(field, v) {
    if (!P.form) return;
    P.form[field] = v;
    P.form.error = "";
  },
  done() {
    P.issued = null;
    rerender();
  },
  async submit() {
    const f = P.form;
    if (!f || f.saving) return;
    const digits = (f.phone || "").replace(/\D/g, "");
    // no phone number is allowed, but the desk is asked to confirm first
    if (!digits && !(await confirmDialog(esc(t("phNoPhoneConfirm")), { okLabel: t("phIssue") }))) return;
    const m = findMember(f.id);
    f.saving = true;
    f.error = "";
    rerender();
    try {
      if (!navigator.onLine) throw new api.ApiError("offline", 0);
      const r = await api.request("/okhla/hearing", { method: "POST", body: { elector_id: f.id, phone: f.phone } });
      if (m) m.hearing = { elector_id: f.id, token: r.token, block_key: r.block_key, phone: r.phone, issued_at: r.issued_at };
      P.issued = { token: r.token, block_key: r.block_key, name: m ? latestName(m) : "", epic: m ? m.epic_id : "", existing: !!r.existing };
      P.form = null;
      rerender();
    } catch (e) {
      f.saving = false;
      f.error = !e || e.status === 0 ? t("phOffline") : e.message || t("phErrIssue");
      rerender();
    }
  },
};

function fail(msg) {
  P.form.error = msg;
  rerender();
}
