/* Okhla offline copy.
   The electors of the audit parts (old parts 59-69, ~17,000 people) and every saved visit are kept in this phone's
   IndexedDB, so the Okhla tab can search and open visit forms with no signal. A visit typed offline waits in the
   retry queue in okhla-tab.js and is sent by itself when the phone is back online.

   offlineSearch() mirrors okhlaSearch() in src/okhla.ts (browse / EPIC / house / name, same ordering, same grouping).
   Change one, change the other. Not covered offline: EPIC lookup of electors outside parts 59-69. */
import * as api from "./api.js";
import { houseNorm } from "./okhla-house.js";

const DB_NAME = "okhlaOffline";
const AUDIT_MIN = 59;
const AUDIT_MAX = 69;
const PAGE_SIZE = 25;
const NAME_LIMIT = 80;
const EPIC_PATTERN = /^[A-Za-z]{3}\d+$/;
const FORM_FOR_STATUS = { ASDD: "asdd", NOTICE: "notice", DELETED: "deleted" };
const normEpic = (e) => (e || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("electors")) db.createObjectStore("electors", { keyPath: "id" });
      if (!db.objectStoreNames.contains("visits")) db.createObjectStore("visits", { keyPath: "voter_key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const done = (t) =>
  new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
const val = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function getMeta(key) {
  try {
    const db = await openDB();
    const row = await val(db.transaction("meta").objectStore("meta").get(key));
    return row ? row.value : null;
  } catch (e) {
    return null;
  }
}
async function setMeta(key, value) {
  const db = await openDB();
  const t = db.transaction("meta", "readwrite");
  t.objectStore("meta").put({ key, value });
  return done(t);
}

/* ---- in-memory index, built once from IndexedDB and rebuilt after a sync ---- */
let MEM = null; // { rows, byHouse: Map, visits: Map, order: Map }
async function load() {
  if (MEM) return MEM;
  const db = await openDB();
  const rows = (await val(db.transaction("electors").objectStore("electors").getAll())) || [];
  const visits = new Map();
  for (const v of (await val(db.transaction("visits").objectStore("visits").getAll())) || []) visits.set(v.voter_key, v);
  const byHouse = new Map();
  for (const r of rows) {
    if (!byHouse.has(r.hh_key)) byHouse.set(r.hh_key, []);
    byHouse.get(r.hh_key).push(r);
  }
  const secOf = (r) => (r.section_no === "" || r.section_no == null ? 9999 : parseInt(r.section_no, 10) || 0);
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  for (const m of byHouse.values())
    m.sort(
      (a, b) =>
        a.old_part - b.old_part || secOf(a) - secOf(b) || cmpStr(a.hh_sort || "", b.hh_sort || "") ||
        cmpStr(a.house_floor || "", b.house_floor || "") || (a.serial_2025 || 0) - (b.serial_2025 || 0)
    );
  // a household's place in the list: (part, section, smallest hh_sort of its electors)
  const order = new Map();
  for (const [k, m] of byHouse) {
    let n = m[0].hh_sort || "";
    for (const r of m) if ((r.hh_sort || "") < n) n = r.hh_sort || "";
    order.set(k, { p: m[0].old_part, s: Math.min(...m.map(secOf)), n });
  }
  MEM = { rows, byHouse, visits, order };
  return MEM;
}
const cmpHouse = (M) => (a, b) => {
  const x = M.order.get(a), y = M.order.get(b);
  return x.p - y.p || x.s - y.s || (x.n < y.n ? -1 : x.n > y.n ? 1 : 0);
};

function household(M, k) {
  const members = M.byHouse.get(k).map((r) => ({ ...r }));
  const freq = new Map();
  for (const m of members) {
    const h0 = String(m.house_raw || "").split(",")[0].trim();
    freq.set(h0, (freq.get(h0) || 0) + 1);
  }
  const label = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const m of members) {
    if (!FORM_FOR_STATUS[m.status] || !m.epic_id) continue;
    const v = M.visits.get(normEpic(m.epic_id)) || null;
    m.verification = v && v.form_type === FORM_FOR_STATUS[m.status] ? v : null;
  }
  const f = members[0];
  return { hh_key: k, old_part: f.old_part, section_no: f.section_no, section_name: f.section_name, hh_norm: f.hh_norm, house_label: label, members };
}

export async function offlineSearch(p) {
  const M = await load();
  if (!M.rows.length) return null; // nothing saved on this phone yet
  const q = (p.q || "").trim();
  const status = p.status || null;
  const part = p.part && p.part >= AUDIT_MIN && p.part <= AUDIT_MAX ? p.part : null;
  const block = p.block ? String(p.block).toUpperCase() : null;
  const okRow = (r) => (!part || r.old_part === part) && (!block || r.block === block) && (!status || r.status === status);
  const keysOf = (rows) => [...new Set(rows.map((r) => r.hh_key))];
  const page = Math.max(0, p.page | 0);

  if (!q) {
    if (!part) return { mode: "idle", households: [], total_households: 0, page: 0, page_size: PAGE_SIZE, offline: true };
    const keys = keysOf(M.rows.filter(okRow)).sort(cmpHouse(M));
    const slice = keys.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    return { mode: "browse", households: slice.map((k) => household(M, k)), total_households: keys.length, page, page_size: PAGE_SIZE, offline: true };
  }

  let seed = [];
  let mode = "name";
  let truncated = false;
  const epicQ = q.toUpperCase().replace(/\s+/g, "");
  if (EPIC_PATTERN.test(epicQ)) {
    mode = "epic";
    const pc = (r) => (!part || r.old_part === part) && (!block || r.block === block);
    seed = M.rows.filter((r) => pc(r) && (r.epic_norm === epicQ || r.alt_epic_norm === epicQ)).slice(0, 20);
    if (!seed.length && epicQ.length >= 6) {
      seed = M.rows.filter((r) => pc(r) && (r.epic_norm || "").startsWith(epicQ)).sort((a, b) => (a.epic_norm < b.epic_norm ? -1 : 1)).slice(0, 20);
      if (seed.length) mode = "epic_prefix";
    }
  } else if (/\d/.test(q)) {
    mode = "house";
    const norm = houseNorm(q);
    const lettered = /^[A-Z]/.test(norm);
    const pats = [norm]; // exact, then "<norm>/…" sub-houses
    const pre = [norm];
    if (!lettered) {
      if (block) pre.push(block + norm);
      else pre.push("*" + norm);
    }
    const hit = (hn) => {
      for (const b of pre) {
        if (b[0] === "*" ? new RegExp("^[A-Z]" + b.slice(1).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + "(/.*)?$").test(hn) : hn === b || hn.startsWith(b + "/")) return true;
      }
      return false;
    };
    let rows = M.rows.filter((r) => (!part || r.old_part === part) && (!block || r.block === block) && hit(r.hh_norm || ""));
    if (!rows.length && norm) {
      rows = M.rows.filter((r) => (!part || r.old_part === part) && (!block || r.block === block) && (r.hh_norm || "").startsWith(norm));
      mode = "house_prefix";
    }
    const order = keysOf(rows).sort(cmpHouse(M));
    let households = order.map((k) => household(M, k));
    if (status) households = households.filter((h) => h.members.some((m) => m.status === status));
    if (mode === "house" && households.some((h) => h.hh_norm !== norm)) mode = "house_letter";
    const partsHit = new Set(households.map((h) => h.old_part));
    void pats;
    return { mode, households, truncated: false, total_households: households.length, need_part: !part && !block && partsHit.size > 1, page: 0, page_size: households.length, offline: true };
  } else {
    const words = q.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 2);
    if (!words.length) return { mode: "name", households: [], seed_ids: [], truncated: false, offline: true };
    // a changed record is found by its 2025 name and by the name now on the draft (c_name)
    seed = M.rows.filter((r) => okRow(r) && words.every((w) => ((r.name_upper || String(r.name || "").toUpperCase()) + " " + String(r.c_name || "").toUpperCase()).includes(w)));
    seed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (seed.length > NAME_LIMIT) {
      truncated = true;
      seed = seed.slice(0, NAME_LIMIT);
    }
  }
  const order = keysOf(seed);
  return { mode, households: order.map((k) => household(M, k)), seed_ids: seed.map((r) => r.id), truncated, need_part: false, page: 0, page_size: 25, offline: true };
}

/* ---- keeping the copy up to date ---- */
export async function offlineInfo() {
  const n = (await getMeta("count")) || 0;
  return { electors: n, syncedAt: await getMeta("syncedAt"), visitsAt: await getMeta("visitsAt"), build: await getMeta("build") };
}

// All saved visits (about a thousand rows): cheap, refreshed whenever the phone is online.
export async function syncVisits() {
  const r = await api.request("/okhla/offline/visits");
  const db = await openDB();
  const t = db.transaction("visits", "readwrite");
  const s = t.objectStore("visits");
  s.clear();
  for (const v of r.rows) s.put(v);
  await done(t);
  await setMeta("visitsAt", Date.now());
  MEM = null;
}

// A visit this phone just saved (or got back from the server) shows at once, offline or not.
export async function rememberVisit(v) {
  if (!v || !v.voter_key) return;
  try {
    const db = await openDB();
    const t = db.transaction("visits", "readwrite");
    t.objectStore("visits").put(v);
    await done(t);
    if (MEM) MEM.visits.set(v.voter_key, v);
  } catch (e) {}
}

let syncing = false;
// The electors: all audit parts, one request per part. Only when the roll build changed (or forced / first time).
export async function syncElectors(meta, { force = false, onProgress } = {}) {
  if (syncing) return false;
  const build = (meta && meta.meta && meta.meta.built_at) || "";
  const info = await offlineInfo();
  const stale = !info.electors || !info.syncedAt || info.build !== build || Date.now() - info.syncedAt > 3 * 864e5;
  if (!force && !stale) return false;
  syncing = true;
  try {
    const parts = (meta && meta.parts ? meta.parts.map((x) => x.old_part) : []).sort((a, b) => a - b);
    const list = parts.length ? parts : Array.from({ length: AUDIT_MAX - AUDIT_MIN + 1 }, (_, i) => AUDIT_MIN + i);
    const all = [];
    let i = 0;
    for (const p of list) {
      if (onProgress) onProgress(i++, list.length);
      const r = await api.request("/okhla/offline/pack?part=" + p);
      all.push(...r.rows);
    }
    // replace the copy only when every part arrived, so a dropped connection never leaves half a roll
    const db = await openDB();
    const t = db.transaction("electors", "readwrite");
    const s = t.objectStore("electors");
    s.clear();
    for (const r of all) s.put(r);
    await done(t);
    await setMeta("count", all.length);
    await setMeta("build", build);
    await setMeta("syncedAt", Date.now());
    MEM = null;
    if (onProgress) onProgress(list.length, list.length);
    return true;
  } finally {
    syncing = false;
  }
}
export const isSyncing = () => syncing;

// the part/status/block pickers need /okhla/meta; keep the last good copy
export async function cacheMeta(m) {
  try {
    await setMeta("okmeta", m);
  } catch (e) {}
}
export const cachedMeta = () => getMeta("okmeta");
