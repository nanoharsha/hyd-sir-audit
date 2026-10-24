-- Every authenticated visitor, captured on login. Purely additive: no
-- column on electors/status_history changes, and this table starts empty
-- for everyone, including staff who already have real fieldwork on file.
--
-- Powers three things:
--   * the "Verified by / Added by" name shown on a voter card (falls back
--     to email until that person has logged in once after this ships)
--   * the Team tab's Name / Email / Last Active listing
--   * accountability: every crucial action traces to a real person, not
--     just an email address (name capture flow: requestNameIfMissing() in
--     public/js/app.js, POST via PATCH /api/me)
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    last_active_at TEXT
);
