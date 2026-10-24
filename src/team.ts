// Coordinator/staff management. We have no login system of our own
// (Cloudflare Access handles identity), so "the team" is every email in the
// `users` table (anyone who has ever loaded the app since migration_006),
// plus whoever's in the `admins` table, plus whoever is a super admin via
// the SUPER_ADMIN_EMAILS env var — the last two in case someone was
// promoted by email before they ever logged in.
//
// Previously this also computed verification/addition/deletion/correction
// counts per person. Dropped deliberately (2026-08-18, at the owner's
// request): those numbers duplicate what the Dashboard's Daily Activity
// table already shows, per day and now drillable per person (see
// DRILL_TITLE_KEY / loadDailyActivity in app.js) — the Team tab's job is
// now just "who is on the team and when were they last active".
export async function listStaff(db: D1Database, superAdminEmails: string[]) {
  const superSet = new Set(superAdminEmails);

  const admins = await db.prepare("SELECT email FROM admins").all();
  const adminSet = new Set((admins.results as any[]).map((r) => r.email));
  for (const email of superSet) adminSet.delete(email); // super admin, not a plain coordinator row

  const users = await db.prepare("SELECT email, name, last_login_at, last_active_at FROM users").all();
  const byEmail: Record<string, any> = {};
  for (const r of users.results as any[]) byEmail[r.email] = r;

  const allEmails = new Set(Object.keys(byEmail));
  for (const email of superSet) allEmails.add(email);
  for (const email of adminSet) allEmails.add(email);

  return Array.from(allEmails)
    .sort()
    .map((email) => {
      const u = byEmail[email] || {};
      const role = superSet.has(email) ? "super_admin" : adminSet.has(email) ? "coordinator" : "staff";
      return {
        email,
        name: u.name || null,
        role,
        // Whichever is more recent: a login can happen without any activity
        // that day, and activity (from a queued offline op syncing later)
        // can post after the login that originated it.
        last_active: [u.last_active_at, u.last_login_at].filter(Boolean).sort().pop() || null,
      };
    });
}

export async function addAdmin(db: D1Database, email: string, addedBy: string) {
  await db
    .prepare("INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?,?,?)")
    .bind(email.toLowerCase(), addedBy, new Date().toISOString())
    .run();
}

export async function removeAdmin(db: D1Database, email: string) {
  await db.prepare("DELETE FROM admins WHERE email = ?").bind(email.toLowerCase()).run();
}
