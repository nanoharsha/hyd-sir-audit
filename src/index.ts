import { Hono } from "hono";
import { houseFields, tokenizeHouseNumber } from "./house";
import {
  ADDITION_CATEGORIES,
  addElector,
  CORRECTION_TYPES,
  DELETION_TYPES,
  currentUser,
  LockedError,
  ORDER_BY,
  resetRecord,
  resetAllData,
  resetAllPreview,
  RESET_ALL_CONFIRMATION,
  rowsToDict,
  rowToDict,
  search as recordSearch,
  setLock,
  SOURCE_FLAG_TAGS,
  updateDetails,
  updateStatus,
  utcnow,
  YES_NO,
} from "./records";
import { activeDays, dailyActivity, dashboard, mySummary, partProgress } from "./reports";
import { reverifyDashboard, reverifyTile } from "./reverify";
import { searchAll, getRemark, allRemarks, saveStage1, saveStage2, statusForKeys } from "./comprehensive_search";
import { getFollowup, allFollowups, saveFollowup } from "./ph_followup";
import { okhlaMeta, okhlaSearch, okhlaOfflinePack, okhlaOfflineVisits } from "./okhla";
import { saveVerification } from "./okhla_verify";
import { okhlaProgress, okhlaList } from "./okhla_progress";
import { hearingSearch, issueToken, saveExit, hearingDashboard } from "./okhla_hearing";
import { fetchRows, stamp, toCsv, toXlsx, toZipByPart, toDatabaseDump } from "./exports";
import { buildFilter, FILTER_TITLES } from "./filters";
import { addAdmin, listStaff, removeAdmin } from "./team";
// Only createRevisit/resolveRevisit remain imported: they are still called
// from inside /api/sync as a safety net for any offline device that queued
// a revisit op before this feature was removed from the UI (2026-08-18).
// The standalone REST routes and the "flagged for revisit" search banner
// were removed since nothing creates new revisits anymore; the revisits
// table and its existing rows are untouched.
import { createRevisit, resolveRevisit } from "./revisits";
import { fetchPhoto } from "./uploads";
import * as worklist from "./worklist";
import { ASDDO } from "./asddo";
import { DRAFT_SIR } from "./draftsir";
import { directory, getName, setName, touchActive, touchLogin } from "./users";
import { BroadcastRoom, broadcast, PUBLIC_ROOM, STAFF_ROOM } from "./broadcast";
import { publicSnapshot } from "./public_dashboard";

export { BroadcastRoom };

type Bindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  BROADCAST: DurableObjectNamespace;
  SUPER_ADMIN_EMAILS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const out: any = await recordSearch(c.env.DB, q);
  return c.json(out);
});

// Full roll dump for the offline cache. ~9,600 rows is small enough to ship
// whole each time rather than build incremental sync for it.
app.get("/api/roll/snapshot", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM electors").all();
  return c.json({ records: rowsToDict(res.results), server_time: utcnow(), full: true });
});

app.get("/api/elector/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM electors WHERE id = ?").bind(id).first();
  if (!row) return c.json({ detail: "Elector not found" }, 404);
  return c.json(rowToDict(row));
});

app.get("/api/elector/:id/history", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "SELECT * FROM status_history WHERE elector_id = ? ORDER BY id DESC"
  )
    .bind(id)
    .all();
  return c.json(res.results);
});

app.post("/api/elector/:id/status", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<any>();
  const user = await currentUser(c);
  if (user.email !== "unknown") c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));

  try {
    const out = await updateStatus(
      c.env.DB,
      id,
      body,
      user,
      body.op_id,
      body.client_time,
      c.env.UPLOADS
    );
    if (!out.duplicate) c.executionCtx.waitUntil(broadcast(c.env, "record_updated", { id, by: user.email }));
    return c.json(out.record);
  } catch (err: any) {
    if (err instanceof LockedError) return c.json({ detail: err.message }, 423);
    if (err.message === "NOT_FOUND") return c.json({ detail: "Elector not found" }, 404);
    return c.json({ detail: err.message || "Could not save" }, 400);
  }
});

// "Reopen" — open to anyone signed in as of 2026-08-25 (no longer
// coordinator-only): editing should be democratised and not timebound, per
// the owner's request. Delete entry, below, is the one action that stayed
// admin-gated, and was tightened further to super-admin-only.
app.post("/api/elector/:id/lock", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const user = await currentUser(c);
  c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
  const body = await c.req.json<{ locked: boolean }>();
  try {
    const row = await setLock(c.env.DB, id, !!body.locked, user);
    c.executionCtx.waitUntil(broadcast(c.env, "record_updated", { id, by: user.email }));
    return c.json(row);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return c.json({ detail: "Elector not found" }, 404);
    return c.json({ detail: err.message || "Could not update lock" }, 400);
  }
});

// Corrects a typo in a locked record (e.g. a misspelled name) without
// needing to reopen it. Super admin-only since 2026-08-18 — it can silently
// rewrite a submitted record's fields with no Reopen step and no
// verification-outcome semantics, unlike the ordinary status-update flow
// below, which anyone can now Reopen and edit (2026-08-25). Delete entry
// (below) is also super-admin-only again as of the same date.
app.patch("/api/elector/:id/details", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const user = await currentUser(c);
  if (!user.isSuperAdmin) return c.json({ detail: "Super admin access only" }, 403);
  c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
  const body = await c.req.json<any>();
  try {
    const row = await updateDetails(c.env.DB, id, body, user);
    c.executionCtx.waitUntil(broadcast(c.env, "record_updated", { id, by: user.email }));
    return c.json(row);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return c.json({ detail: "Elector not found" }, 404);
    return c.json({ detail: err.message || "Could not update" }, 400);
  }
});

app.get("/api/house/:base", async (c) => {
  const base = c.req.param("base");
  const row = await c.env.DB.prepare(
    "SELECT part_number, house_number_raw FROM electors WHERE house_base = ? LIMIT 1"
  )
    .bind(base.trim().toUpperCase())
    .first();
  if (!row) return c.json({ detail: "No existing house with that number" }, 404);
  return c.json(row);
});

app.post("/api/elector", async (c) => {
  const body = await c.req.json<any>();
  const user = await currentUser(c);
  if (user.email !== "unknown") c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
  try {
    const out = await addElector(c.env.DB, body, user, body.op_id, body.client_time);
    if (!out.duplicate) {
      c.executionCtx.waitUntil(broadcast(c.env, "record_added", { id: out.record.id, by: user.email }));
    }
    return c.json(out.record);
  } catch (err: any) {
    return c.json({ detail: err.message || "Could not save" }, 400);
  }
});

// Batch replay of an offline device's queued writes. Idempotent per op_id —
// safe to retry a whole batch after a dropped connection.
app.post("/api/sync", async (c) => {
  const body = await c.req.json<{ ops: any[] }>();
  const user = await currentUser(c);
  if (user.email !== "unknown") c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
  const results: any[] = [];
  let anyApplied = false;

  for (const op of body.ops || []) {
    try {
      if (op.type === "status") {
        const out = await updateStatus(
          c.env.DB,
          op.elector_id,
          op.payload || {},
          user,
          op.op_id,
          op.client_time,
          c.env.UPLOADS
        );
        if (!out.duplicate) anyApplied = true;
        results.push({
          op_id: op.op_id,
          status: out.duplicate ? "duplicate" : "applied",
          record: out.record,
        });
      } else if (op.type === "addition") {
        const out = await addElector(
          c.env.DB,
          op.payload || {},
          user,
          op.op_id,
          op.client_time
        );
        if (!out.duplicate) anyApplied = true;
        results.push({
          op_id: op.op_id,
          status: out.duplicate ? "duplicate" : "applied",
          record: out.record,
        });
      } else if (op.type === "asddo_status" || op.type === "draftsir_status") {
        const cfg = op.type === "asddo_status" ? ASDDO : DRAFT_SIR;
        const out = await worklist.updateStatus(
          c.env.DB,
          cfg,
          op.list_id ?? op.asddo_id,
          op.payload || {},
          user,
          op.op_id,
          op.client_time,
          c.env.UPLOADS
        );
        if (!out.duplicate) anyApplied = true;
        results.push({
          op_id: op.op_id,
          status: out.duplicate ? "duplicate" : "applied",
          list_record: out.record,
        });
      } else if (op.type === "revisit") {
        const out = await createRevisit(c.env.DB, op.payload || {}, user, op.op_id, op.client_time);
        results.push({
          op_id: op.op_id,
          status: out.duplicate ? "duplicate" : "applied",
          revisit: out.revisit,
        });
      } else if (op.type === "ph_stage1") {
        const out = await saveStage1(c.env.DB, Object.assign({}, op.payload, { voter_key: op.voter_key }), user);
        anyApplied = true;
        results.push({ op_id: op.op_id, status: "applied", ph_remark: out });
      } else if (op.type === "ph_stage2") {
        const out = await saveStage2(c.env.DB, op.voter_key, op.payload || {}, user, c.env.UPLOADS);
        anyApplied = true;
        results.push({ op_id: op.op_id, status: "applied", ph_remark: out });
      } else if (op.type === "ph_followup") {
        const out = await saveFollowup(c.env.DB, Object.assign({}, op.payload, { voter_key: op.voter_key }), user);
        anyApplied = true;
        results.push({ op_id: op.op_id, status: "applied", ph_followup: out });
      } else if (op.type === "revisit_resolve") {
        const revisit = await resolveRevisit(
          c.env.DB,
          op.payload.revisit_id,
          op.payload.note,
          user,
          op.payload.resolved !== false
        );
        results.push({ op_id: op.op_id, status: "applied", revisit });
      } else {
        results.push({ op_id: op.op_id, status: "error", detail: "Unknown operation type" });
      }
    } catch (err: any) {
      const detail = err instanceof LockedError ? err.message : err.message || "Could not apply";
      results.push({ op_id: op.op_id, status: "error", detail });
    }
  }

  if (anyApplied) c.executionCtx.waitUntil(broadcast(c.env, "sync_applied", { by: user.email }));
  return c.json({ results });
});

// ---------------------------------------------------------------------------
// Reverification lists — ASDD List (src/asddo.ts, migration_010) and Draft SIR
// 2026 (src/draftsir.ts, migration_011). Both driven by src/worklist.ts,
// isolated from `electors`; any signed-in surveyor can record.
// ---------------------------------------------------------------------------
function mountList(prefix: string, cfg: worklist.ListConfig, event: string) {
  app.get(`/api/${prefix}/search`, async (c) =>
    c.json(await worklist.search(c.env.DB, cfg, c.req.query("q") ?? ""))
  );
  app.get(`/api/${prefix}/snapshot`, async (c) => c.json(await worklist.snapshot(c.env.DB, cfg)));
  app.get(`/api/${prefix}/tiles`, async (c) => c.json(await worklist.tiles(c.env.DB, cfg)));
  app.get(`/api/${prefix}/tile/:tile`, async (c) =>
    c.json(
      await worklist.tilePartHouses(
        c.env.DB,
        cfg,
        c.req.param("tile"),
        c.req.query("segment") || "confirmed"
      )
    )
  );
  app.get(`/api/${prefix}/:id{[0-9]+}`, async (c) => {
    const row = await worklist.getOne(c.env.DB, cfg, parseInt(c.req.param("id"), 10));
    if (!row) return c.json({ detail: "Not found" }, 404);
    return c.json(row);
  });
  app.get(`/api/${prefix}/:id{[0-9]+}/history`, async (c) =>
    c.json(await worklist.history(c.env.DB, cfg, parseInt(c.req.param("id"), 10)))
  );
  app.post(`/api/${prefix}/:id{[0-9]+}/status`, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json<any>();
    const user = await currentUser(c);
    if (user.email !== "unknown") c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
    try {
      const out = await worklist.updateStatus(
        c.env.DB, cfg, id, body, user, body.op_id, body.client_time, c.env.UPLOADS
      );
      if (!out.duplicate) c.executionCtx.waitUntil(broadcast(c.env, event, { id, by: user.email }));
      return c.json(out.record);
    } catch (err: any) {
      if (err instanceof LockedError) return c.json({ detail: err.message }, 423);
      if (err.message === "NOT_FOUND") return c.json({ detail: "Not found" }, 404);
      return c.json({ detail: err.message || "Could not save" }, 400);
    }
  });
  app.post(`/api/${prefix}/:id{[0-9]+}/lock`, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const user = await currentUser(c);
    c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
    const body = await c.req.json<{ locked: boolean }>();
    try {
      const row = await worklist.setLock(c.env.DB, cfg, id, !!body.locked, user);
      c.executionCtx.waitUntil(broadcast(c.env, event, { id, by: user.email }));
      return c.json(row);
    } catch (err: any) {
      if (err.message === "NOT_FOUND") return c.json({ detail: "Not found" }, 404);
      return c.json({ detail: err.message || "Could not update lock" }, 400);
    }
  });
  app.get(`/api/${prefix}-export`, async (c) => {
    const csv = await worklist.exportCsv(c.env.DB, cfg);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${prefix}_reverification.csv"`,
      },
    });
  });
}
mountList("asddo", ASDDO, "asddo_updated");
mountList("draftsir", DRAFT_SIR, "draftsir_updated");

// ---------------------------------------------------------------------------
// team / coordinator management
// ---------------------------------------------------------------------------

function superAdminEmails(c: any): string[] {
  return ((c.env.SUPER_ADMIN_EMAILS as string) || "")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
}

app.get("/api/admin/users", async (c) => {
  const user = await currentUser(c);
  if (!user.isAdmin) return c.json({ detail: "Coordinator access only" }, 403);
  return c.json(await listStaff(c.env.DB, superAdminEmails(c)));
});

// Managing who is on the team (adding/removing coordinators) is a super
// admin-only override — a Team Coordinator can no longer promote or demote
// anyone, themselves included.
app.patch("/api/admin/users/:email", async (c) => {
  const user = await currentUser(c);
  if (!user.isSuperAdmin) return c.json({ detail: "Super admin access only" }, 403);
  const email = decodeURIComponent(c.req.param("email"));
  const body = await c.req.json<{ is_admin: boolean }>();
  if (body.is_admin) await addAdmin(c.env.DB, email, user.email);
  else await removeAdmin(c.env.DB, email);
  return c.json(await listStaff(c.env.DB, superAdminEmails(c)));
});

// What a bulk reset would destroy, so the confirmation screen can state it in
// numbers rather than in the abstract. Read-only.
app.get("/api/admin/reset-preview", async (c) => {
  const user = await currentUser(c);
  if (!user.isSuperAdmin) return c.json({ detail: "Super admin access only" }, 403);
  return c.json(await resetAllPreview(c.env.DB));
});

// Returns every record to untouched and deletes all field-recorded work.
//
// There is no is_test flag anywhere in the schema, so this cannot distinguish
// a test entry from a surveyor's real work — it erases both. It is gated three
// ways: super admin only, an exact confirmation phrase in the body, and a
// preview the UI makes the caller read first. Take a D1 export before running
// it; nothing here can undo it.
app.post("/api/admin/reset-all", async (c) => {
  const user = await currentUser(c);
  if (!user.isSuperAdmin) return c.json({ detail: "Super admin access only" }, 403);
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as any);
  if ((body.confirm || "").trim() !== RESET_ALL_CONFIRMATION) {
    return c.json({ detail: `Type ${RESET_ALL_CONFIRMATION} to confirm` }, 400);
  }
  const out = await resetAllData(c.env.DB, c.env.UPLOADS);
  c.executionCtx.waitUntil(broadcast(c.env, "record_updated", { id: 0, by: user.email }));
  return c.json(out);
});

// "Delete entry" in the UI. Wipes a mistaken/duplicate submission back to
// untouched, or removes the row outright if it was a field addition (a base
// roll voter can never be deleted outright — only reset). Super admin-only
// as of 2026-08-25, tightened back from "any admin" (2026-08-18): once
// editing itself was opened up to everyone and made timebound-free (see
// checkUnlocked in records.ts), Delete stayed the one action worth keeping
// behind a smaller, more accountable group, since it's the one that removes
// work rather than just correcting it.
app.post("/api/elector/:id/reset", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const user = await currentUser(c);
  if (!user.isSuperAdmin) return c.json({ detail: "Super admin access only" }, 403);
  c.executionCtx.waitUntil(touchActive(c.env.DB, user.email));
  try {
    const out = await resetRecord(c.env.DB, id);
    c.executionCtx.waitUntil(broadcast(c.env, "record_updated", { id, by: user.email }));
    return c.json(out);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return c.json({ detail: "Elector not found" }, 404);
    return c.json({ detail: err.message || "Could not reset" }, 400);
  }
});

// ---------------------------------------------------------------------------
// photo uploads
// ---------------------------------------------------------------------------

app.get("/api/uploads/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const obj = await fetchPhoto(c.env.UPLOADS, key);
  if (!obj) return c.json({ detail: "File not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream" },
  });
});

// ---------------------------------------------------------------------------
// live updates
// ---------------------------------------------------------------------------

app.get("/api/events", async (c) => {
  const id = c.env.BROADCAST.idFromName(STAFF_ROOM);
  const stub = c.env.BROADCAST.get(id);
  return stub.fetch(c.req.raw);
});

// ---------------------------------------------------------------------------
// public dashboard (/live/)
//
// These two routes are the ONLY ones intended to be reachable without a
// Cloudflare Access login, via a Bypass policy scoped to the /live path (see
// CLAUDE.md). They deliberately sit outside the /api/ prefix so that an Access
// rule written against /live can never widen to /api/*, which serves full
// elector records and has no auth of its own.
//
// Do not add a route here that takes an id, a filter, or a search term.
// Aggregates only.
// ---------------------------------------------------------------------------

// The "Staff sign in" button on the public home page points here. This path
// sits under /api/, so Cloudflare Access challenges it; once the visitor has
// completed OTP, Access forwards them here and this bounces them back to "/",
// where /api/whoami now succeeds and the full staff app boots. Doing it this
// way means Access needs exactly one protected path (/api) — no second rule
// to get wrong.
app.get("/api/signin", (c) => c.redirect("/", 302));

app.get("/live/data", async (c) => {
  const body = await publicSnapshot(c.env.DB);
  return c.json(body, 200, {
    // Live figures — an edge cache would make the WebSocket push pointless.
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
});

// Sanitised live feed: the PUBLIC_ROOM payload is only {event, at}, so a
// connected browser learns that something changed and refetches /live/data.
app.get("/live/events", async (c) => {
  const id = c.env.BROADCAST.idFromName(PUBLIC_ROOM);
  const stub = c.env.BROADCAST.get(id);
  return stub.fetch(c.req.raw);
});

app.get("/api/flags/duplicates", async (c) => {
  const res = await c.env.DB.prepare(
    "SELECT * FROM electors WHERE is_duplicate_epic = 1 ORDER BY epic_id"
  ).all();
  return c.json(rowsToDict(res.results));
});

app.get("/api/flags/deleted", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM electors WHERE source_deleted = 'Yes'").all();
  return c.json(rowsToDict(res.results));
});

// Settings the UI needs so nothing is hardcoded in two places.
app.get("/api/config", async (c) => {
  return c.json({
    addition_categories: ADDITION_CATEGORIES,
    correction_types: CORRECTION_TYPES,
    deletion_types: DELETION_TYPES,
    source_flag_tags: SOURCE_FLAG_TAGS,
    yes_no: YES_NO,
  });
});

app.get("/api/stats", async (c) => {
  const db = c.env.DB;
  const statusRes = await db
    .prepare("SELECT verification_status, COUNT(*) c FROM electors GROUP BY verification_status")
    .all();
  const statusCounts: Record<string, number> = {};
  for (const r of statusRes.results as any[]) {
    statusCounts[r.verification_status] = r.c;
  }
  const totalRes = await db.prepare("SELECT COUNT(*) c FROM electors").first<{ c: number }>();
  return c.json({ total: totalRes?.c ?? 0, by_status: statusCounts });
});

app.get("/api/whoami", async (c) => {
  const user = await currentUser(c);
  const signedIn = user.email !== "unknown";
  if (signedIn) c.executionCtx.waitUntil(touchLogin(c.env.DB, user.email));
  return c.json({
    email: signedIn ? user.email : null,
    name: signedIn ? await getName(c.env.DB, user.email) : null,
    is_admin: user.isAdmin,
    is_super_admin: user.isSuperAdmin,
  });
});

// Every known name, for showing "Verified by NAME" instead of an email on a
// voter card. Not admin-gated and not gated on currentUser() at all — like
// every other GET under /api/ (search, roll/snapshot, records), this trusts
// Cloudflare Access to have already kept anonymous traffic out before the
// request reaches the Worker. Checking for the "unknown" sentinel here (as
// an earlier version of this route did) was redundant in production and
// actively wrong in local dev, where every request is "unknown" — it made
// the directory always empty to the browser locally, so "Verified by"
// silently fell back to raw emails with no way to notice why.
app.get("/api/directory", async (c) => {
  return c.json(await directory(c.env.DB));
});

// The name-capture prompt: asked once, on first login after this shipped,
// for every account including ones with months of prior activity — see
// requestNameIfMissing() in public/js/app.js.
app.patch("/api/me", async (c) => {
  const user = await currentUser(c);
  if (user.email === "unknown") return c.json({ detail: "Not signed in" }, 401);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as any);
  const name = (body.name || "").trim();
  if (!name) return c.json({ detail: "Name is required" }, 400);
  if (name.length > 100) return c.json({ detail: "Name is too long" }, 400);
  await setName(c.env.DB, user.email, name);
  return c.json({ email: user.email, name });
});

// ---------------------------------------------------------------------------
// dashboard and reports
// ---------------------------------------------------------------------------

app.get("/api/dashboard", async (c) => c.json(await dashboard(c.env.DB)));

// Re-verification Dashboard — read-only view over the frozen asddo / draft_sir
// worklists + electors. Never writes; see src/reverify.ts.
app.get("/api/reverify/dashboard", async (c) => c.json(await reverifyDashboard(c.env.DB)));
app.get("/api/reverify/tile/:list/:tile", async (c) =>
  c.json(await reverifyTile(c.env.DB, c.req.param("list"), c.req.param("tile")))
);

// SEARCH tab — one box across the base roll (incl. field additions), the
// published Draft SIR roll and the ASDD list, merged by EPIC. Read-only.
// Public Hearing Remarks are a separate table (migration_013) this never
// writes back to electors/asddo/draft_sir with.
app.get("/api/search-all", async (c) => c.json(await searchAll(c.env.DB, c.req.query("q") ?? "")));

// Offline cache warm — mirrors /api/asddo/snapshot / /api/draftsir/snapshot.
app.get("/api/ph-remarks-snapshot", async (c) => c.json({ records: await allRemarks(c.env.DB) }));

// Government marking/status for a set of voter_keys — the PH FOLLOW UP tab's
// "PH Status" tag. ?keys=a,b,c (comma-separated voter_key values).
app.get("/api/voter-status", async (c) => {
  const keys = (c.req.query("keys") || "").split(",").map((k) => k.trim()).filter(Boolean);
  return c.json({ status: await statusForKeys(c.env.DB, keys) });
});

app.get("/api/ph-remarks/:key", async (c) => c.json(await getRemark(c.env.DB, c.req.param("key"))));

app.post("/api/ph-remarks", async (c) => {
  const user = await currentUser(c);
  const body = await c.req.json();
  try {
    return c.json(await saveStage1(c.env.DB, body, user));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not save" }, 400);
  }
});

app.patch("/api/ph-remarks/:key", async (c) => {
  const user = await currentUser(c);
  const body = await c.req.json();
  try {
    return c.json(await saveStage2(c.env.DB, c.req.param("key"), body, user, c.env.UPLOADS));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not save" }, 400);
  }
});

// PH FOLLOW UP tab — post-hearing follow-up, a separate table from
// ph_remarks (migration_016; see its header comment). Offline cache warm
// mirrors /api/ph-remarks-snapshot: the table stays small, ship it whole.
app.get("/api/ph-followup-snapshot", async (c) => c.json({ records: await allFollowups(c.env.DB) }));

app.get("/api/ph-followup/:key", async (c) => c.json(await getFollowup(c.env.DB, c.req.param("key"))));

app.post("/api/ph-followup/:key", async (c) => {
  const user = await currentUser(c);
  const body = await c.req.json();
  try {
    return c.json(await saveFollowup(c.env.DB, Object.assign({}, body, { voter_key: c.req.param("key") }), user));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not save" }, 400);
  }
});

app.get("/api/parts", async (c) => c.json(await partProgress(c.env.DB)));

// Okhla (AC 54) household status register — read-only, isolated ok_* tables
// (migration_018.sql, src/okhla.ts). Gated by Access like every /api route.
app.get("/api/okhla/meta", async (c) => c.json(await okhlaMeta(c.env.DB)));
app.get("/api/okhla/offline/pack", async (c) => c.json(await okhlaOfflinePack(c.env.DB, parseInt(c.req.query("part") || "0", 10) || 0)));
app.get("/api/okhla/offline/visits", async (c) => c.json(await okhlaOfflineVisits(c.env.DB)));
// Field verification of one ASDD elector (migration_020.sql). Keyed by EPIC.
app.post("/api/okhla/verify/:epic", async (c) => {
  const user = await currentUser(c);
  try {
    return c.json(await saveVerification(c.env.DB, c.req.param("epic"), await c.req.json(), user, c.env.UPLOADS));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not save" }, 400);
  }
});
app.get("/api/okhla/progress", async (c) =>
  c.json(await okhlaProgress(c.env.DB, c.req.query("scope") || null, c.req.query("reason") || null)));
app.get("/api/okhla/list", async (c) =>
  c.json(
    await okhlaList(c.env.DB, {
      kind: c.req.query("kind") ?? "",
      scope: c.req.query("scope") || null,
      page: parseInt(c.req.query("page") ?? "0", 10) || 0,
      email: c.req.query("email") || null,
      reason: c.req.query("reason") || null,
    })
  )
);
// Public hearing desk (migration_023.sql, src/okhla_hearing.ts): look an elector up, then issue a token (PH-K1, PH-G1 ...).
app.get("/api/okhla/hearing/search", async (c) => c.json(await hearingSearch(c.env.DB, c.req.query("q") ?? "")));
app.post("/api/okhla/hearing", async (c) => {
  const user = await currentUser(c);
  try {
    return c.json(await issueToken(c.env.DB, await c.req.json(), user));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not issue the token" }, 400);
  }
});
app.get("/api/okhla/hearing/dashboard", async (c) => c.json(await hearingDashboard(c.env.DB)));
app.post("/api/okhla/hearing/exit", async (c) => {
  const user = await currentUser(c);
  try {
    return c.json(await saveExit(c.env.DB, await c.req.json(), user));
  } catch (e: any) {
    return c.json({ detail: e.message || "Could not save" }, 400);
  }
});
app.get("/api/okhla/search", async (c) =>
  c.json(
    await okhlaSearch(c.env.DB, {
      q: c.req.query("q") ?? "",
      part: parseInt(c.req.query("part") ?? "", 10) || null,
      status: c.req.query("status") || null,
      page: parseInt(c.req.query("page") ?? "0", 10) || 0,
      block: c.req.query("block") || null,
    })
  )
);

app.get("/api/reports/daily", async (c) => {
  const date = c.req.query("date");
  return c.json(await dailyActivity(c.env.DB, date));
});

app.get("/api/reports/days", async (c) => c.json(await activeDays(c.env.DB)));

app.get("/api/me/summary", async (c) => {
  const user = await currentUser(c);
  return c.json(await mySummary(c.env.DB, user.email));
});

// The dashboard drill-down: "how many Additions" links to "which electors,
// exactly". Shares its filter definitions with the CSV/ZIP exports so a list
// and its download can never disagree.
app.get("/api/records", async (c) => {
  const kind = c.req.query("kind") || "";
  const part = c.req.query("part");
  // Restrict to one surveyor's work on one day — how the Daily Activity
  // table's numbers drill down to the exact list behind them (see
  // dailyActivity() in reports.ts, which this deliberately mirrors).
  const user = c.req.query("user");
  const date = c.req.query("date");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

  const filter = buildFilter(kind, part);
  if (!filter) return c.json({ detail: "Unknown list" }, 404);

  let where = filter.where;
  const params = [...filter.params];
  const attributionColumn = kind === "additions" ? "created_by_email" : "verified_by";
  if (user) {
    where += ` AND ${attributionColumn} = ?`;
    params.push(user);
  }
  if (date) {
    const dateColumn = kind === "additions" ? "created_at" : "verified_at";
    where += ` AND substr(${dateColumn}, 1, 10) = ?`;
    params.push(date);
  }

  const db = c.env.DB;
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c,
              COUNT(DISTINCT CASE WHEN IFNULL(epic_id, '') <> '' THEN epic_id END) AS epics
         FROM electors WHERE ${where}`
    )
    .bind(...params)
    .first<{ c: number; epics: number }>();
  const res = await db
    .prepare(`SELECT * FROM electors WHERE ${where}` + ORDER_BY + " LIMIT ? OFFSET ?")
    .bind(...params, limit, offset)
    .all();

  return c.json({
    kind,
    title: FILTER_TITLES[kind] || kind,
    total: totalRow?.c ?? 0,
    // Unique voters behind this list — the base-roll lists count a two-part
    // enrolment (or a Supplement 5 part-move) once. Only surfaced client-side
    // when it differs from `total`.
    distinct_epics: totalRow?.epics ?? 0,
    records: rowsToDict(res.results),
  });
});

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

const EXPORT_MEDIA: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

app.get("/api/export/:kind", async (c) => {
  const kind = c.req.param("kind");
  const format = c.req.query("format") || "csv";
  if (!EXPORT_MEDIA[format]) {
    return c.json({ detail: "format must be csv, zip or xlsx" }, 400);
  }
  const fetched = await fetchRows(c.env.DB, kind);
  if (!fetched) return c.json({ detail: "Unknown export kind" }, 404);

  const filename = `sir-audit-${kind}-${stamp()}.${format}`;
  const body =
    format === "csv"
      ? toCsv(fetched.spec, fetched.rows)
      : format === "zip"
        ? toZipByPart(fetched.spec, fetched.rows)
        : toXlsx(fetched.spec, fetched.rows);

  return new Response(body, {
    headers: {
      "Content-Type": EXPORT_MEDIA[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

// Whole-database download — every table, every column, nothing filtered.
// The Python reference copies its local SQLite file; D1 has no local file
// for a Worker to read, so this ships one CSV per table in a zip instead.
app.get("/api/export-database", async (c) => {
  const body = await toDatabaseDump(c.env.DB);
  const filename = `sir-audit-database-${stamp()}.zip`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

export default app;
