# SIR Social Audit — Hyderabad (Secunderabad Cantt, AC 71)

> ## ⚠️ READ THIS FIRST — this is the HYDERABAD fork
>
> This codebase was forked from the Delhi SIR Social Audit (owner: Aashima
> Takkar; developer: Khush Vachhrajani), with their go-ahead, on 2026-10-23.
> **Everything below this box was written for the Delhi deployment.** The
> engineering guidance and design decisions still apply and are worth reading in
> full. The *operational identifiers* mostly DO NOT. Specifically:
>
> | Below says | For Hyderabad it is |
> | --- | --- |
> | D1 `electoral-app-db` / id `a0326970-…` | `hyd-sir-audit-db`, own id (see `wrangler.jsonc`) |
> | R2 `electoral-app-uploads` | `hyd-sir-audit-uploads` |
> | Worker `electoral-app` | `hyd-sir-audit` |
> | Account `db3348d73bd782979ca224c3bd2603e3` | our own Cloudflare account |
> | Team domain `sirsocialaudit.cloudflareaccess.com` | our own Zero Trust team domain |
> | Access policy `15b09b04-…` + its four allowlisted emails | our own policy, our own allowlist |
> | Super admin (a Delhi maintainer's address) | `sreeharsha@hey.com` |
> | Hostname `delhi.sirpublicaudit.app` | none yet — workers.dev only |
> | `CF_API_TOKEN` secret already exists | does NOT exist here |
>
> **Never run a command from the Delhi notes verbatim.** The backup line below
> names Delhi's database: for this project it is
> `npx wrangler d1 export hyd-sir-audit-db --remote --output backups/<name>.sql`.
> Running the Delhi version would touch another organisation's production.
>
> ### What is Hyderabad-specific in the code
>
> - **Part offset is −1, not Delhi's +3.** 2025 Final Roll part N is 2026 SIR
>   Draft Roll part N+1 (149→150, 150→151, 151→152). In
>   `src/comprehensive_search.ts` and `public/js/search-all.js` — both copies,
>   change together.
> - **`AUDIT_MIN`/`AUDIT_MAX` in `src/okhla.ts` are 149/151** (Delhi: 59/69).
> - **`ok_*` tables and `okhla*.ts` modules keep their Okhla names** even though
>   they hold Secunderabad data. Renaming would touch ~3,000 lines across 10
>   files, and a missed reference is a silent runtime bug. Read `ok_` as "the
>   second-generation per-AC register", not "Okhla".
> - **BLO contact maps are empty.** Delhi's BLO names and mobile numbers were
>   stripped. `bloForPart()` now has a `if (!rec) return null` guard — without it
>   an empty map crashes on any part in `NEW_TO_OLD_PART`.
> - **`CRITICAL_MANUAL` is empty** (Delhi pinned part 64).
> - **No Supplement 5 / Monthly Pooling data.** Those columns stay NULL and their
>   tiles read zero. The `supplement5` column and code are untouched.
> - Data sources: our own OCR of the ECI PDFs, not an official audit pack.
>   2025 Final Roll parts 149–151 (3,132 electors), 2026 SIR Draft Roll parts
>   149–151 (2,037), ASD-D list for 2025 p149 (319), notice list for 2026 p151
>   = 2025 p150 (494). **2026 part 152 is not OCR'd**, so 2025 part 151 has no
>   draft counterpart — it must be treated as `draft_basis = assumed`, never as
>   1,305 deletions.
>
> ---

This file is a handoff brief for picking up this project cold. It was written by a
previous Claude Code session working directly with the project owner (Aashima), for
a developer (referred to here as "the developer") taking the project forward with
their own Claude Code session. Read this whole file before changing anything —
several decisions below look like they could be "cleaned up" but are deliberate.

## What this is

A door-to-door electoral roll verification tool ("SIR Social Audit"). Field
surveyors search a voter roll by house number or EPIC ID, record whether each
person was found/not found at the address, flag additions/deletions/corrections,
and coordinators review progress on a dashboard. It handles **real PII for ~9,601
voters** (names, addresses, ages, genders, EPIC numbers, phone numbers). Treat
every schema change and data operation accordingly: backup before writing,
verify after.

Originally built as a Python/FastAPI + SQLite app (a zip from the developer). This
codebase is a full port to **Cloudflare Workers**, because Python/FastAPI cannot
run on Workers' V8-isolate model — not a rewrite by choice, a platform constraint.
The developer has continued building their own Python reference version in
parallel; features have been ported back and forth by diffing the two. Expect this
to keep happening — check in with the project owner about which side is
authoritative for a given feature before assuming this codebase is behind or ahead.

## Critical facts — read these first

1. **Git was just initialized, with exactly one commit, and no remote.** Identity
   on that commit is set to the Delhi app owner's name and address (the app
   owner) as a placeholder, since no git identity existed on the machine it was
   created on at all. If you're committing as yourself, reset it first:
   `git config user.name "..."` / `git config user.email "..."` (local to this
   repo, not `--global`, unless you want that everywhere). **No remote is
   configured** — where this repo ends up living (private GitHub repo? somewhere
   self-hosted?) hasn't been decided. That decision belongs to the app owner, not
   to whoever sets up the remote — confirm with her before pushing anywhere.
2. **The committed history includes real voter PII.** `schema.sql`,
   `seed_data.sql`, and `retokenize.sql` are the original electoral-roll import —
   real names, addresses, ages, genders, and EPIC numbers for ~9,601 people — and
   they're in that first commit (deliberately: they're needed to stand up a local
   dev D1 from scratch). This is fine for a private, access-controlled remote
   shared between the app owner and developer, who both already have this data.
   **It is not fine to push this repo to a public or broadly-shared remote.**
   Point-in-time production backups (`backups/*.sql`) are excluded via
   `.gitignore` for the same reason, but stay on disk locally — don't lose them
   when moving the project.
3. **Production holds real voter PII in the live D1 database too**, separate from
   the point above. Before any destructive DB operation:
   `npx wrangler d1 export electoral-app-db --remote --output backups/backup-<reason>-$(date +%Y%m%d-%H%M%S).sql`
4. **A `CF_API_TOKEN` Worker secret exists**, scoped narrowly to
   `Access: Apps and Policies — Edit` on the Cloudflare account, nothing broader.
   It is currently unused by any code (see "Loose end" below) — it was set up in
   preparation for a feature that was started and then explicitly paused before
   any app code was written. It's safe to use as-is (it was rotated cleanly via
   the dashboard, never typed into a chat/agent conversation). If you ever do need
   a fresh one, generate and store it the same way: create it in the Cloudflare
   dashboard yourself, then `wrangler secret put CF_API_TOKEN` in your own
   terminal — never paste a live token value into a chat with an agent.
5. **Nothing gets deployed to production without the owner's go-ahead being
   implicit in the request.** The working pattern throughout this project has
   been: build and test locally first (`wrangler dev` + browser verification),
   then one `wrangler deploy` at the end covering everything — not a deploy after
   every small change. Follow that pacing unless told otherwise.

## Architecture

- **Cloudflare Workers** running **Hono** (TypeScript web framework) — `src/index.ts` is the entry point, all routes defined there, delegating to modules below.
- **Cloudflare D1** (SQLite-compatible) — the database. Binding `DB`, name `electoral-app-db`, id `a0326970-1e72-426b-b292-6184a6d8bf7a`.
- **Cloudflare R2** — object storage for death-certificate photo uploads. Binding `UPLOADS`, bucket `electoral-app-uploads`.
- **Cloudflare Durable Objects** — one `BroadcastRoom` class (SQLite-backed DO) fans out "a record was updated" events over WebSocket so open tabs refresh live. Binding `BROADCAST`.
- **Cloudflare Workers Assets** — serves the static frontend from `public/`, with `run_worker_first: ["/api/*"]` so `/api/*` always hits the Worker and everything else is served as a static file.
- **Cloudflare Access (Zero Trust)** — gates the *entire app* behind email OTP login before any request reaches the Worker. Team domain `sirsocialaudit.cloudflareaccess.com`. This is not optional — the app has no login system of its own; `Cf-Access-Authenticated-User-Email` is the only identity signal it ever sees.
- **Offline-first PWA** — `public/js/store.js` (IndexedDB cache of the full roll + write outbox), `public/js/api.js` (online/offline decision + sync loop), `public/sw.js` (service worker, app-shell caching only, never caches `/api/*`).

Account: `db3348d73bd782979ca224c3bd2603e3` (Khush's Cloudflare account). Worker
URL: `https://electoral-app.electoral-app-cf.workers.dev`.

## Public home page — the app's front door is now unauthenticated

Visiting the site signed-out no longer bounces straight to a login screen. The
home page shows an **aggregate-only progress dashboard** plus a "Staff sign in"
button; allowlisted people sign in from there and get the full app at the same
URL. This was a deliberate product decision (public transparency for a social
audit), and it inverts how Cloudflare Access is configured — read the whole
section before touching Access.

Note the Access OTP page itself is hosted by Cloudflare on
`sirsocialaudit.cloudflareaccess.com` and **cannot** be customised. "Put the
dashboard on the login screen" is achieved by making our own root public and
letting the visitor choose to sign in, not by editing Cloudflare's page.

### The Access configuration is now inverted — this is the load-bearing part

Previously: the whole hostname was gated. Now:

| Access application | Policy |
| --- | --- |
| `electoral-app.electoral-app-cf.workers.dev/api` | **Allow → Staff allowlist** |
| `electoral-app.electoral-app-cf.workers.dev` (root) | **Bypass → Everyone** |

Access matches the more specific path first, so `/api/*` stays gated and
everything else is public. **Order of operations matters when setting this
up:** create and verify the `/api` Allow application *first*, then add the root
Bypass. Doing it the other way round leaves a window where `/api/*` is wide
open to the internet.

Why this is the dangerous part: **no `/api/*` route does any auth of its own.**
`currentUser()` in `records.ts` gates *roles*, not access. Cloudflare Access is
the only thing standing between the open internet and `/api/roll/snapshot`,
which returns all ~9,601 elector rows — names, addresses, ages, EPIC numbers —
in a single response. If the `/api` application is ever deleted, misscoped, or
its policy switched to Bypass, the entire electoral roll is public immediately
and silently.

After any change to Access, verify in a logged-out private window:
`/` shows the dashboard, and `/api/dashboard`, `/api/roll/snapshot`,
`/api/export-database` all redirect to the OTP login.

### What keeps the public view safe

- `src/public_dashboard.ts` returns **counts only**, built field by field. It
  never spreads a D1 row and never imports `records.ts`/`exports.ts`/
  `filters.ts`. Read its header comment before adding a field.
- `/live/data` and `/live/events` serve the public view and sit **outside**
  `/api/` on purpose, so the one gated prefix cleanly covers every PII
  endpoint and nothing else has to be reasoned about.
- Real-time uses a **second Durable Object room** (`PUBLIC_ROOM` in
  `broadcast.ts`), not a filtered view of the staff room. Staff clients get
  `{event, data:{id, by}, at}`; public clients get `{event, at}` and nothing
  else, then refetch `/live/data`. The payloads are built separately so there
  is no filter step to forget to update — don't "simplify" these into one room
  with a strip function.
- `public/js/public-dashboard.js` renders the signed-out view. It never touches
  `/api/*` and emits zero `<a>` tags — there is no navigation off it.
- `app.js` decides which view to show by probing `/api/whoami` with
  `redirect:"manual"`: request gets through → staff app; Access redirect →
  public view. `#appChrome` is hidden in the HTML by default so a signed-out
  visitor never sees a flash of the staff UI.
- When public, `app.js` calls `api.setStaffMode(false)` so the outbox sync loop
  and the staff `/api/events` socket stop retrying against a door that will
  not open for them.
- `sw.js` skips `/live/` for the same reason it skips `/api/` — live figures
  must not be served from the app-shell cache. Bump `CACHE` on any sw.js edit.

Deliberately **not** on the public view, all of which the staff dashboard has:
drill-down links (`/api/records` → full elector rows), every export button
(`/api/export/*`, `/api/export-database` → the whole roll), the Daily Activity
table (surveyor emails and individual productivity), and "My Activity". Adding
any of them back makes this a PII disclosure, not a feature.

`/api/signin` is a one-line redirect back to `/`. It exists so the sign-in
button can point at a gated path and trigger the Access challenge, which means
Access needs exactly one protected path — no second rule to get wrong.

### Local development

`wrangler dev` has no Access layer, so `/api/whoami` always succeeds and the
**staff app loads as it always has**. To preview the signed-out view locally,
add `?public=1` to any URL. That flag only ever shows less than the visitor is
already entitled to see, so it is harmless in production too.

## Roles and access — two separate layers, don't conflate them

**Layer 1 — Cloudflare Access "Staff allowlist" policy** (reusable policy, id
`15b09b04-d505-49fd-b511-0e8ce255920b`, in Access controls → Policies in the
dashboard). This is the actual front door: only emails on this list can complete
OTP login and reach the app at all. As of this handoff it allows:
four addresses belonging to the Delhi team. **Those addresses have been redacted
from this fork** — they are other people's personal emails and the allowlist of
somebody else's production system, neither of which belongs in this repository.
The original notes flagged that one of the four was never explained to the owner
and may be stale; that is for the Delhi team to resolve, not us.

Adding someone here currently requires the Cloudflare dashboard (Access controls →
Policies → Staff allowlist → "..." → Configure → add to the Emails field → Save
policy). **There was a half-started plan to make this manageable from inside the
app's Team tab** — see "Loose end" below.

**Layer 2 — app-level role**, decided by `currentUser()` in `src/records.ts`,
checked on every request via the `Cf-Access-Authenticated-User-Email` header:

- **Super Admin** — email is in the `SUPER_ADMIN_EMAILS` env var (`wrangler.jsonc`,
  for Hyderabad this is `sreeharsha@hey.com`). Changing this requires editing
  the config and redeploying — deliberately not editable from the UI, so a UI
  mistake can never lock out every admin. Can do everything a Team Coordinator
  can, plus: manage the `admins` table (add/remove Team Coordinators, via
  `PATCH /api/admin/users/:email`), and correct a record's details in place via
  `PATCH /api/elector/:id/details` — the "Edit details" link on a card, shown to
  Super Admins only.
- **Team Coordinator** — email is in the `admins` D1 table. Can lock-override
  any record and use "Delete entry" on a card (`POST /api/elector/:id/reset` —
  resets a base-roll voter to untouched, or removes a field addition outright).
  **Cannot** manage other admins/promote-demote (Super Admin only), and as of
  2026-08-18 **cannot** use "Edit details" either — see the permission-swap note
  below.
- **Everyone else** on the Access allowlist — plain field staff, no elevated
  permissions.

**The Edit-details / Delete-entry permissions swapped on 2026-08-18, at the
owner's request** — easy to misremember, since it inverts the obvious mapping
of "more admin = more permissions":
- `PATCH /elector/:id/details` (rewrites a record's fields in place) tightened
  from "any admin" to **Super Admin only**.
- `POST /elector/:id/reset` ("Delete entry" — resets or removes a record)
  loosened from **Super Admin only** to **any admin**, because coordinators are
  the ones actually working the list day to day and finding the duplicates
  (this also fixed the button: it used the browser's native `confirm()`, which
  some installed-PWA contexts on Android silently no-op — indistinguishable
  from the button "not working". It now uses an in-app confirm modal instead,
  with wording that differs for a field addition (removed outright) vs. a
  base-roll voter (reset to untouched — never a true delete, or the imported
  roll itself would be corrupted)).

The Team tab (`loadTeam()` in `public/js/app.js`) now lists every email in the
`users` D1 table (added by migration_006.sql — every account that has ever
loaded the app since 2026-08-18) plus anyone in `admins`/`SUPER_ADMIN_EMAILS`
who hasn't logged in yet — a superset of the old "only people with app
activity" rule. It shows **Name, Email, Role, Last Active** only; the
verification/addition/deletion/correction counts it used to show were dropped
at the owner's request, since they duplicated the Dashboard's Daily Activity
table, which now drills down per person per day (see "Per-user drill-down"
below) — a better fit for "who did what" than a running lifetime total on the
roster screen. A Super Admin can still promote a never-active email straight
to Team Coordinator via "Add Team Coordinator by email"
(`addTeamCoordinator()` → same `PATCH /api/admin/users/:email` endpoint).

## Loose end: Access-allowlist management from the Team tab (not built)

The project owner asked for the Team tab to show *every* email on the Cloudflare
Access allowlist (not just people with app activity), with a toggle for role and a
way to pause/remove access outright. This was in progress and was explicitly
stopped ("Leave all of this") before any application code was written. State at
the stopping point:

- A `CF_API_TOKEN` Worker secret exists, scoped to exactly one permission:
  **Access: Apps and Policies — Edit**, on the entire Cloudflare account. Nothing
  broader.
- It was verified working with one read-only `GET` against
  `https://api.cloudflare.com/client/v4/accounts/db3348d73bd782979ca224c3bd2603e3/access/policies/15b09b04-d505-49fd-b511-0e8ce255920b`,
  which is how the real response shape below was confirmed (don't guess at this
  shape — it's already known-correct):
  ```json
  {
    "result": {
      "id": "15b09b04-d505-49fd-b511-0e8ce255920b",
      "name": "Staff allowlist",
      "decision": "allow",
      "include": [
        { "email": { "email": "someone@example.com" } }
      ],
      "exclude": [],
      "require": [],
      "connection_rules": { "rdp": {} },
      "reusable": true,
      "app_count": 1
    },
    "success": true
  }
  ```
  A `PUT` to the same URL with a modified `include` array (same shape) is how
  you'd add/remove allowlisted emails. This was never attempted — verify against a
  fresh `GET` again before writing, in case the policy changed.
- **No application code exists for this feature.** No new route in `src/index.ts`,
  no Team tab UI changes beyond what's already described above. The `CF_API_TOKEN`
  secret described in "critical facts" above is ready to use for this — no need to
  set up a new one.
- Before building: "pause" was never actually specced with the owner beyond the
  original one-line request. Worth clarifying whether pause should mean *real*
  removal from the Access policy (immediate, hard revocation, matches the literal
  ask) versus a soft flag in our own DB (reversible, but means a "paused" person
  can still pass Access login and would need every API route to check the flag —
  more surface area for a mistake to leak PII). The real-removal approach was the
  direction this was heading in, for exactly that reason.

## Key design decisions (don't undo these without knowing why)

- **No `xlsx` (SheetJS) npm package.** It has an unpatched Prototype Pollution
  (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) advisory with no fix
  available. `src/xlsx.ts` is a small hand-rolled write-only `.xlsx` generator
  built on `fflate` instead — the known vulnerabilities are in the *parse* path,
  which a write-only implementation never exercises. Don't add the `xlsx` package
  back for convenience.
- **Service worker is network-first, not cache-first**
  (`public/sw.js`). It used to be stale-while-revalidate, which meant field staff
  with the PWA already cached on their phones wouldn't see a shipped fix until
  they happened to reload twice. Now: online → always fetch fresh; offline → fall
  back to cache. If you ever see "why isn't my fix showing up for staff," check
  this file and the `CACHE` version string before assuming it's something else —
  bump the `CACHE` name string on any future change to this file specifically
  (that's what forces old cached shells to be dropped).
- **The Revisits feature was removed from the app on 2026-08-18** ("no one is
  using it"). Gone: the Revisits tab, the House Revisit quick-flag button next
  to Search, the "flagged for a revisit" banner on a search result, and the
  standalone `GET/POST /api/revisits*` REST routes. **Deliberately kept, as a
  safety net:** the `revisits` D1 table and every row already in it (untouched
  — nothing here ever deletes existing data), `src/revisits.ts`'s
  `createRevisit`/`resolveRevisit` functions, and the `op.type === "revisit"` /
  `"revisit_resolve"` branches inside `POST /api/sync`. The reasoning: a device
  that went offline before this shipped could still have a queued revisit op
  sitting in its IndexedDB outbox, and that op will eventually replay through
  `/api/sync` regardless of what the UI currently offers — removing the
  server's ability to apply it would turn a harmless old queued item into a
  sync error on somebody's phone for no benefit. Once every device has been
  online at least once after this change (so nothing is left queued), the
  safety-net code can be removed too. The old "reason" dropdown
  (`revisits.reason`, still nullable, still unused) was a separate, earlier
  simplification and is moot now that the whole feature is gone.
- **"Death certificate collected" checkbox was deliberately removed** from the
  Deletion sub-category form. The photo-upload field for the death certificate is
  still there and still works — only the separate yes/no checkbox is gone.
  `death_cert_collected` stays in the schema, unused, same reasoning as above.
- **Record locking with a grace period.** A submitted verification locks after
  `EDIT_GRACE_MINUTES` (**1440** — 24 hours, in `wrangler.jsonc`; raised from 30
  minutes on 2026-08-18 at the owner's request) — only the original submitter
  (within the grace window) or any admin (Super Admin or Team Coordinator) can
  change it after that. Atomic claim via `UPDATE ... WHERE locked_at IS NULL`.
  The client mirrors this from `appConfig.edit_grace_minutes` (`/api/config`)
  rather than a hardcoded copy of the number — `GRACE_MINUTES_FALLBACK` in
  `app.js` is used only before that config has loaded once. Keeping a second,
  separately-maintained copy of this number client-side is exactly how it could
  silently drift from the server (as very nearly happened when this value
  changed) — don't reintroduce a hardcoded value here.
- **Source-flag parsing.** The roll's free-text `Flag` CSV column (e.g.
  `"S (Shifted)"`) gets parsed case-insensitively into a canonical
  `flags: string[]` (`Absent`/`Expired`/`Repeated`/`Shifted`, or the raw value if
  unrecognized) by `parseSourceFlags()` in `src/records.ts`, attached to every
  elector record via `rowToDict()`/`rowsToDict()`. Never drop an unrecognized flag
  silently — showing something unnamed is better than hiding it.
- **Shared filter definitions** (`src/filters.ts`) back both the dashboard
  drill-down (`/api/records`) and every export (CSV/ZIP/XLSX) — a list and its
  matching download can never disagree. If you add a new dashboard category, add
  it here, not in two places.
- **Per-user drill-down.** `GET /api/records` also accepts `user` (an email) and
  `date` (`YYYY-MM-DD`), appended as extra `AND` clauses onto the same
  `buildFilter()` output the dashboard and exports already share — added
  2026-08-18 so every number in the Daily Activity table drills down to the
  exact list of electors behind it, for one person, on one day. Additions are
  matched on `created_by_email`/`created_at`; every other kind on
  `verified_by`/`verified_at` (mirrors the column split `dailyActivity()` in
  `reports.ts` already uses). This reads current state on `electors`, the same
  as every other drill-down, not a historical `status_history` snapshot — a
  record touched twice in one day by two different people will attribute to
  whoever touched it *last*, which can disagree with the day's history in that
  edge case. Exports never pass these params, so `exports.ts` is unaffected.
- **Every account gets a name, not just an email** (`migration_006.sql`, the
  `users` table, `src/users.ts`). On first login after 2026-08-18 — including
  accounts with months of prior activity — the app blocks on a one-time modal
  asking for a name before anything else, and PATCHes it in via `PATCH /api/me`.
  `GET /api/directory` (no admin gate: the emails it resolves are already
  visible to every signed-in person on every card/search-result/export, so a
  name is no more sensitive) returns every known `email -> name`, cached
  client-side as `directory` and used by `staffLabel()` in `app.js` for
  "Verified by"/"Added by" on a card and the Team tab's Name column. An email
  with no name on file (nobody has logged in since this shipped, or the
  account was promoted by email before ever logging in) falls back to showing
  the email — the "for now, emails; names as people log in" transition happens
  automatically as each person answers the prompt, no manual list needed.
  `touchLogin()`/`touchActive()` (also in `src/users.ts`) keep `last_login_at`/
  `last_active_at` current for the Team tab's Last Active column; both are
  fire-and-forget (`c.executionCtx.waitUntil(...)`) so they never add latency
  to a request.
- **i18n (`en`/`hi`) lives entirely in `public/js/app.js`** as a static `I18N`
  dict. The backend/API is English/data-only, always: every value that travels
  or is stored — addition categories, correction sub-categories, deletion
  types, source-flag tags — stays English on the wire and in D1. Only the
  on-screen label is translated.
  **This reverses an earlier decision.** Official ECI category names used to be
  left in English in both languages, on the reasoning that mistranslating an
  official term is worse than not translating it. The owner asked for them
  translated (2026-08-18); a Hindi-speaking surveyor reading an English
  dropdown was the worse outcome in practice. Form numbers themselves
  ("Form 6", "Form 8") and identifiers ("EPIC", "CSV") still stay as-is.
  `VALUE_LABEL_KEY` in `app.js` maps stored value → translation key, and an
  unmapped value renders as itself rather than vanishing. **Adding a value to
  any of those lists in `src/records.ts` means adding it to `VALUE_LABEL_KEY`
  too, or it shows in English to a Hindi user.** The drill-down list names come
  from the server's `FILTER_TITLES` but are re-labelled client-side via
  `DRILL_TITLE_KEY` for the same reason.
  The bulk-reset confirmation phrase (`ERASE ALL FIELDWORK`) is deliberately
  **not** translated: it is compared against a literal string server-side, so a
  translated prompt would ask for a phrase the server rejects.

## File map

```
src/
  index.ts       Hono routes — thin, delegates to the modules below
  records.ts     search, currentUser()/roles, status updates, locking, additions, resetRecord
  team.ts        listStaff (sourced from `users` + admins/SUPER_ADMIN_EMAILS)/addAdmin/removeAdmin
  users.ts       the `users` table: name capture, directory, login/activity timestamps
  revisits.ts    flag-a-house-for-revisit CRUD — UI removed 2026-08-18, kept as a
                 /api/sync safety net only (see "Key design decisions")
  reports.ts     dashboard, part progress, daily activity, per-user summary
  exports.ts     CSV / ZIP-by-part / XLSX / full-database-dump generation
  filters.ts     shared WHERE-clause definitions for dashboard drill-down + exports
  xlsx.ts        hand-rolled XLSX writer (see "Key design decisions")
  house.ts       house-number tokenizer (typo-tolerant floor matching, range expansion)
  uploads.ts     R2 photo save/fetch, path-traversal-safe key validation
  broadcast.ts   BroadcastRoom Durable Object (staff + public rooms, WebSocket fanout)
  public_dashboard.ts  aggregate-only snapshot for /live/ (counts only — read its header)
public/
  index.html     page shell + all CSS, toast host, confirm/name-prompt modal host
  js/app.js      all UI logic, I18N dict, window.app.* handlers (largest file)
  js/public-dashboard.js  signed-out home view (counts only, no /api/* calls)
  js/api.js      API wrapper, online/offline decision, outbox sync loop
  js/store.js    IndexedDB (records/outbox/meta/revisits stores), offline search
  sw.js          service worker (see "Key design decisions")
migration_00{2,3,4,5,6}.sql   D1 migrations, applied in order, idempotent
                               (ADD COLUMN / CREATE TABLE IF NOT EXISTS)
schema.sql / seed_data.sql   base schema + original CSV import
backups/         pre-operation D1 exports — always add a new one before a risky write
```

## API surface (all under `/api`, see `src/index.ts` for exact bodies)

```
GET  /search /roll/snapshot /whoami /config /stats /dashboard /parts /records
GET  /elector/:id  /elector/:id/history
POST /elector  /elector/:id/status  /elector/:id/lock
POST /elector/:id/reset                 (any admin — "Delete entry")
PATCH /elector/:id/details              (Super Admin only)
GET  /house/:base
POST /sync                              (still accepts legacy op.type "revisit"/
                                          "revisit_resolve" — see "Key design decisions")
GET  /directory                         (email -> name, any signed-in user)
PATCH /me                               (set my own name)
GET  /admin/users                       PATCH /admin/users/:email   (Super Admin only)
GET  /admin/reset-preview  POST /admin/reset-all   (Super Admin only, bulk reset)
GET  /uploads/:key                      (R2 photo fetch)
GET  /events                            (WebSocket, live updates)
GET  /flags/duplicates  /flags/deleted
GET  /reports/daily  /reports/days  /me/summary
GET  /export/:kind  /export-database
```

`GET /records` additionally accepts `user` (email) and `date` (`YYYY-MM-DD`) to
narrow a drill-down to one person's work on one day — see "Per-user
drill-down" in "Key design decisions".

The standalone `GET/POST /revisits*` REST routes were removed on 2026-08-18
along with the Revisits tab. `POST /sync` still applies a queued
`"revisit"`/`"revisit_resolve"` op if an old client replays one — intentional,
see "Key design decisions".

Outside `/api`, and the only routes reachable without a login:

```
GET  /live/data      (aggregate JSON — counts only)
GET  /live/events    (WebSocket, sanitised live feed)
```

Plus `GET /api/signin` — gated, redirects to `/`, used by the sign-in button.

## Local development

```bash
npm install
npx wrangler dev            # local D1 + local dev server on :8787
npx wrangler dev --local    # explicit local D1 (default already local unless --remote given)
```

`wrangler dev` gets no `Cf-Access-Authenticated-User-Email` header, so you're
always "unknown"/anonymous locally — to test admin-gated behavior, `curl` with
`-H "Cf-Access-Authenticated-User-Email: someone@example.com"` against
`localhost:8787` directly rather than through the browser.

A `.claude/launch.json` exists for driving a browser preview of the local dev
server if your Claude Code setup supports it.

Type-check: `npx tsc --noEmit`. No test suite exists (`npm test` is a stub) —
verification has been manual: local `wrangler dev` + browser check + `curl`
against gated endpoints, every time, before deploying.

## Deploying

```bash
npx wrangler deploy
```

No CI/CD — this is a direct deploy from whoever's machine has `wrangler` logged
into the right account. Build and verify locally first; this project's working
pattern has been one comprehensive deploy at the end of a piece of work, not one
per small change.

## Data corrections already applied to production

A prior round of work applied 104 targeted single-column `UPDATE`s to fix a CSV
encoding bug from the original import (matched on `part_number` + `sr_no` +
`epic_id`, never a table rebuild — rebuilding would have destroyed live
field-survey work and orphaned `status_history`). Full pre-change backup is in
`backups/`. If you're investigating "why doesn't row X match the original roll
export," this is why — it was a deliberate, backed-up correction, not drift.
