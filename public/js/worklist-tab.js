/* ============================================================================
   Generic reverification-list tab. Drives the ASDD List (asddo-list.js) and
   the Draft SIR 2026 list (draftsir-list.js) — both configured, not copied.

   Backend: src/worklist.ts. Offline-capable (store.js list stores + the shared
   outbox). Layout: worklist tiles -> old part (new part shown) -> house
   (clickable) -> voter -> a category-aware reverification form following the
   Reverification Plan. A search box (house / EPIC / name) runs over the whole
   list, only to help a walk-in voter find themselves.

   CFG shape (see the two thin wrappers):
     { prefix, store, viewId, g,           // "asddo" | "draftsir" ...
       hasSegments,
       tiles: [{ key, k }],                // k = i18n key for the label
       outcomes: { tileKey: [[value, i18nKey], ...] },  // [0] = "found present"
       present: Set<string>,
       reasonTile: { reason: tileKey } | null,
       reasonLabelKeys: { reason: i18nKey } | null,
       listSaysKey, movedKey,              // i18n keys
       followups: (tile) => { sir, voted, moved, jan, phone, photo } }
   ========================================================================= */
import * as api from "./api.js";
import { store } from "./store.js";
import { ALL_CONFIGS } from "./worklist-configs.js";

const SIR_FORM = [["Yes", "wlSirYes"], ["No", "wlSirNo"], ["Submitted Online", "wlSirOnline"]];
const JAN_SUNWAI = [["Will participate", "wlJanParticipate"], ["Will speak", "wlJanSpeak"], ["No", "wlJanNo"]];
const YES_NO = [["Yes", "wlYes"], ["No", "wlNo"]];

// Synthetic outcome on every tile — skip the structured flow, just leave a
// remark. Must match OTHER_OUTCOME in src/worklist.ts.
const OTHER_OUTCOME = "Other";
// One photo per reverification, stored under the single "photo" slot.
const PHOTO_SLOT = "photo";
const MAX_PHOTOS_PER_SLOT = 1;

// v.re_photos is a JSON string from D1 or an object from an optimistic local
// record. Returns a fresh { slot: [key, ...] } to stage edits against.
function parseRePhotos(v) {
  let raw = v && v.re_photos;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  const out = {};
  if (raw && typeof raw === "object")
    for (const k of Object.keys(raw)) if (Array.isArray(raw[k])) out[k] = raw[k].slice();
  return out;
}

export function makeWorklistTab(CFG) {
  let t = (k) => k;
  let toast = () => {};
  let esc = (s) => String(s == null ? "" : s);
  let staffLabel = (e) => e || "-";
  let fmtDateTime = () => "";

  const S = {
    view: "tiles",
    tile: null,
    segment: "confirmed",
    openPart: null,
    openHouse: null,
    openVoter: null,
    query: "",
    photos: {}, // voterId -> { slot: [ dataUrl | existing-r2-key, ... ] }  (staged for the open form)
    vCache: {}, // voterId -> the voter row backing the open form
    otherIdx: {}, // "oldpart|housebase" -> [{ store, row }]  (other flags at that house)
  };
  let cacheWarmedAt = 0;

  const el = () => document.getElementById(CFG.viewId);
  const nf = (n) => Number(n || 0).toLocaleString("en-IN");
  const nHouses = (n) => `${nf(n)} ${t(Number(n) === 1 ? "wlHouseWord" : "wlHouses")}`;
  const nVoters = (n) => `${nf(n)} ${t(Number(n) === 1 ? "wlVoterWord" : "wlVoters")}`;
  const G = CFG.g; // the window.* handler namespace, e.g. "asddoList"
  const NS = CFG.store; // element-id prefix — both views live in the DOM at once,
  // so ids and radio names must not collide across the two lists ("asddo" / "draftsir")
  const escAttr = (s) => String(s == null ? "" : s).replace(/'/g, "\\'").replace(/"/g, "&quot;");
  const tileOf = (v) =>
    v.tile || (CFG.reasonTile && v[CFG.reasonCol] ? CFG.reasonTile[v[CFG.reasonCol]] : null) ||
    CFG.tiles[CFG.tiles.length - 1].key;
  const tileLabel = (key) => t((CFG.tiles.find((x) => x.key === key) || {}).k || key);
  const reasonLabel = (r) => (CFG.reasonLabelKeys && CFG.reasonLabelKeys[r] ? t(CFG.reasonLabelKeys[r]) : r);

  /* --------------------------------------------------------------- init */
  function init(helpers = {}) {
    if (helpers.t) t = helpers.t;
    if (helpers.showToast) toast = helpers.showToast;
    if (helpers.escapeHtml) esc = helpers.escapeHtml;
    if (helpers.staffLabel) staffLabel = helpers.staffLabel;
    if (helpers.fmtDateTime) fmtDateTime = helpers.fmtDateTime;
    if (Date.now() - cacheWarmedAt > 5 * 60 * 1000) {
      cacheWarmedAt = Date.now();
      // Warm BOTH list caches: the "other flags at this house" strip needs the
      // sibling list too, and it must work offline.
      Promise.all([
        api.refreshList("asddo", "asddo").catch(() => {}),
        api.refreshList("draftsir", "draftsir").catch(() => {}),
      ]).catch(() => {
        cacheWarmedAt = 0;
      });
    }
    render();
  }

  // Index every OTHER flag (any other tile, either list) that sits at a house
  // shown in the current tile drill. Matched on old part + house base — both
  // lists use the same old-part numbering for base-roll voters; rows with no
  // old part (Draft SIR's "not in our roll") are not cross-referenced.
  async function buildOtherIndex(parts) {
    const houseKeys = new Set(); // "oldpart|housebase" for houses in this drill
    for (const p of parts)
      for (const h of p.houses)
        if (h.house_base && p.old_part && !p.no_old_part)
          houseKeys.add(p.old_part + "|" + h.house_base);
    const idx = {};
    if (!houseKeys.size) return idx;
    for (const name of Object.keys(ALL_CONFIGS)) {
      let rows = [];
      try {
        rows = await store.allListRecords(name);
      } catch (e) {
        rows = [];
      }
      for (const r of rows) {
        if (!r.tile || !r.old_part || !r.house_base) continue;
        // The current tile (all its segments) is the team's own work — never
        // an "other flag". Everything else at the house is.
        if (name === CFG.store && r.tile === S.tile) continue;
        const key = r.old_part + "|" + r.house_base;
        if (!houseKeys.has(key)) continue;
        (idx[key] ||= []).push({ store: name, row: r });
      }
    }
    return idx;
  }

  /* ------------------------------------------------------------ rendering */
  async function render() {
    const root = el();
    if (!root) return;
    root.innerHTML = `<div class="empty">${esc(t("wlLoading"))}</div>`;
    if (S.view === "search") return renderSearch();
    if (S.view === "tile") return renderTile();
    return renderTiles();
  }

  function searchBarHtml() {
    return `
      <div class="wl-search">
        <input id="${NS}-q" placeholder="${esc(t("wlSearchPlaceholder"))}" value="${esc(S.query)}"
          onkeydown="if(event.key==='Enter')${G}.runSearch()" />
        <button onclick="${G}.runSearch()">${esc(t("wlSearchBtn"))}</button>
        ${S.view !== "tiles" ? `<button class="secondary" onclick="${G}.home()">${esc(t("wlBack"))}</button>` : ""}
      </div>`;
  }

  // The Anomalies tile grid — hidden 2026-09-04, restored 2026-09-06 at the
  // owner's request. The tile drill (renderTile) is also reachable straight
  // from the PH Dashboard and the "other flags at this house" jump.
  async function renderTiles() {
    let data;
    try {
      data = await api.listTiles(CFG.prefix, CFG.store, CFG.tiles.map((x) => ({ key: x.key, label: "" })), CFG.hasSegments);
    } catch (e) {
      el().innerHTML = searchBarHtml() + `<div class="empty">${esc(t("wlOffline"))}</div>`;
      return;
    }
    el().innerHTML = `
      ${searchBarHtml()}
      <div class="wl-tiles-head">
        <h2>${esc(t("wlAnomaliesTitle"))}</h2>
      </div>
      <div class="wl-tiles">
        ${data.tiles
          .map((b) => {
            const showDc = CFG.hasSegments && b.doublecheck > 0;
            return `<button class="wl-tile" onclick="${G}.openTile('${b.key}')">
              <div class="big">${nf(b.confirmed)}</div>
              <div class="lbl">${esc(tileLabel(b.key))}</div>
              <div class="sub">${esc(t("wlInHouses").replace("{n}", nf(b.confirmed_houses)))}${
                b.done ? ` &middot; <b>${nf(b.done)}</b> ${esc(t("wlDone"))}` : ""
              }</div>
              ${showDc ? `<div class="dc-line">+${nf(b.doublecheck)} ${esc(t("wlDoubleCheck"))}</div>` : ""}
            </button>`;
          })
          .join("")}
      </div>`;
  }

  async function renderTile() {
    const hasDc = CFG.hasSegments && S.tile !== "notbase";
    let data;
    try {
      data = await api.listTile(CFG.prefix, CFG.store, S.tile, S.segment);
    } catch (e) {
      el().innerHTML = searchBarHtml() + `<div class="empty">${esc(t("wlOffline"))}</div>`;
      return;
    }
    const parts = data.parts;
    S.otherIdx = await buildOtherIndex(parts);
    const tot = parts.reduce(
      (a, p) => ({ v: a.v + p.voters, h: a.h + p.house_count, d: a.d + p.done }),
      { v: 0, h: 0, d: 0 }
    );
    el().innerHTML = `
      ${searchBarHtml()}
      <div class="wl-head">
        <div class="wl-crumb"><a onclick="${G}.home()">&lsaquo; ${esc(t("wlAllTiles"))}</a></div>
        <h3>${esc(tileLabel(S.tile))}</h3>
        ${
          hasDc
            ? `<div class="seg-row">
                <button class="seg-btn ${S.segment === "confirmed" ? "on" : ""}" onclick="${G}.setSegment('confirmed')">${esc(t("wlSegConfirmed"))}</button>
                <button class="seg-btn ${S.segment === "doublecheck" ? "on" : ""}" onclick="${G}.setSegment('doublecheck')">${esc(t("wlSegDoubleCheck"))}</button>
              </div>`
            : ""
        }
        <div class="wl-summary">${esc(nVoters(tot.v))} &middot; ${esc(nHouses(tot.h))} &middot; ${nf(tot.d)} ${esc(t("wlDone"))}</div>
      </div>
      <div class="wl-parts">${parts.map((p) => partHtml(p)).join("")}</div>`;
  }

  function partHtml(p) {
    const open = S.openPart === p.old_part;
    const partLine = p.no_old_part
      ? `${esc(t("wlNewPart"))} ${esc(p.old_part)}`
      : `${esc(t("wlPart"))} ${esc(p.old_part)}${p.new_part ? ` <span class="np">&rarr; ${esc(p.new_part)}</span>` : ""}`;
    return `<div class="wl-part ${open ? "open" : ""}">
      <button class="wl-part-hd" onclick="${G}.togglePart('${escAttr(p.old_part)}')">
        <span class="pt">${partLine}</span>
        <span class="ct">${esc(nHouses(p.house_count))} &middot; ${esc(nVoters(p.voters))}${
      p.done ? ` &middot; ${p.done} ${esc(t("wlDone"))}` : ""
    }</span>
      </button>
      ${open ? `<div class="wl-houses">${p.houses.map((h) => houseHtml(p, h)).join("")}</div>` : ""}
    </div>`;
  }

  function houseHtml(p, h) {
    const key = p.old_part + "|" + h.house;
    const open = S.openHouse === key;
    const others = (!p.no_old_part && h.house_base && S.otherIdx[p.old_part + "|" + h.house_base]) || [];
    // Repeat the list-context tag on each card only where it varies within the
    // tile — i.e. the ASDD "not in our base roll" bucket (mixed removal reasons).
    // Elsewhere the tile heading already says it.
    const showListTag = CFG.store === "asddo" && S.tile === "notbase";
    return `<div class="wl-house ${open ? "open" : ""}">
      <button class="wl-house-hd" onclick="${G}.toggleHouse('${escAttr(key)}')">
        <span>${esc(t("wlHouse"))} <b>${esc(h.house)}</b>${
      others.length ? ` <span class="wl-other-badge">+${others.length} ${esc(t("wlOtherFlags"))}</span>` : ""
    }</span>
        <span class="ct">${esc(nVoters(h.voters.length))}${h.done ? ` &middot; ${h.done} ${esc(t("wlDone"))}` : ""}</span>
      </button>
      ${
        open
          ? `<div class="wl-voters">${h.voters.map((v) => voterHtml(v, showListTag)).join("")}</div>` + otherFlagsHtml(others)
          : ""
      }
    </div>`;
  }

  // The "other teams' flags at this house" section — read-only, one tap to jump
  // to the right list/tile with the form open. Kept visually separate so it is
  // never confused with the team's own worklist.
  function otherFlagsHtml(others) {
    if (!others.length) return "";
    return `<div class="wl-others">
      <div class="wl-others-hd">${esc(t("wlOtherFlagsTitle"))}</div>
      ${others
        .map(({ store: sname, row: r }) => {
          const ocfg = ALL_CONFIGS[sname];
          const tileName = t((ocfg.tiles.find((x) => x.key === r.tile) || {}).k || r.tile);
          const done = r.re_status === "Done";
          return `<div class="wl-other-row">
            <div class="o-main">
              <span class="o-name">${esc(r.name)}</span>
              <span class="o-meta">${esc(r.gender || "")}${r.age ? " / " + esc(r.age) : ""}${r.epic_id ? " &middot; " + esc(r.epic_id) : ""}</span>
            </div>
            <div class="o-tag">${esc(t(ocfg.tabLabelKey))} &middot; ${esc(tileName)}${
            done ? ` &middot; <span class="o-done">&check; ${esc(r.re_outcome)}</span>` : ""
          }</div>
            <button class="secondary o-go" onclick="app.jumpToWorklistVoter('${ocfg.prefix}', '${escAttr(r.tile)}', ${r.id})">${
            done ? esc(t("wlEdit")) : esc(t("wlVerifyBtn"))
          }</button>
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function priorLine(v) {
    if (!v.prior_by) return "";
    return `<div class="v-line"><span class="k">${esc(t("wlPrevBy"))}</span> ${staffLabel(v.prior_by)}${
      v.prior_at ? ` &middot; ${esc(fmtDateTime(v.prior_at))}` : ""
    }</div>`;
  }

  // The list-context tag on a voter card. ASDD carries a removal reason per
  // row ("ASDD says: Permanently Shifted"); Draft SIR does not — for it we say
  // whether the person is in the published roll.
  function listTag(v) {
    if (CFG.reasonCol && v[CFG.reasonCol])
      return `<span class="tag reason">${esc(t(CFG.listSaysKey))}: ${esc(reasonLabel(v[CFG.reasonCol]))}</span>`;
    if (CFG.store === "draftsir")
      return `<span class="tag reason">${esc(t(v.in_draft ? "draftsirInRoll" : "draftsirNotInRoll"))}</span>`;
    return "";
  }

  // "We found" only when we recorded an actual outcome — not "Not Started".
  function weFoundTag(v) {
    if (!v.prior_status || v.prior_status === "Not Started") return "";
    return `<span class="tag">${esc(t("wlWeFound"))}: ${esc(v.prior_status)}${
      v.prior_sub && v.prior_sub !== "—" ? " / " + esc(v.prior_sub) : ""
    }</span>`;
  }

  // `showListTag` — passed true only where the list-context tag adds something:
  // in search (no tile heading) and in the ASDD "not in base roll" tile (the
  // reason varies there). In every reason-bound tile drill it just repeats the
  // heading, so it is suppressed.
  function voterHtml(v, showListTag) {
    const done = v.re_status === "Done";
    const openForm = S.openVoter === v.id;
    return `<div class="wl-voter ${done ? "done" : ""}">
      <div class="v-top">
        <span class="v-name">${esc(v.name)}</span>
        <span class="v-meta">${esc(v.gender || "")}${v.age ? " / " + esc(v.age) : ""}${
      v.relation_name ? " &middot; " + esc(v.relation_type || "") + " " + esc(v.relation_name) : ""
    }</span>
      </div>
      ${v.epic_id ? `<div class="v-epic">${esc(v.epic_id)}</div>` : ""}
      <div class="v-tags">
        ${showListTag ? listTag(v) : ""}
        ${weFoundTag(v)}
        ${v.segment === "doublecheck" ? `<span class="tag dc">${esc(t("wlDc"))}</span>` : ""}
        ${done ? `<span class="tag ok">${esc(t("wlReverified"))} ${esc(v.re_outcome)}</span>` : ""}
      </div>
      ${priorLine(v)}
      ${v.dc_subtag ? `<div class="v-line"><span class="k">${esc(t("wlWhy"))}</span> ${esc(v.dc_subtag)}</div>` : ""}
      ${v.prior_note ? `<div class="v-line note">${esc(t("wlOurNote"))}: &ldquo;${esc(v.prior_note)}&rdquo;</div>` : ""}
      <div class="v-actions">
        <button class="${done ? "secondary" : ""}" onclick="${G}.toggleForm(${v.id})">${
      done ? esc(t("wlEdit")) : esc(t("wlVerifyBtn"))
    }</button>
      </div>
      ${openForm ? `<div id="${NS}-form-${v.id}"></div>` : ""}
    </div>`;
  }

  /* --------------------------------------------------- verification form */
  async function renderForm(id) {
    const host = document.getElementById(`${NS}-form-${id}`);
    if (!host) return;
    let v;
    try {
      v = await api.listGet(CFG.prefix, CFG.store, id);
    } catch (e) {
      v = null;
    }
    if (!v) {
      host.innerHTML = `<div class="wl-form">${esc(t("wlOffline"))}</div>`;
      return;
    }
    S.vCache[id] = v;
    if (!S.photos[id]) S.photos[id] = parseRePhotos(v);
    // "Other" sits first — a verifier who just wants to leave a remark never has
    // to read past it.
    const opts = [[OTHER_OUTCOME, "wlOutOther"]].concat(CFG.outcomes[tileOf(v)] || []);
    const cur = v.re_outcome || "";
    host.innerHTML = `
      <div class="wl-form">
        <div class="f-label">${esc(t("wlOutcomeLabel"))}</div>
        <div class="f-radios">
          ${opts
            .map(
              ([val, key]) =>
                `<label><input type="radio" name="${NS}-out-${id}" value="${escAttr(val)}" ${
                  cur === val ? "checked" : ""
                } onchange="${G}.onOutcome(${id})"> <span>${esc(t(key))}</span></label>`
            )
            .join("")}
        </div>
        <div id="${NS}-extra-${id}"></div>
        <div class="f-label" id="${NS}-noteslbl-${id}">${esc(t("wlNotesLabel"))}</div>
        <textarea id="${NS}-notes-${id}" rows="5">${esc(v.re_notes || "")}</textarea>
        <div class="f-actions">
          <button onclick="${G}.save(${id})">${esc(t("wlSaveBtn"))}</button>
          <button class="secondary" onclick="${G}.toggleForm(${id})">${esc(t("wlCancel"))}</button>
          <span class="save-msg" id="${NS}-msg-${id}"></span>
        </div>
      </div>`;
    renderExtra(id, v);
  }

  // The single photo upload: the staged/stored photo as a removable thumbnail,
  // or an add button. Sits at the end of #extra, i.e. just above Notes.
  function photoFieldHtml(id) {
    const arr = (S.photos[id] && S.photos[id][PHOTO_SLOT]) || [];
    const thumbs = arr
      .map((entry, i) => {
        const src = entry.slice(0, 5) === "data:" ? entry : `/api/uploads/${esc(entry)}`;
        return `<span class="wl-thumb"><img src="${src}" alt="">
          <button type="button" title="${esc(t("wlRemove"))}" onclick="${G}.rmPhoto(${id},${i})">&times;</button></span>`;
      })
      .join("");
    const full = arr.length >= MAX_PHOTOS_PER_SLOT;
    return `<div class="f-label">${esc(t("wlPhotoLabel"))}</div>
      <div class="wl-photo-slot"><div class="wl-thumbs">${thumbs}${
      full
        ? ""
        : `<label class="wl-add-photo">+ ${esc(t("wlAddPhoto"))}
             <input type="file" accept="image/*" capture="environment"
                    onchange="${G}.addPhoto(${id},this)"></label>`
    }</div></div>`;
  }

  function renderExtra(id, v) {
    const wrap = document.getElementById(`${NS}-extra-${id}`);
    if (!wrap) return;
    const sel = document.querySelector(`input[name="${NS}-out-${id}"]:checked`);
    const outcome = sel ? sel.value : "";
    const lbl = document.getElementById(`${NS}-noteslbl-${id}`);
    if (lbl) lbl.textContent = t(outcome === OTHER_OUTCOME ? "wlRemarkLabel" : "wlNotesLabel");
    const present = !!outcome && outcome !== OTHER_OUTCOME && CFG.present.has(outcome);
    const fu = CFG.followups(tileOf(v));
    const optList = (arr, cur) =>
      `<option value="">—</option>` +
      arr.map(([val, k]) => `<option value="${escAttr(val)}" ${cur === val ? "selected" : ""}>${esc(t(k))}</option>`).join("");
    const field = (on, labelKey, selectId, arr, cur) =>
      on
        ? `<div class="f-label">${esc(t(labelKey))}</div>` +
          (selectId
            ? `<select id="${NS}-${selectId}-${id}">${optList(arr, cur)}</select>`
            : `<input id="${NS}-phone-${id}" type="tel" value="${esc(cur || "")}" />`)
        : "";
    wrap.innerHTML =
      (present
        ? field(fu.sir, "wlSirLabel", "sir", SIR_FORM, v.sir_form) +
          field(fu.voted, "wlVotedLabel", "voted", YES_NO, v.voted_2025) +
          field(fu.moved, CFG.movedKey, "moved", YES_NO, v.moved_here_recently) +
          field(fu.phone, "wlPhoneLabel", "", null, v.contact_phone) +
          field(fu.jan, "wlJanLabel", "jan", JAN_SUNWAI, v.jan_sunwai)
        : "") +
      // one photo, always available (incl. "Other" / "not found"), just above Notes
      photoFieldHtml(id);
  }

  function refreshExtra(id) {
    renderExtra(id, S.vCache[id] || {});
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

  /* ------------------------------------------------------------ search view */
  async function renderSearch() {
    let data;
    try {
      data = await api.listSearch(CFG.prefix, CFG.store, S.query);
    } catch (e) {
      el().innerHTML = searchBarHtml() + `<div class="empty">${esc(t("wlOffline"))}</div>`;
      return;
    }
    const rows = data.results;
    el().innerHTML = `
      ${searchBarHtml()}
      <div class="wl-summary">${rows.length} ${esc(t("wlResults"))}${
      data.offline ? " &middot; " + esc(t("wlOfflineShort")) : ""
    }</div>
      ${
        rows.length
          ? `<div class="wl-voters flat">${rows.map((v) => searchVoterHtml(v)).join("")}</div>`
          : `<div class="empty">${esc(t("wlNoResults"))}</div>`
      }`;
    if (S.openVoter) renderForm(S.openVoter);
  }

  function searchVoterHtml(v) {
    const done = v.re_status === "Done";
    const partBit = v.old_part
      ? `${esc(v.old_part)}${v.new_part && v.new_part !== v.old_part ? ` &rarr; ${esc(v.new_part)}` : ""}`
      : esc(v.new_part || "—");
    return `<div class="wl-voter ${done ? "done" : ""}">
      <div class="v-top">
        <span class="v-name">${esc(v.name)}</span>
        <span class="v-meta">${esc(v.gender || "")}${v.age ? " / " + esc(v.age) : ""}${v.epic_id ? " &middot; " + esc(v.epic_id) : ""}</span>
      </div>
      <div class="v-line"><span class="k">${esc(t("wlPart"))}</span> ${partBit}${
      v.house_number_raw ? ` &middot; <span class="k">${esc(t("wlHouse"))}</span> ${esc(v.house_number_raw)}` : ""
    }</div>
      <div class="v-tags">
        ${listTag(v)}
        ${
          v.tile
            ? `<span class="tag ${v.segment === "doublecheck" ? "dc" : ""}">${esc(t("wlFlaggedFor"))}: ${esc(tileLabel(v.tile))}</span>`
            : CFG.searchAnyReverify
            ? ""
            : `<span class="tag">${esc(t("wlNoReverifyNeeded"))}</span>`
        }
        ${weFoundTag(v)}
        ${done ? `<span class="tag ok">${esc(t("wlReverified"))} ${esc(v.re_outcome)}</span>` : ""}
      </div>
      ${priorLine(v)}
      ${
        v.tile || CFG.searchAnyReverify
          ? `<div class="v-actions">
        <button class="${done ? "secondary" : ""}" onclick="${G}.toggleForm(${v.id})">${
              done ? esc(t("wlEdit")) : esc(t("wlVerifyBtn"))
            }</button>
      </div>
      ${S.openVoter === v.id ? `<div id="${NS}-form-${v.id}"></div>` : ""}`
          : ""
      }
    </div>`;
  }

  /* --------------------------------------------------------------- handlers */
  const handlers = {
    home() {
      S.view = "tiles";
      S.tile = S.openPart = S.openHouse = S.openVoter = null;
      render();
    },
    openTile(key) {
      S.view = "tile";
      S.tile = key;
      S.segment = "confirmed";
      S.openPart = S.openHouse = S.openVoter = null;
      render();
    },
    setSegment(seg) {
      S.segment = seg;
      S.openPart = S.openHouse = S.openVoter = null;
      render();
    },
    togglePart(p) {
      S.openPart = S.openPart === p ? null : p;
      S.openHouse = S.openVoter = null;
      render();
    },
    toggleHouse(key) {
      S.openHouse = S.openHouse === key ? null : key;
      S.openVoter = null;
      render();
    },
    toggleForm(id) {
      const opening = S.openVoter !== id;
      S.openVoter = opening ? id : null;
      if (!opening) {
        delete S.photos[id];
        delete S.vCache[id];
      }
      render().then(() => {
        if (S.openVoter === id) renderForm(id);
      });
    },
    // Jump to one voter (used by another tab's "other flags at this house"
    // strip). Opens this list's tile -> the part+house holding the voter ->
    // the form.
    async goToVoter(tile, id) {
      S.view = "tile";
      S.tile = tile;
      S.query = "";
      S.openPart = S.openHouse = S.openVoter = null;
      let data;
      try {
        data = await api.listTile(CFG.prefix, CFG.store, tile, "all");
      } catch (e) {
        render();
        return;
      }
      for (const p of data.parts)
        for (const h of p.houses) {
          const v = h.voters.find((x) => x.id === id);
          if (v) {
            S.segment = v.segment === "doublecheck" ? "doublecheck" : "confirmed";
            S.openPart = p.old_part;
            S.openHouse = p.old_part + "|" + h.house;
            S.openVoter = id;
          }
        }
      render().then(() => {
        if (S.openVoter === id) {
          renderForm(id);
          const node = document.getElementById(`${NS}-form-${id}`);
          if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    onOutcome(id) {
      refreshExtra(id);
    },
    async addPhoto(id, input) {
      const file = input && input.files && input.files[0];
      if (!file) return;
      const msg = document.getElementById(`${NS}-msg-${id}`);
      S.photos[id] = S.photos[id] || {};
      try {
        S.photos[id][PHOTO_SLOT] = [await compressImage(file)]; // one photo — replaces any prior
        if (msg) msg.textContent = "";
      } catch (e) {
        if (msg) msg.textContent = t("wlErrSaving");
      }
      refreshExtra(id);
    },
    rmPhoto(id, i) {
      const arr = S.photos[id] && S.photos[id][PHOTO_SLOT];
      if (arr) arr.splice(i, 1);
      refreshExtra(id);
    },
    runSearch() {
      const inp = document.getElementById(`${NS}-q`);
      S.query = inp ? inp.value.trim() : "";
      if (!S.query) return handlers.home();
      S.view = "search";
      S.openVoter = null;
      render();
    },
    async save(id) {
      const msg = document.getElementById(`${NS}-msg-${id}`);
      const sel = document.querySelector(`input[name="${NS}-out-${id}"]:checked`);
      if (!sel) {
        if (msg) msg.textContent = t("wlPickOutcome");
        return;
      }
      const g = (sfx) => {
        const e = document.getElementById(`${NS}-${sfx}-${id}`);
        return e ? e.value.trim() : "";
      };
      const notes = g("notes");
      if (sel.value === OTHER_OUTCOME && !notes) {
        if (msg) msg.textContent = t("wlNeedRemark");
        return;
      }
      const payload = {
        re_outcome: sel.value,
        sir_form: g("sir"),
        voted_2025: g("voted"),
        moved_here_recently: g("moved"),
        contact_phone: g("phone"),
        jan_sunwai: g("jan"),
        re_notes: notes,
        re_photos: S.photos[id] || {},
      };
      try {
        await api.queueListStatus(CFG.opType, id, payload);
        delete S.photos[id];
        delete S.vCache[id];
        S.openVoter = null;
        toast(t("wlSaved"));
        if (api.state.online) await api.syncNow();
        render();
      } catch (e) {
        if (msg) msg.textContent = (e && e.detail && e.detail.detail) || (e && e.message) || t("wlErrSaving");
      }
    },
  };

  window[G] = handlers;
  return init;
}
