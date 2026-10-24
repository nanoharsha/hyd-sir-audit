-- ASDD List reverification — a self-contained dataset for the "Camp cum Jan
-- Sunwai" round. Isolated from `electors`: the ASDD List is the ERO's own
-- removal list (2,814 entries across old parts 119-126, renumbered 122-129),
-- and this exercise re-checks the ~1,122 entries our field verification
-- contradicts. The main roll, its dashboard and its exports are untouched.
--
-- One row per ASDD List entry. House/address and the "what we already found"
-- snapshot are joined in from `electors` by normalised EPIC at import time
-- (docs/asddo_list/asddo_import.sql). Entries not in our base roll (25) carry
-- no house. Tile / segment / dc_subtag are precomputed with the same rules as
-- docs/asddo_anomalies/ — frozen, since our field verification for that round
-- is complete.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN guards are unnecessary
-- here because this file only ever creates. Re-running it is a no-op.

CREATE TABLE IF NOT EXISTS asddo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ASDD List identity
  s_no TEXT,
  old_part TEXT,
  old_sr TEXT,
  new_part TEXT,
  epic_id TEXT,
  epic_norm TEXT,              -- UPPER(REPLACE(epic,' ','')) — join + search key
  name TEXT,
  relation_type TEXT,
  relation_name TEXT,
  age TEXT,
  gender TEXT,
  asddo_reason TEXT,          -- Death | Permanently Shifted | Untraceable/Absent | Already enrolled
  -- joined from electors at import (NULL when not in our base roll)
  base_elector_id INTEGER,
  house_number_raw TEXT,
  house_base TEXT,
  house_base_num INTEGER,
  house_floor TEXT,
  house_range_end TEXT,
  house_range_end_num INTEGER,
  -- frozen snapshot of our completed field verification, shown for context
  prior_status TEXT,
  prior_sub TEXT,
  prior_note TEXT,
  prior_by TEXT,
  prior_at TEXT,
  -- precomputed worklist classification
  tile TEXT,                  -- dead | pshift | absent | enrolled | notbase | NULL (we agree / not verified)
  segment TEXT,               -- confirmed | doublecheck | '' (notbase)
  dc_subtag TEXT,             -- double-check sub-group label
  dc_why TEXT,                -- the reason text behind the sub-group
  -- reverification (this round) — all NULL until a surveyor records it
  re_status TEXT DEFAULT 'Not Started',   -- Not Started | Done
  re_outcome TEXT,           -- category-specific: Alive/Dead, Present at the address/Permanently Shifted, ...
  sir_form TEXT,             -- Yes | No | Submitted Online
  voted_2025 TEXT,           -- Yes | No
  moved_here_recently TEXT,  -- Yes | No  (notbase category only)
  contact_phone TEXT,
  jan_sunwai TEXT,           -- Will participate | Will speak | No
  re_photo_key TEXT,         -- R2 object key
  re_notes TEXT,
  re_verified_by TEXT,
  re_verified_at TEXT,
  locked_at TEXT,
  locked_by_email TEXT,
  updated_by_email TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_asddo_epic     ON asddo(epic_norm);
CREATE INDEX IF NOT EXISTS idx_asddo_house    ON asddo(house_base);
CREATE INDEX IF NOT EXISTS idx_asddo_housenum ON asddo(house_base_num);
CREATE INDEX IF NOT EXISTS idx_asddo_oldpart  ON asddo(old_part);
CREATE INDEX IF NOT EXISTS idx_asddo_tile     ON asddo(tile);

CREATE TABLE IF NOT EXISTS asddo_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asddo_id INTEGER,
  re_status TEXT,
  re_outcome TEXT,
  sir_form TEXT,
  voted_2025 TEXT,
  moved_here_recently TEXT,
  contact_phone TEXT,
  jan_sunwai TEXT,
  re_photo_key TEXT,
  re_notes TEXT,
  re_verified_by TEXT,
  re_verified_at TEXT,
  user_email TEXT,
  op_id TEXT,
  client_time TEXT,
  action TEXT,               -- verify | correct
  FOREIGN KEY(asddo_id) REFERENCES asddo(id)
);

CREATE INDEX IF NOT EXISTS idx_asddo_hist ON asddo_history(asddo_id);
