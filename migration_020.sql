-- Okhla field verification — ASDD electors (first form; Deleted / Notice forms follow).
-- Isolated from `electors` and from the ok_electors register: the register can be rebuilt
-- (ids shift when more data loads), so answers are keyed by EPIC, never by row id.
-- One current row per voter + an append-only history of every save. Additive, run once.

CREATE TABLE IF NOT EXISTS ok_verification (
  voter_key TEXT PRIMARY KEY,        -- epic_norm of the elector verified
  form_type TEXT NOT NULL DEFAULT 'asdd',
  -- snapshot of the tag at the time of the visit (kept even if the register changes)
  epic_id TEXT,
  name TEXT,
  house_raw TEXT,
  old_part INTEGER,
  new_part INTEGER,
  tagged_status TEXT,
  tagged_detail TEXT,
  -- the visit
  asdd_correct TEXT,                 -- yes | no | unable
  wrong_reason TEXT,                 -- shifted | dead | absent | duplicate   (asdd_correct = no)
  enum_form TEXT,                    -- yes | not_received_from_blo | not_generated | blo_did_not_collect | other
  form6_submitted TEXT,              -- yes | no
  needs_assistance TEXT,             -- yes | no                               (form6_submitted = no)
  form6_given TEXT,                  -- yes | no  Form 6 handed over + guidance explained (needs_assistance = yes)
  phone TEXT,                        -- mandatory, 10 digits
  remarks TEXT,                      -- mandatory when enum_form = other
  verified_by TEXT,
  verified_at TEXT,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ok_verification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_key TEXT NOT NULL,
  asdd_correct TEXT,
  wrong_reason TEXT,
  enum_form TEXT,
  form6_submitted TEXT,
  needs_assistance TEXT,
  form6_given TEXT,
  phone TEXT,
  remarks TEXT,
  saved_by TEXT,
  saved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ok_vhist_key ON ok_verification_history(voter_key);
