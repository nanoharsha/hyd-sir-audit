// Offline storage: a local cache of the roll for searching with no signal,
// plus an outbox of queued writes to replay once back online. Ported and
// scoped down from the developer's store.js.
//
// IMPORTANT: the tokenizer/search logic here must stay in sync with
// src/house.ts and src/records.ts on the server. Change them together, or
// house search will disagree with itself when a phone loses signal.

const DB_NAME = "sirAuditOffline";
const DB_VERSION = 6;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "op_id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("revisits")) db.createObjectStore("revisits", { keyPath: "id" });
      // v3: ASDD List reverification cache.  v4: Draft SIR 2026 reverification cache.
      if (!db.objectStoreNames.contains("asddo")) db.createObjectStore("asddo", { keyPath: "id" });
      if (!db.objectStoreNames.contains("draftsir")) db.createObjectStore("draftsir", { keyPath: "id" });
      // v5: SEARCH tab's Public Hearing Remarks cache, keyed by the same
      // voter_key the SEARCH merge uses (epic_norm, or "elector:<id>").
      if (!db.objectStoreNames.contains("phRemarks")) db.createObjectStore("phRemarks", { keyPath: "voter_key" });
      // v6: PH FOLLOW UP tab's cache — same voter_key convention, separate
      // table server-side (migration_016), so a case and its follow-up note
      // are two rows sharing one key rather than one row with more columns.
      if (!db.objectStoreNames.contains("phFollowup")) db.createObjectStore("phFollowup", { keyPath: "voter_key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const s = t.objectStore(storeName);
        const result = fn(s);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
      })
  );
}

function reqValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const store = {
  async putRecords(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("records", "readwrite");
      const s = t.objectStore("records");
      for (const r of records) s.put(r);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async putRecord(record) {
    return tx("records", "readwrite", (s) => s.put(record));
  },
  async getRecord(id) {
    const db = await openDB();
    const t = db.transaction("records", "readonly");
    return reqValue(t.objectStore("records").get(id));
  },
  async allRecords() {
    const db = await openDB();
    const t = db.transaction("records", "readonly");
    return (await reqValue(t.objectStore("records").getAll())) || [];
  },
  async countRecords() {
    const db = await openDB();
    const t = db.transaction("records", "readonly");
    return reqValue(t.objectStore("records").count());
  },
  async queue(op) {
    return tx("outbox", "readwrite", (s) => s.put(op));
  },
  async dequeue(opId) {
    return tx("outbox", "readwrite", (s) => s.delete(opId));
  },
  async pending() {
    const db = await openDB();
    const t = db.transaction("outbox", "readonly");
    return (await reqValue(t.objectStore("outbox").getAll())) || [];
  },
  async pendingCount() {
    const db = await openDB();
    const t = db.transaction("outbox", "readonly");
    return reqValue(t.objectStore("outbox").count());
  },
  async meta(key, value) {
    const db = await openDB();
    if (value === undefined) {
      const t = db.transaction("meta", "readonly");
      const row = await reqValue(t.objectStore("meta").get(key));
      return row ? row.value : null;
    }
    return tx("meta", "readwrite", (s) => s.put({ key, value }));
  },
  async putRevisit(revisit) {
    return tx("revisits", "readwrite", (s) => s.put(revisit));
  },
  async deleteRevisit(id) {
    return tx("revisits", "readwrite", (s) => s.delete(id));
  },
  async allRevisits() {
    const db = await openDB();
    const t = db.transaction("revisits", "readonly");
    return (await reqValue(t.objectStore("revisits").getAll())) || [];
  },

  // -- reverification-list caches (store name: "asddo" | "draftsir") --
  async putListRecords(name, records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, "readwrite");
      const s = t.objectStore(name);
      for (const r of records) s.put(r);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async putListRecord(name, record) {
    return tx(name, "readwrite", (s) => s.put(record));
  },
  async getListRecord(name, id) {
    const db = await openDB();
    return reqValue(db.transaction(name, "readonly").objectStore(name).get(id));
  },
  async allListRecords(name) {
    const db = await openDB();
    return (await reqValue(db.transaction(name, "readonly").objectStore(name).getAll())) || [];
  },
  async countListRecords(name) {
    const db = await openDB();
    return reqValue(db.transaction(name, "readonly").objectStore(name).count());
  },

  // -- Public Hearing Remarks cache (SEARCH tab) --
  async putPhRemark(record) {
    return tx("phRemarks", "readwrite", (s) => s.put(record));
  },
  async putPhRemarks(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("phRemarks", "readwrite");
      const s = t.objectStore("phRemarks");
      for (const r of records) s.put(r);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async getPhRemark(voterKey) {
    const db = await openDB();
    return (await reqValue(db.transaction("phRemarks", "readonly").objectStore("phRemarks").get(voterKey))) || null;
  },
  async allPhRemarks() {
    const db = await openDB();
    return (await reqValue(db.transaction("phRemarks", "readonly").objectStore("phRemarks").getAll())) || [];
  },

  // -- PH FOLLOW UP cache --
  async putPhFollowup(record) {
    return tx("phFollowup", "readwrite", (s) => s.put(record));
  },
  async putPhFollowups(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction("phFollowup", "readwrite");
      const s = t.objectStore("phFollowup");
      for (const r of records) s.put(r);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async getPhFollowup(voterKey) {
    const db = await openDB();
    return (await reqValue(db.transaction("phFollowup", "readonly").objectStore("phFollowup").get(voterKey))) || null;
  },
  async allPhFollowups() {
    const db = await openDB();
    return (await reqValue(db.transaction("phFollowup", "readonly").objectStore("phFollowup").getAll())) || [];
  },
};

// -------------------------------------------------------- offline search --

const FLOOR_MAP = [
  [/\bground\s*floor\b|\bg\s*\/\s*f\b/i, "Ground"],
  [/\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*f\b|\b1st\s*fl\b/i, "First"],
  [/\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*\/\s*f\b|\bsf\b|\b2nd\s*fl\b/i, "Second"],
  [/\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*f\b|\b3rd\s*fl\b/i, "Third"],
  [/\b4\s*th\s*floor\b|\b(fourth|forth)\s*flo?o?r?\b/i, "Fourth"],
];

export function tokenizeQuery(raw) {
  let stripped = (raw || "").trim();
  for (const [pattern] of FLOOR_MAP) stripped = stripped.replace(pattern, "");
  stripped = stripped.replace(/^[\s,-]+|[\s,-]+$/g, "");

  const range = stripped.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return range[1].toUpperCase();

  const num = stripped.match(/^([A-Za-z]?[\d/]+[A-Za-z]?)/);
  return (num ? num[1] : stripped).trim().toUpperCase();
}

const EPIC_RE = /^[A-Za-z]{3}\d+$/;

function sortRecords(a, b) {
  const an = a.house_base_num === null || a.house_base_num === undefined ? Infinity : a.house_base_num;
  const bn = b.house_base_num === null || b.house_base_num === undefined ? Infinity : b.house_base_num;
  if (an !== bn) return an - bn;
  if ((a.house_base || "") !== (b.house_base || "")) return (a.house_base || "").localeCompare(b.house_base || "");
  return (parseInt(a.sr_no, 10) || 0) - (parseInt(b.sr_no, 10) || 0);
}

export async function searchOffline(q) {
  const query = (q || "").trim();
  if (!query) return { results: [], match_type: "empty", query_base: null, offline: true };

  const all = await store.allRecords();

  if (EPIC_RE.test(query)) {
    const upper = query.toUpperCase();
    return {
      results: all.filter((r) => (r.epic_id || "").toUpperCase() === upper).sort(sortRecords),
      match_type: "epic",
      query_base: upper,
      offline: true,
    };
  }

  if (!/\d/.test(query)) {
    const needle = query.toUpperCase();
    const byName = all
      .filter((r) => (r.name || "").toUpperCase().includes(needle))
      .sort((a, b) => {
        const rank = (n) => {
          const up = (n || "").toUpperCase();
          return up === needle ? 0 : up.startsWith(needle) ? 1 : 2;
        };
        return rank(a.name) - rank(b.name) || (a.name || "").localeCompare(b.name || "");
      });
    if (byName.length) return { results: byName, match_type: "name", query_base: query, offline: true };
    const byRelation = all
      .filter((r) => (r.relation_name || "").toUpperCase().includes(needle))
      .sort(sortRecords);
    return {
      results: byRelation,
      match_type: byRelation.length ? "relation" : "none",
      query_base: query,
      offline: true,
    };
  }

  const base = tokenizeQuery(query);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;
  const rawUpper = query.toUpperCase().trim();

  let results = all.filter((r) => {
    if ((r.house_base || "") === base) return true;
    if (
      qNum !== null &&
      r.house_range_end_num != null &&
      r.house_base_num != null &&
      r.house_base_num <= qNum &&
      r.house_range_end_num >= qNum
    )
      return true;
    return (r.house_number_raw || "").toUpperCase().trim() === rawUpper;
  });
  let matchType = "house";

  if (!results.length) {
    const needle = query.toUpperCase();
    results = all.filter(
      (r) =>
        (r.house_number_raw || "").toUpperCase().includes(needle) ||
        (r.name || "").toUpperCase().includes(needle)
    );
    matchType = results.length ? "loose" : "none";
  }

  return { results: results.sort(sortRecords), match_type: matchType, query_base: base, offline: true };
}

// Offline search over a cached reverification list — mirrors worklist.search().
export async function listSearchOffline(name, q) {
  const query = (q || "").trim();
  if (!query) return { results: [], match_type: "empty", query_base: null, offline: true };
  const all = await store.allListRecords(name);

  if (EPIC_RE.test(query)) {
    const upper = query.toUpperCase().replace(/\s+/g, "");
    return {
      results: all.filter((r) => (r.epic_norm || "") === upper).sort(sortRecords),
      match_type: "epic",
      query_base: query.toUpperCase(),
      offline: true,
    };
  }

  if (!/\d/.test(query)) {
    const needle = query.toUpperCase();
    const byName = all
      .filter((r) => (r.name || "").toUpperCase().includes(needle))
      .sort((a, b) => {
        const rank = (n) => {
          const up = (n || "").toUpperCase();
          return up === needle ? 0 : up.startsWith(needle) ? 1 : 2;
        };
        return rank(a.name) - rank(b.name) || (a.name || "").localeCompare(b.name || "");
      });
    if (byName.length) return { results: byName, match_type: "name", query_base: query, offline: true };
    const byRel = all.filter((r) => (r.relation_name || "").toUpperCase().includes(needle)).sort(sortRecords);
    return { results: byRel, match_type: byRel.length ? "relation" : "none", query_base: query, offline: true };
  }

  const base = tokenizeQuery(query);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;
  const rawUpper = query.toUpperCase().trim();
  let results = all.filter((r) => {
    if ((r.house_base || "") === base) return true;
    if (
      qNum !== null &&
      r.house_range_end_num != null &&
      r.house_base_num != null &&
      r.house_base_num <= qNum &&
      r.house_range_end_num >= qNum
    )
      return true;
    return (r.house_number_raw || "").toUpperCase().trim() === rawUpper;
  });
  let matchType = "house";
  if (!results.length) {
    const needle = query.toUpperCase();
    results = all.filter(
      (r) =>
        (r.house_number_raw || "").toUpperCase().includes(needle) ||
        (r.name || "").toUpperCase().includes(needle)
    );
    matchType = results.length ? "loose" : "none";
  }
  return { results: results.sort(sortRecords), match_type: matchType, query_base: base, offline: true };
}

// The SEARCH tab's cross-list merge, offline. Mirrors
// src/comprehensive_search.ts's searchAll() field-for-field — change them
// together. Reads the same "records" (electors)/"asddo"/"draftsir" caches
// every other offline view uses, plus "phRemarks" for this tab's own writes.
const ASDD_REASON_LABEL = {
  Death: "Death",
  "Permanently Shifted": "Permanently Shifted",
  "Untraceable/Absent": "Absent / Untraceable",
  "Already enrolled": "Already Enrolled",
};

export async function searchAllOffline(qRaw) {
  const query = (qRaw || "").trim();
  if (!query) return { results: [], match_type: "empty", offline: true };

  if (/^PH-\d+$/i.test(query)) {
    const remarks = await store.allPhRemarks();
    const remark = remarks.find((r) => (r.case_id || "").toUpperCase() === query.toUpperCase());
    if (!remark) return { results: [], match_type: "case_id_none", offline: true };
    const followUp = remark.epic_id || remark.name;
    if (!followUp) return { results: [], match_type: "case_id_none", offline: true };
    const inner = await searchAllOffline(followUp);
    return Object.assign({}, inner, { match_type: "case_id", offline: true });
  }

  const kind = EPIC_RE.test(query) ? "epic" : !/\d/.test(query) ? "name" : "house";
  const base = tokenizeQuery(query);
  const qNum = /^\d+$/.test(base) ? parseInt(base, 10) : null;
  const epicQ = query.toUpperCase().replace(/\s+/g, "");

  const houseOrNameMatch = (r) => {
    if (kind === "name") {
      const needle = query.toUpperCase();
      return (r.name || "").toUpperCase().includes(needle) || (r.relation_name || "").toUpperCase().includes(needle);
    }
    if ((r.house_base || "") === base) return true;
    if (
      qNum !== null &&
      r.house_range_end_num != null &&
      r.house_base_num != null &&
      r.house_base_num <= qNum &&
      r.house_range_end_num >= qNum
    )
      return true;
    if ((r.house_number_raw || "").toUpperCase().trim() === query.toUpperCase().trim()) return true;
    return (r.house_number_raw || "").toUpperCase().includes(query.toUpperCase());
  };

  const [electors, asddoAll, draftAll, remarks] = await Promise.all([
    store.allRecords(),
    store.allListRecords("asddo"),
    store.allListRecords("draftsir"),
    store.allPhRemarks(),
  ]);
  const draftPub = draftAll.filter((r) => r.in_draft === 1);

  const elMatch =
    kind === "epic"
      ? electors.filter((r) => (r.epic_id || "").toUpperCase().replace(/\s+/g, "") === epicQ)
      : electors.filter(houseOrNameMatch);
  const asddoMatch =
    kind === "epic" ? asddoAll.filter((r) => (r.epic_norm || "") === epicQ) : asddoAll.filter(houseOrNameMatch);
  const draftMatch =
    kind === "epic" ? draftPub.filter((r) => (r.epic_norm || "") === epicQ) : draftPub.filter(houseOrNameMatch);

  const keyFor = (epicNorm, fallback) => (epicNorm && epicNorm.trim() ? epicNorm.trim() : fallback);
  const groups = new Map();
  for (const r of elMatch) {
    const k = keyFor((r.epic_id || "").toUpperCase().replace(/\s+/g, ""), `elector:${r.id}`);
    groups.set(k, { key: k, elector: r, asddo: null, draftsir: null });
  }
  for (const r of asddoMatch) {
    const k = keyFor(r.epic_norm, `asddo:${r.id}`);
    const g = groups.get(k) || { key: k, elector: null, asddo: null, draftsir: null };
    g.asddo = r;
    groups.set(k, g);
  }
  for (const r of draftMatch) {
    const k = keyFor(r.epic_norm, `draftsir:${r.id}`);
    const g = groups.get(k) || { key: k, elector: null, asddo: null, draftsir: null };
    g.draftsir = r;
    groups.set(k, g);
  }

  const remarkByKey = new Map(remarks.map((r) => [r.voter_key, r]));

  const shaped = [...groups.values()].map((g) => {
    const e = g.elector, a = g.asddo, d = g.draftsir;
    const name = (e && e.name) || (d && d.name) || (a && a.name);
    const house = (e && e.house_number_raw) || (d && d.house_number_raw) || (a && a.house_number_raw) || null;
    const epic = (e && e.epic_id) || (d && d.epic_id) || (a && a.epic_id) || null;
    const relation =
      (e && e.relation_name && `${e.relation_type || ""} ${e.relation_name}`.trim()) ||
      (d && d.relation_name && `${d.relation_type || ""} ${d.relation_name}`.trim()) ||
      (a && a.relation_name && `${a.relation_type || ""} ${a.relation_name}`.trim()) ||
      null;
    const age = (e && e.age) ?? (d && d.age) ?? (a && a.age) ?? null;
    const gender = (e && e.gender) ?? (d && d.gender) ?? (a && a.gender) ?? null;

    let part, sr, partSource;
    if (e) { part = e.part_number; sr = e.sr_no; partSource = "base"; }
    else if (d) { part = d.new_part; sr = d.old_sr; partSource = "draftsir"; }
    else { part = a.old_part; sr = a.old_sr; partSource = "asddo"; }

    let sirStatusKind, sirStatusDetail = null;
    if (a) { sirStatusKind = "asddo"; sirStatusDetail = ASDD_REASON_LABEL[a.asddo_reason] || a.asddo_reason; }
    else if (d) { sirStatusKind = "sir"; }
    else if (e && e.added_in_field) { sirStatusKind = "field_addition"; }
    else { sirStatusKind = "no_sir"; }

    const baseVerif =
      e && e.verification_status && e.verification_status !== "Not Started"
        ? { status: e.verification_status, sub: e.sub_category, by: e.verified_by, at: e.verified_at, round: "base" }
        : null;
    const reVerif =
      (a && a.re_status === "Done"
        ? { status: a.re_outcome, sub: null, by: a.re_verified_by, at: a.re_verified_at, round: "asddo" }
        : null) ||
      (d && d.re_status === "Done"
        ? { status: d.re_outcome, sub: null, by: d.re_verified_by, at: d.re_verified_at, round: "draftsir" }
        : null);
    let verif;
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
      part_source: partSource,
      sir_status_kind: sirStatusKind,
      sir_status_detail: sirStatusDetail,
      draft_part: d ? d.new_part : null,
      draft_sr: d ? d.old_sr : null,
      asddo_part: a ? a.new_part : null,
      asddo_sr: a ? a.s_no : null,
      verif_status: (verif && verif.status) || null,
      verif_sub: (verif && verif.sub) || null,
      verif_round: (verif && verif.round) || null,
      verif_by: (verif && verif.by) || null,
      verif_at: (verif && verif.at) || null,
      in_base_roll: !!e,
      in_sir: !!d,
      in_asddo: !!a,
      ph_remark: remarkByKey.get(g.key) || null,
    };
  });

  shaped.sort((x, y) => (x.name || "").localeCompare(y.name || ""));
  const capped = shaped.slice(0, 200);
  return {
    results: capped,
    match_type: kind,
    offline: true,
    truncated: shaped.length > capped.length,
  };
}

// Government marking/status for a set of voter_keys, computed from the same
// caches searchAllOffline() reads — mirrors src/comprehensive_search.ts's
// statusForKeys() exactly (same three-list precedence). Used by the PH
// FOLLOW UP tab's "PH Status" tag when there is no signal.
export async function voterStatusOffline(keys) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  const out = {};
  if (!uniq.length) return out;
  const [electors, asddoAll, draftAll] = await Promise.all([
    store.allRecords(),
    store.allListRecords("asddo"),
    store.allListRecords("draftsir"),
  ]);
  const electorByEpic = new Map();
  const electorById = new Map();
  for (const r of electors) {
    const en = (r.epic_id || "").toUpperCase().replace(/\s+/g, "");
    if (en) electorByEpic.set(en, r);
    electorById.set(r.id, r);
  }
  const asddoByEpic = new Map(asddoAll.filter((r) => r.epic_norm).map((r) => [r.epic_norm, r]));
  const draftEpics = new Set(
    draftAll.filter((r) => r.in_draft === 1 && r.epic_norm).map((r) => r.epic_norm)
  );
  for (const k of uniq) {
    const isElectorKey = k.startsWith("elector:");
    const elector = isElectorKey ? electorById.get(parseInt(k.slice("elector:".length), 10)) : electorByEpic.get(k);
    const asddo = !isElectorKey ? asddoByEpic.get(k) : undefined;
    const inDraft = !isElectorKey && draftEpics.has(k);
    if (asddo) out[k] = { kind: "asddo", reason: asddo.asddo_reason || null };
    else if (inDraft) out[k] = { kind: "sir", reason: null };
    else if (elector && elector.added_in_field) out[k] = { kind: "field_addition", reason: null };
    else out[k] = { kind: "no_sir", reason: null };
  }
  return out;
}

// Build tiles + part/house rollup from a cached list, so the worklist works
// with no signal. Mirrors worklist.tiles() / tilePartHouses(). `tileDefs` is
// [{key,label}] from the frontend config; `hasSegments` matches the config.
export async function listTilesOffline(name, tileDefs, hasSegments) {
  const all = await store.allListRecords(name);
  const out = {};
  for (const t of tileDefs)
    out[t.key] = {
      key: t.key, label: t.label,
      confirmed: 0, confirmed_houses: 0, doublecheck: 0, doublecheck_houses: 0, done: 0, total: 0,
    };
  const hset = { confirmed: {}, doublecheck: {} };
  for (const r of all) {
    if (!r.tile || !out[r.tile]) continue;
    const b = out[r.tile];
    const seg = hasSegments && r.segment === "doublecheck" ? "doublecheck" : "confirmed";
    if (seg === "doublecheck") b.doublecheck++;
    else b.confirmed++;
    b.total++;
    if (r.re_status === "Done") b.done++;
    (hset[seg][r.tile] ||= new Set()).add((r.old_part || r.new_part || "") + "|" + (r.house_base || ""));
  }
  for (const t of tileDefs) {
    out[t.key].confirmed_houses = (hset.confirmed[t.key] || new Set()).size;
    out[t.key].doublecheck_houses = (hset.doublecheck[t.key] || new Set()).size;
  }
  return { tiles: tileDefs.map((t) => out[t.key]), offline: true };
}

export async function listTilePartHousesOffline(name, tile, segment = "confirmed") {
  const all = await store.allListRecords(name);
  const rows = all.filter((r) => {
    if (r.tile !== tile) return false;
    if (segment === "all") return true;
    if (segment === "doublecheck") return r.segment === "doublecheck";
    return r.segment === "confirmed" || !r.segment;
  });
  const parts = {};
  for (const r of rows) {
    const pk = r.old_part || r.new_part || "—";
    const p = (parts[pk] ||= {
      old_part: r.old_part || r.new_part || "",
      no_old_part: !r.old_part,
      new_parts: new Set(),
      houses: {},
      voters: 0,
      done: 0,
    });
    if (r.new_part && r.old_part) p.new_parts.add(r.new_part);
    p.voters++;
    if (r.re_status === "Done") p.done++;
    const hk = r.house_number_raw || "(no house recorded)";
    const h = (p.houses[hk] ||= { house: hk, house_base: r.house_base, voters: [], done: 0 });
    h.voters.push(r);
    if (r.re_status === "Done") h.done++;
  }
  return {
    tile,
    segment,
    offline: true,
    parts: Object.values(parts)
      .map((p) => ({
        old_part: p.old_part,
        no_old_part: p.no_old_part,
        new_part: [...p.new_parts].sort().join(" / "),
        houses: Object.values(p.houses).sort((a, b) =>
          (a.house_base || "").localeCompare(b.house_base || "", undefined, { numeric: true })
        ),
        house_count: Object.keys(p.houses).length,
        voters: p.voters,
        done: p.done,
      }))
      .sort((a, b) => (Number(a.old_part) || 999) - (Number(b.old_part) || 999)),
  };
}
