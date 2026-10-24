// Auth-free API wrapper (Cloudflare Access handles identity), online/offline
// decisions, and the outbox sync loop. Every mutation goes through queueOp(),
// which writes to IndexedDB first and syncs later — offline is the normal
// case in the field, not an edge case. Ported and scoped down from the
// developer's api.js.
import {
  store,
  searchOffline,
  listSearchOffline,
  listTilesOffline,
  listTilePartHousesOffline,
  searchAllOffline,
  voterStatusOffline,
} from "./store.js";

const API = "/api";

export const state = {
  online: navigator.onLine,
  syncing: false,
  pending: 0,
  rollCount: 0,
};

const listeners = [];
export function onStateChange(fn) {
  listeners.push(fn);
}
function emit() {
  for (const fn of listeners) fn(state);
}

// app.js sets this to false when the visitor is not signed in and we're
// showing the public progress view. Every /api/* call is answered with a
// Cloudflare Access redirect for them, so the sync loop and the staff
// WebSocket would just retry forever against a door that will not open.
let staffMode = true;
export function setStaffMode(on) {
  staffMode = !!on;
}

window.addEventListener("online", () => {
  state.online = true;
  emit();
  if (!staffMode) return;
  syncNow();
  connectLive();
});
window.addEventListener("offline", () => {
  state.online = false;
  emit();
});

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new ApiError("Network request failed", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  if (!res.ok) {
    throw new ApiError((data && data.detail) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export async function whoami() {
  return request("/whoami");
}

// email -> display name, for every account that has answered the name
// prompt. Refetched at boot and whenever the Team tab loads.
export async function directory() {
  return request("/directory");
}

// The name-capture prompt's only call. See requestNameIfMissing() in app.js.
export async function setMyName(name) {
  return request("/me", { method: "PATCH", body: { name } });
}

export async function config() {
  return request("/config");
}

export async function updateDetails(id, payload) {
  return request(`/elector/${id}/details`, { method: "PATCH", body: payload });
}

export async function resetRecord(id) {
  return request(`/elector/${id}/reset`, { method: "POST" });
}

export async function resetPreview() {
  return request("/admin/reset-preview");
}

// Deliberately not queued through the outbox like every other mutation. This
// must never replay from a device that has been offline since before a reset —
// it would wipe the work done in between.
export async function resetAll(confirm) {
  return request("/admin/reset-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
}

export async function dashboard() {
  return request("/dashboard");
}

export async function parts() {
  return request("/parts");
}

export async function mySummary() {
  return request("/me/summary");
}

export async function dailyReport(date) {
  return request(date ? `/reports/daily?date=${encodeURIComponent(date)}` : "/reports/daily");
}

export async function houseLookup(base) {
  return request(`/house/${encodeURIComponent(base)}`);
}

export async function records(kind, part, user, date) {
  const params = new URLSearchParams({ kind });
  if (part) params.set("part", part);
  if (user) params.set("user", user);
  if (date) params.set("date", date);
  // The server defaults to 100 rows per page (500 max) if not told
  // otherwise — every drill-down list here was silently truncated to the
  // first 100 by house order, with only the "Showing: (N)" count staying
  // accurate (a true COUNT(*), separate from the capped row fetch). 500
  // covers every current drill-down kind with room to spare (largest today
  // is Corrections at ~400); the response's own `total` still says plainly
  // if a list somehow outgrows that, since `records.length` alone wouldn't.
  params.set("limit", "500");
  return request(`/records?${params.toString()}`);
}

/* ---------------------------------------------------------------- search */

export async function search(q) {
  if (state.online) {
    try {
      return await request(`/search?q=${encodeURIComponent(q)}`);
    } catch (err) {
      if (err.status !== 0) throw err;
      // Network genuinely unreachable despite navigator.onLine — fall through.
    }
  }
  return searchOffline(q);
}

/* -------------------------------------------------------- roll cache sync */

export async function refreshRoll() {
  if (!state.online) return { skipped: true };
  const data = await request("/roll/snapshot");
  await store.putRecords(data.records);
  await store.meta("last_snapshot", data.server_time);
  state.rollCount = await store.countRecords();
  emit();
  return { count: data.records.length };
}

/* ---------------------------------- reverification lists (asddo / draftsir) */
// One set of helpers, parameterised by URL prefix ("asddo" | "draftsir") and
// the matching IndexedDB store name. See src/worklist.ts on the server.

export async function listSearch(prefix, storeName, q) {
  if (state.online) {
    try {
      return await request(`/${prefix}/search?q=${encodeURIComponent(q)}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return listSearchOffline(storeName, q);
}

export async function listTiles(prefix, storeName, tileDefs, hasSegments) {
  if (state.online) {
    try {
      return await request(`/${prefix}/tiles`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return listTilesOffline(storeName, tileDefs, hasSegments);
}

export async function listTile(prefix, storeName, tile, segment) {
  const seg = segment || "confirmed";
  if (state.online) {
    try {
      return await request(`/${prefix}/tile/${tile}?segment=${seg}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return listTilePartHousesOffline(storeName, tile, seg);
}

export async function listGet(prefix, storeName, id) {
  if (state.online) {
    try {
      return await request(`/${prefix}/${id}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return store.getListRecord(storeName, id);
}

export async function listHistory(prefix, id) {
  return request(`/${prefix}/${id}/history`);
}

export async function refreshList(prefix, storeName) {
  if (!state.online) return { skipped: true };
  const data = await request(`/${prefix}/snapshot`);
  await store.putListRecords(storeName, data.records);
  await store.meta(`last_${storeName}_snapshot`, data.server_time);
  emit();
  return { count: data.records.length };
}

// A reverification write. Queued through the same outbox as base-roll edits.
// opType is "asddo_status" | "draftsir_status".
export async function queueListStatus(opType, id, payload) {
  return queueOp({ type: opType, list_id: id, payload });
}

/* --------------------------------------------------------- SEARCH tab */
// The cross-list merge (base roll + Draft SIR + ASDD) and its Public Hearing
// case tracking — works offline the same way every other tab does.

export async function searchAll(q) {
  if (state.online) {
    try {
      return await request(`/search-all?q=${encodeURIComponent(q)}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return searchAllOffline(q);
}

// Government marking/status for a set of voter_keys (PH FOLLOW UP's "PH
// Status" tag). keys is an array; returns { [key]: {kind, reason} }.
export async function voterStatus(keys) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (!uniq.length) return {};
  if (state.online) {
    try {
      const data = await request(`/voter-status?keys=${encodeURIComponent(uniq.join(","))}`);
      return data.status || {};
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return voterStatusOffline(uniq);
}

export async function refreshPhRemarks() {
  if (!state.online) return { skipped: true };
  const data = await request("/ph-remarks-snapshot");
  await store.putPhRemarks(data.records);
  emit();
  return { count: data.records.length };
}

// Stage 1 (case type) and stage 2 (follow-up) each queue through the same
// outbox as everything else. They're keyed by voter_key, not a numeric id —
// stage 2 always finds its case by that key, whether or not stage 1 has
// synced yet (see drain()'s client_time ordering).
export async function queuePhStage1(voterKey, payload) {
  return queueOp({ type: "ph_stage1", voter_key: voterKey, payload });
}
export async function queuePhStage2(voterKey, payload) {
  return queueOp({ type: "ph_stage2", voter_key: voterKey, payload });
}

// The freshest known state of one case — used right after a save to pick up
// what the server actually persisted (in particular the Case ID a brand-new
// case is assigned on sync, which the optimistic local record doesn't have).
export async function getPhRemark(voterKey) {
  if (state.online) {
    try {
      return await request(`/ph-remarks/${encodeURIComponent(voterKey)}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return store.getPhRemark(voterKey);
}

/* ---------------------------------------------------------- PH FOLLOW UP */
// A separate cache/table from ph_remarks (see migration_016) — same
// voter_key convention, works offline the same way.

export async function refreshPhFollowup() {
  if (!state.online) return { skipped: true };
  const data = await request("/ph-followup-snapshot");
  await store.putPhFollowups(data.records);
  emit();
  return { count: data.records.length };
}

export async function queuePhFollowup(voterKey, payload) {
  return queueOp({ type: "ph_followup", voter_key: voterKey, payload });
}

export async function getPhFollowup(voterKey) {
  if (state.online) {
    try {
      return await request(`/ph-followup/${encodeURIComponent(voterKey)}`);
    } catch (err) {
      if (err.status !== 0) throw err;
    }
  }
  return store.getPhFollowup(voterKey);
}


/* -------------------------------------------------------------- mutations */

function newOpId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "op-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

async function applyLocally(op) {
  if (op.type === "status") {
    const record = await store.getRecord(op.elector_id);
    if (!record) return null;
    const p = op.payload;
    // correction_type/deletion_type only mean anything for their matching
    // sub_category — cleared otherwise, mirroring updateStatus() in
    // records.ts exactly, so a card doesn't show a stale type badge from
    // before the outcome changed while offline or before the next re-fetch.
    const correctionType = p.sub_category === "Correction needed" ? (p.correction_type || "").trim() || null : null;
    const deletionType = p.sub_category === "Deletion" ? (p.deletion_type || "").trim() || null : null;
    Object.assign(record, {
      verification_status: p.verification_status || record.verification_status,
      sub_category: p.sub_category ?? null,
      form8_given: p.form8_given ?? null,
      notes: p.notes ?? null,
      death_cert_collected: p.death_cert_collected ?? record.death_cert_collected,
      correction_type: correctionType,
      deletion_type: deletionType,
      contact_phone: (p.contact_phone || "").trim() || record.contact_phone,
      verified_by: op.user_email,
      verified_at: op.client_time,
      locked_at: record.locked_at || op.client_time,
      locked_by_email: record.locked_by_email || op.user_email,
      pending_sync: true,
    });
    await store.putRecord(record);
    return record;
  }
  if (op.type === "addition") {
    const record = Object.assign(
      {
        id: op.local_id,
        added_in_field: 1,
        verification_status: "Found",
        sub_category: "Added in field",
        source_flag: "Added in field",
        epic_id: null,
        sr_no: null,
        verified_by: op.user_email,
        verified_at: op.client_time,
        pending_sync: true,
        local_only: true,
      },
      op.payload
    );
    await store.putRecord(record);
    return record;
  }
  if (op.type === "revisit") {
    const revisit = Object.assign(
      {
        id: op.local_id,
        user_email: op.user_email,
        created_at: op.client_time,
        resolved_at: null,
        pending_sync: true,
      },
      op.payload
    );
    await store.putRevisit(revisit);
    return revisit;
  }
  if (op.type === "asddo_status" || op.type === "draftsir_status") {
    const storeName = op.type === "asddo_status" ? "asddo" : "draftsir";
    const record = await store.getListRecord(storeName, op.list_id);
    if (!record) return null;
    const p = op.payload;
    const present = [
      "Alive",
      "Present at the address",
      "No Duplicity Found",
      "Found",
      "Found and present at the address",
    ].includes((p.re_outcome || "").trim());
    Object.assign(record, {
      re_status: "Done",
      re_outcome: (p.re_outcome || "").trim() || null,
      sir_form: present ? (p.sir_form || "").trim() || null : null,
      voted_2025: present ? (p.voted_2025 || "").trim() || null : null,
      moved_here_recently: present ? (p.moved_here_recently || "").trim() || null : null,
      contact_phone: present ? (p.contact_phone || "").trim() || record.contact_phone : record.contact_phone,
      jan_sunwai: present ? (p.jan_sunwai || "").trim() || null : null,
      // keep the staged photo map (data URLs + kept keys) so thumbnails render
      // before the op syncs; the server replaces this with real keys on drain.
      re_photos:
        p.re_photos && typeof p.re_photos === "object" && Object.keys(p.re_photos).length
          ? JSON.stringify(p.re_photos)
          : null,
      re_photo_key: null,
      re_notes: p.re_notes ?? record.re_notes ?? null,
      re_verified_by: op.user_email,
      re_verified_at: op.client_time,
      pending_sync: true,
    });
    await store.putListRecord(storeName, record);
    return record;
  }
  if (op.type === "ph_stage1") {
    const p = op.payload;
    const existing = (await store.getPhRemark(op.voter_key)) || {
      voter_key: op.voter_key,
      created_at: op.client_time,
      case_id: null, // assigned by the server on first sync — "pending" until then
    };
    const isNoSir = p.case_type === "No SIR";
    const isCorrection = p.case_type === "SIR Correction Request";
    const isTestimony = p.participation_type === "Testimony";
    const isSupport = p.participation_type === "Support / Assistance";
    const isOther = p.participation_type === "Other";
    Object.assign(existing, {
      name: p.name ?? existing.name,
      house_number_raw: p.house_number_raw ?? existing.house_number_raw,
      part_number: p.part_number ?? existing.part_number,
      epic_id: p.epic_id ?? existing.epic_id,
      case_type: p.case_type,
      sir_submitted: isNoSir ? p.sir_submitted || null : null,
      sir_submit_mode: isNoSir && p.sir_submitted === "Yes" ? p.sir_submit_mode || null : null,
      sir_has_receipt: isNoSir && p.sir_submitted === "Yes" ? p.sir_has_receipt || null : null,
      correction_fields: isCorrection && (p.correction_fields || []).length ? JSON.stringify(p.correction_fields) : null,
      correction_other:
        isCorrection && (p.correction_fields || []).includes("Other") ? (p.correction_other || "").trim() || null : null,
      participation_type: p.participation_type || null,
      phone: (p.phone || "").trim() || null,
      // Branch-specific fields keep their existing value when the branch
      // being saved isn't theirs — same rule as the server (records.ts) —
      // so switching branches never wipes a Testimony follow-up's remarks.
      root_cause: isTestimony ? (p.root_cause || "").trim() || null : existing.root_cause ?? null,
      support_type: isSupport ? p.support_type || null : existing.support_type ?? null,
      // knows_blo is shared with the Testimony follow-up (stage 2, applied
      // below) — only Support / Assistance writes it here, since that branch
      // has no stage 2 of its own to ask it in.
      knows_blo: isSupport ? (["Yes", "No"].includes(p.knows_blo) ? p.knows_blo : null) : existing.knows_blo ?? null,
      remarks: isOther ? (p.remarks || "").trim() || null : existing.remarks ?? null,
      stage1_by: op.user_email,
      stage1_at: op.client_time,
      updated_at: op.client_time,
      pending_sync: true,
    });
    await store.putPhRemark(existing);
    return existing;
  }
  if (op.type === "ph_stage2") {
    const existing = await store.getPhRemark(op.voter_key);
    if (!existing) return null;
    const p = op.payload;
    const knowsBlo = ["Yes", "No"].includes(p.knows_blo) ? p.knows_blo : null;
    Object.assign(existing, {
      knows_blo: knowsBlo,
      brought_to_blo: knowsBlo === "Yes" && ["Yes", "No"].includes(p.brought_to_blo) ? p.brought_to_blo : null,
      remarks: (p.remarks || "").trim() || null,
      // A new capture travels as a data: URL and renders as-is until synced,
      // same as every other offline photo field (worklist-tab.js); an
      // untouched or removed photo is passed straight through by the caller.
      photo_key: typeof p.photo === "string" ? p.photo || null : existing.photo_key ?? null,
      stage2_by: op.user_email,
      stage2_at: op.client_time,
      updated_at: op.client_time,
      pending_sync: true,
    });
    await store.putPhRemark(existing);
    return existing;
  }
  if (op.type === "ph_followup") {
    const p = op.payload;
    const existing = (await store.getPhFollowup(op.voter_key)) || {
      voter_key: op.voter_key,
      created_at: op.client_time,
    };
    const form6Submitted = ["Yes", "No"].includes(p.form6_submitted) ? p.form6_submitted : null;
    Object.assign(existing, {
      name: p.name ?? existing.name,
      house_number_raw: p.house_number_raw ?? existing.house_number_raw,
      part_number: p.part_number ?? existing.part_number,
      epic_id: p.epic_id ?? existing.epic_id,
      blo_contacted: ["Yes", "No"].includes(p.blo_contacted) ? p.blo_contacted : null,
      form6_submitted: form6Submitted,
      // Question 3 only applies when Form 6 has NOT been submitted — mirrors
      // the server (src/ph_followup.ts) so an optimistic local record never
      // shows a stale "needs assistance" answer on a case that just closed.
      form6_assistance: form6Submitted === "No" && ["Yes", "No"].includes(p.form6_assistance) ? p.form6_assistance : null,
      notice_received: ["Yes", "No"].includes(p.notice_received) ? p.notice_received : null,
      notes: (p.notes || "").trim() || null,
      updated_by: op.user_email,
      updated_at: op.client_time,
      pending_sync: true,
    });
    await store.putPhFollowup(existing);
    return existing;
  }
  return null;
}

export async function queueOp(op) {
  const full = Object.assign(
    {
      op_id: newOpId(),
      client_time: new Date().toISOString(),
      // Must match exactly what app.js compares against for "is this my own
      // pending edit" (isLockedForMe) — no placeholder fallback here, or a
      // submitter's own queued edit can appear locked to them.
      user_email: window.currentUserEmail ?? null,
    },
    op
  );
  if ((full.type === "addition" || full.type === "revisit") && !full.local_id) {
    // Negative ids can never collide with a server-assigned row id.
    full.local_id = -Date.now();
  }
  try {
    const record = await applyLocally(full);
    await store.queue(full);
    state.pending = await store.pendingCount();
    emit();
    syncNow();
    return { op: full, record };
  } catch (err) {
    console.warn("Offline storage unavailable, sending directly:", err && err.message);
    if (!state.online) {
      throw new ApiError(
        "This device's offline storage is not working and you are offline, so this cannot be saved.",
        0
      );
    }
    const record = await sendDirect(full);
    return { op: full, record };
  }
}

async function sendDirect(op) {
  if (op.type === "status") {
    return request(`/elector/${op.elector_id}/status`, {
      method: "POST",
      body: Object.assign({}, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  if (op.type === "addition") {
    return request("/elector", {
      method: "POST",
      body: Object.assign({}, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  if (op.type === "asddo_status" || op.type === "draftsir_status") {
    const prefix = op.type === "asddo_status" ? "asddo" : "draftsir";
    return request(`/${prefix}/${op.list_id}/status`, {
      method: "POST",
      body: Object.assign({}, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  if (op.type === "ph_stage1") {
    return request("/ph-remarks", {
      method: "POST",
      body: Object.assign({ voter_key: op.voter_key }, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  if (op.type === "ph_stage2") {
    return request(`/ph-remarks/${encodeURIComponent(op.voter_key)}`, {
      method: "PATCH",
      body: Object.assign({}, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  if (op.type === "ph_followup") {
    return request(`/ph-followup/${encodeURIComponent(op.voter_key)}`, {
      method: "POST",
      body: Object.assign({}, op.payload, { op_id: op.op_id, client_time: op.client_time }),
    });
  }
  throw new ApiError("Unknown operation", 400);
}

let syncPromise = null;

export function syncNow() {
  if (!state.online || syncPromise) return syncPromise || Promise.resolve();
  syncPromise = drain().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function drain() {
  const ops = await store.pending();
  if (!ops.length) {
    state.pending = await store.pendingCount();
    emit();
    return;
  }
  state.syncing = true;
  emit();
  try {
    // Oldest first. The outbox key is a random op_id, not insertion order, and
    // a Public Hearing case's stage-2 follow-up can only be queued after its
    // stage-1 create — /api/sync applies a batch in the order it's given, so
    // this ordering is what makes "stage 2 finds its case" reliable when both
    // were queued fully offline in the same session.
    const orderedOps = [...ops].sort((a, b) => (a.client_time || "").localeCompare(b.client_time || ""));
    const batch = orderedOps.map((o) => ({
      op_id: o.op_id,
      type: o.type,
      elector_id: o.elector_id,
      list_id: o.list_id,
      voter_key: o.voter_key,
      client_time: o.client_time,
      payload: o.payload,
    }));
    const out = await request("/sync", { method: "POST", body: { ops: batch } });

    for (const result of out.results) {
      const original = ops.find((o) => o.op_id === result.op_id);
      if (result.status === "applied" || result.status === "duplicate") {
        await store.dequeue(result.op_id);
        if (result.list_record && original) {
          const storeName = original.type === "asddo_status" ? "asddo" : "draftsir";
          await store.putListRecord(storeName, Object.assign({}, result.list_record, { pending_sync: false }));
        }
        if (result.record) {
          if (original && original.type === "addition" && original.local_id) {
            // A queued addition had a temporary negative id; drop it now that
            // the server has assigned a real one.
            await store.putRecord(Object.assign({}, result.record, { pending_sync: false, local_only: false }));
          } else {
            await store.putRecord(Object.assign({}, result.record, { pending_sync: false }));
          }
        }
        if (result.revisit) {
          if (original && original.type === "revisit" && original.local_id) {
            await store.deleteRevisit(original.local_id);
          }
          await store.putRevisit(Object.assign({}, result.revisit, { pending_sync: false }));
        }
        if (result.ph_remark) {
          // Replaces the optimistic local row wholesale — this is also how a
          // stage-1 case picks up its server-assigned Case ID once it syncs.
          await store.putPhRemark(Object.assign({}, result.ph_remark, { pending_sync: false }));
        }
      } else {
        // Server rejected the op (e.g. now locked by someone else). Leave it
        // queued with a note; a person needs to look at it.
        await store.queue(Object.assign({}, original, { failed: true, failReason: result.detail }));
      }
    }
  } catch (err) {
    console.warn("Sync failed, will retry:", err && err.message);
  } finally {
    state.pending = await store.pendingCount();
    state.syncing = false;
    emit();
  }
}

/* ------------------------------------------------------------------ team */

export async function listStaff() {
  return request("/admin/users");
}

export async function setAdmin(email, isAdmin) {
  return request(`/admin/users/${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: { is_admin: isAdmin },
  });
}

export async function reportDays() {
  return request("/reports/days");
}

/* -------------------------------------------------------------- live updates */

let socket = null;
let liveListeners = [];
export function onLiveUpdate(fn) {
  liveListeners.push(fn);
}

export function connectLive() {
  if (socket || !state.online || !staffMode) return;
  try {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${location.host}/api/events`);
    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        liveListeners.forEach((fn) => fn(msg));
      } catch (err) {}
    };
    socket.onclose = () => {
      socket = null;
      // Reconnect later rather than looping tightly if the network is down.
      setTimeout(() => state.online && connectLive(), 5000);
    };
    socket.onerror = () => socket && socket.close();
  } catch (err) {
    socket = null;
  }
}
