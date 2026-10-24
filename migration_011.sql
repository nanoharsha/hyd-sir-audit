-- Draft SIR 2026 reverification round ("Camp cum Jan Sunwai"), second list.
-- Same shape as `asddo` (migration_010.sql) so src/worklist.ts drives both.
-- Isolated from `electors`.
--
-- One row per Draft SIR entry (5,639, in_draft = 1) PLUS the base-roll voters
-- who *should* be in the draft but are not (1,008, in_draft = 0) — so search
-- covers "am I in the draft roll?" for everyone and the worklist tiles have a
-- home. House/part and the "what we already found" snapshot are joined from
-- `electors` at import (docs/draftsir/draftsir_import.sql). tile is frozen —
-- our field verification for that round is complete.

CREATE TABLE IF NOT EXISTS draft_sir (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  in_draft INTEGER DEFAULT 1,   -- 1 = a published Draft SIR row; 0 = a "missing from the draft" worklist row
  old_sr TEXT,                   -- draft serial number (NULL for in_draft = 0)
  old_part TEXT,                 -- 119-126, from the base-roll match / elector (NULL when not in our roll)
  new_part TEXT,                 -- 122-129
  epic_id TEXT,
  epic_norm TEXT,               -- UPPER(REPLACE(epic,' ','')) — join + search key
  name TEXT,
  relation_type TEXT,
  relation_name TEXT,
  age TEXT,
  gender TEXT,
  -- joined from electors at import (NULL when not in our base roll)
  base_elector_id INTEGER,
  house_number_raw TEXT,
  house_base TEXT,
  house_base_num INTEGER,
  house_floor TEXT,
  house_range_end TEXT,
  house_range_end_num INTEGER,
  -- frozen snapshot of our completed field verification
  prior_status TEXT,
  prior_sub TEXT,
  prior_note TEXT,
  prior_by TEXT,
  prior_at TEXT,
  -- worklist classification (no confirmed/double-check split for this list)
  tile TEXT,                    -- dead | not_in_base | verified | pending | addition | NULL
  segment TEXT,                 -- always '' here; kept for column-parity with asddo
  dc_subtag TEXT,
  dc_why TEXT,
  -- reverification (this round)
  re_status TEXT DEFAULT 'Not Started',
  re_outcome TEXT,
  sir_form TEXT,               -- Yes | No | Submitted Online
  voted_2025 TEXT,             -- unused for this list; column-parity
  moved_here_recently TEXT,    -- "were you a voter elsewhere and recently moved here?" (not_in_base tile)
  contact_phone TEXT,
  jan_sunwai TEXT,             -- Will participate | Will speak | No
  re_photo_key TEXT,
  re_notes TEXT,
  re_verified_by TEXT,
  re_verified_at TEXT,
  locked_at TEXT,
  locked_by_email TEXT,
  updated_by_email TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_draftsir_epic     ON draft_sir(epic_norm);
CREATE INDEX IF NOT EXISTS idx_draftsir_house    ON draft_sir(house_base);
CREATE INDEX IF NOT EXISTS idx_draftsir_housenum ON draft_sir(house_base_num);
CREATE INDEX IF NOT EXISTS idx_draftsir_oldpart  ON draft_sir(old_part);
CREATE INDEX IF NOT EXISTS idx_draftsir_tile     ON draft_sir(tile);

CREATE TABLE IF NOT EXISTS draft_sir_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_sir_id INTEGER,
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
  action TEXT,
  FOREIGN KEY(draft_sir_id) REFERENCES draft_sir(id)
);

CREATE INDEX IF NOT EXISTS idx_draftsir_hist ON draft_sir_history(draft_sir_id);
