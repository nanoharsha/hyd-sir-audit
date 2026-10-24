-- Photo storage for death certificates (Deletion sub-category)
ALTER TABLE electors ADD COLUMN death_cert_file TEXT;
ALTER TABLE status_history ADD COLUMN death_cert_file TEXT;

-- Coordinator role, DB-backed instead of the ADMIN_EMAILS env var, so it can
-- be managed from the Team screen without a redeploy.
CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    added_by TEXT,
    added_at TEXT NOT NULL
);

-- Households a surveyor could not survey: locked house, nobody in, etc.
-- A personal follow-up list, not part of the verification record itself.
CREATE TABLE IF NOT EXISTS revisits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT UNIQUE,
    user_email TEXT NOT NULL,
    part_number TEXT,
    house_number_raw TEXT NOT NULL,
    house_base TEXT,
    house_base_num INTEGER,
    reason TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    client_time TEXT,
    resolved_at TEXT,
    resolved_by_email TEXT,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_revisits_house_base ON revisits(house_base);
CREATE INDEX IF NOT EXISTS idx_revisits_open ON revisits(resolved_at);
