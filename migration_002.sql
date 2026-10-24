ALTER TABLE electors ADD COLUMN house_base_num INTEGER;
ALTER TABLE electors ADD COLUMN house_range_end_num INTEGER;
ALTER TABLE electors ADD COLUMN created_by_email TEXT;
ALTER TABLE electors ADD COLUMN created_at TEXT;
ALTER TABLE electors ADD COLUMN updated_by_email TEXT;
ALTER TABLE electors ADD COLUMN updated_at TEXT;
ALTER TABLE electors ADD COLUMN locked_at TEXT;
ALTER TABLE electors ADD COLUMN locked_by_email TEXT;

ALTER TABLE status_history ADD COLUMN user_email TEXT;
ALTER TABLE status_history ADD COLUMN op_id TEXT;
ALTER TABLE status_history ADD COLUMN client_time TEXT;
ALTER TABLE status_history ADD COLUMN is_override INTEGER DEFAULT 0;
ALTER TABLE status_history ADD COLUMN action TEXT;

CREATE TABLE IF NOT EXISTS sync_ops (
    op_id TEXT PRIMARY KEY,
    user_email TEXT,
    op_type TEXT,
    elector_id INTEGER,
    client_time TEXT,
    received_at TEXT,
    status TEXT,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_house_base_num ON electors(house_base_num);
CREATE INDEX IF NOT EXISTS idx_locked_at ON electors(locked_at);
CREATE INDEX IF NOT EXISTS idx_part_number ON electors(part_number);
