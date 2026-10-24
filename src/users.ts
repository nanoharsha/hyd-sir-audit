// Directory of every authenticated visitor: email -> display name, plus
// login/activity timestamps for the Team tab. Purely additive to the schema
// (see migration_006.sql) — nothing here reads or writes electors or
// status_history, so it cannot affect existing fieldwork.
//
// Three write paths, all upserts so a partial write never blanks a column
// the caller didn't touch:
//   touchLogin  — called once per app boot, from GET /api/whoami
//   touchActive — called from every mutating endpoint, so "last active"
//                 reflects real work, not just the login at 9am
//   setName     — called once from PATCH /api/me, the first time someone
//                 answers the name prompt

export async function touchLogin(db: D1Database, email: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (email, created_at, last_login_at, last_active_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         last_login_at = excluded.last_login_at,
         last_active_at = excluded.last_active_at`
    )
    .bind(email, now, now, now)
    .run();
}

export async function touchActive(db: D1Database, email: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (email, created_at, last_active_at)
       VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET last_active_at = excluded.last_active_at`
    )
    .bind(email, now, now)
    .run();
}

export async function setName(db: D1Database, email: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (email, name, created_at, last_login_at, last_active_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name,
         last_active_at = excluded.last_active_at`
    )
    .bind(email, name, now, now, now)
    .run();
}

export async function getName(db: D1Database, email: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT name FROM users WHERE email = ?")
    .bind(email)
    .first<{ name: string | null }>();
  return row?.name || null;
}

// Every known name, for resolving "verified_by"/"created_by_email" on a
// voter card to a person's name instead of their email. Not admin-gated:
// those email addresses are already visible to any signed-in staff member
// on every card, search result, and export — a name is no more sensitive
// than what is already shown everywhere.
export async function directory(db: D1Database): Promise<Record<string, string>> {
  const res = await db
    .prepare("SELECT email, name FROM users WHERE name IS NOT NULL AND name != ''")
    .all();
  const out: Record<string, string> = {};
  for (const r of res.results as any[]) out[r.email] = r.name;
  return out;
}
