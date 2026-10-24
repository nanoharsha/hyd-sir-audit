CREATE TABLE electors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_number TEXT,
    sr_no TEXT,
    house_number_raw TEXT,
    house_base TEXT,
    house_floor TEXT,
    house_range_end TEXT,
    epic_id TEXT,
    name TEXT,
    relation_type TEXT,
    relation_name TEXT,
    age TEXT,
    gender TEXT,
    source_deleted TEXT,
    source_flag TEXT,
    is_duplicate_epic INTEGER DEFAULT 0,
    added_in_field INTEGER DEFAULT 0,
    verification_status TEXT DEFAULT 'Not Started',
    sub_category TEXT,
    death_cert_collected INTEGER,
    form8_given TEXT,
    verified_by TEXT,
    verified_at TEXT,
    notes TEXT
);

CREATE TABLE status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    elector_id INTEGER,
    verification_status TEXT,
    sub_category TEXT,
    death_cert_collected INTEGER,
    form8_given TEXT,
    verified_by TEXT,
    verified_at TEXT,
    notes TEXT,
    FOREIGN KEY(elector_id) REFERENCES electors(id)
);

CREATE INDEX idx_house_base ON electors(house_base);
CREATE INDEX idx_epic ON electors(epic_id);
