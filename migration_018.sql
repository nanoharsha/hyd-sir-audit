-- Okhla (AC 54) household-level SIR status register — read-only for now.
-- One row per elector in the Jan-2025 final roll (386,283 rows, 279 old parts),
-- each tagged with where the SIR 2026 process put them: NOTICE / ASDD /
-- DELETED / CLEARED / NO_SIR, or PENDING when we do not yet hold the Draft
-- SIR roll for that voter's part (so CLEARED vs NO_SIR cannot be decided).
-- Entirely isolated from `electors` (Mangolpuri): different tables, never joined.
-- Built by okhla_import/build_okhla.py from the audit pack + our own processed
-- ASDD / notice / draft-roll files. No verification fields yet (owner request).
--
-- Additive, run once (same style as migration_004).

CREATE TABLE IF NOT EXISTS ok_electors (
  id INTEGER PRIMARY KEY,
  old_part INTEGER,            -- 2025 roll part (1-279)
  serial_2025 INTEGER,
  section_no TEXT,
  section_name TEXT,           -- block / locality as printed in the 2025 roll
  house_raw TEXT,              -- house number exactly as printed
  hh_norm TEXT,                -- normalised house: floors/locality text stripped, upper-case, alnum + "/" only
  hh_key TEXT,                 -- old_part|section_no|hh_norm  — the household
  hh_sort TEXT,                -- hh_norm with digit runs zero-padded, so F9 sorts before F10
  house_floor TEXT,            -- Ground | First | Second | Third | Fourth | NULL
  supplement INTEGER DEFAULT 0, -- 1 = added in the Jan-2025 supplement pages (printed after the last block)
  epic_id TEXT,
  epic_norm TEXT,
  name TEXT,
  name_upper TEXT,
  relation_type TEXT,
  relation_name TEXT,
  age TEXT,
  gender TEXT,                 -- Male | Female | '' (unreadable in the OCR)
  status TEXT,                 -- NOTICE | ASDD | DELETED | CLEARED | NO_SIR | PENDING | UNLINKED
  status_detail TEXT,          -- ASDD reason / notice type + reason / deletion reason
  deleted_source TEXT,         -- roll_stamp | monthly | NULL
  deleted_reason TEXT,         -- Shifted | Repeated (duplicate) | ... | NULL when not published
  deleted_month TEXT,          -- YYYY-MM (monthly deletions) or NULL
  conflict TEXT,               -- human-readable flag when two sources disagree, else NULL
  new_part INTEGER,            -- SIR 2026 part
  new_part_src TEXT,           -- exact (printed on a SIR list) | estimated | NULL
  draft_serial TEXT,           -- serial in the Draft SIR roll / notice list when known
  in_2025_roll INTEGER DEFAULT 1, -- 0 = not in the Jan-2025 roll: added since (monthly list) or found only on a SIR list
  added_month TEXT,            -- YYYY-MM of the monthly addition list, when known
  name_partial INTEGER DEFAULT 0, -- 1 = name is only the first 10 letters (monthly lists print no more)
  source TEXT,                 -- for in_2025_roll = 0: which lists this elector appears on
  draft_basis TEXT             -- CLEARED only: draft = seen in the Draft SIR roll we hold | assumed = draft roll for the part not loaded
);
CREATE INDEX IF NOT EXISTS idx_ok_epic   ON ok_electors(epic_norm);
CREATE INDEX IF NOT EXISTS idx_ok_hh     ON ok_electors(old_part, hh_norm);
CREATE INDEX IF NOT EXISTS idx_ok_hhkey  ON ok_electors(hh_key);
CREATE INDEX IF NOT EXISTS idx_ok_part_sort ON ok_electors(old_part, hh_sort);
CREATE INDEX IF NOT EXISTS idx_ok_status ON ok_electors(status, old_part);

-- Name search without a LIKE '%x%' scan of 386k rows: one row per name word.
CREATE TABLE IF NOT EXISTS ok_tokens (
  token TEXT NOT NULL,
  elector_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ok_token ON ok_tokens(token);

-- One row per old part: label, localities, which new parts it feeds, and
-- whether the Draft SIR roll for it is loaded.
CREATE TABLE IF NOT EXISTS ok_parts (
  old_part INTEGER PRIMARY KEY,
  label TEXT,
  localities TEXT,
  new_parts TEXT,
  draft_available INTEGER DEFAULT 0,
  electors INTEGER
);

-- Pre-aggregated counts so the summary tiles never scan the roll.
CREATE TABLE IF NOT EXISTS ok_part_status (
  old_part INTEGER,
  status TEXT,
  n INTEGER,
  PRIMARY KEY (old_part, status)
);

-- Per old part: the pieces behind the two dashboard headlines.
--   base roll total = roll_2025 + monthly_added - monthly_deleted
--   draft total     = draft_total (NOTICE + CLEARED), of which draft_added are not in the 2025 roll
CREATE TABLE IF NOT EXISTS ok_part_base (
  old_part INTEGER PRIMARY KEY,
  roll_2025 INTEGER,           -- 2025 roll electors not struck off inside that roll
  struck_off_2025 INTEGER,
  monthly_added INTEGER,       -- electors not in the 2025 roll (monthly additions + SIR-list-only)
  monthly_deleted INTEGER,     -- removed by a monthly deletion list (from the roll or the additions)
  draft_total INTEGER,
  draft_added INTEGER
);

CREATE TABLE IF NOT EXISTS ok_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
