-- Public Hearing Remarks — a case-tracking note against one voter, raised at
-- the SEARCH tab (src/comprehensive_search.ts). Two-stage, two different
-- people typically fill each stage:
--   Stage 1 (case_type + its sub-answers) -- "the person taking the complaint"
--   Stage 2 (root cause / BLO notified / possible solution / remarks) -- "anyone,
--   later" -- reopens the same case rather than creating a new one.
-- Isolated from electors/asddo/draft_sir: read-only lookups into those tables,
-- never written back to.

CREATE TABLE IF NOT EXISTS ph_remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_key TEXT NOT NULL UNIQUE,   -- epic_norm, or "elector:<id>" when no EPIC
  -- snapshot for display, taken at stage 1 (kept even if the source record changes)
  name TEXT,
  house_number_raw TEXT,
  part_number TEXT,
  epic_id TEXT,
  -- stage 1
  case_type TEXT,                  -- Wrong ASDD Marking | No SIR | SIR Correction Request
  sir_submitted TEXT,              -- Yes | No                      (case_type = No SIR)
  sir_submit_mode TEXT,            -- Online | Offline              (... and sir_submitted = Yes)
  sir_has_receipt TEXT,            -- Yes | No                      (... and sir_submitted = Yes)
  correction_fields TEXT,          -- JSON array of selected fields (case_type = SIR Correction Request)
  correction_other TEXT,           -- free text when "Other" is one of correction_fields
  stage1_by TEXT,
  stage1_at TEXT,
  -- stage 2 -- anyone, any time after stage 1
  root_cause TEXT,
  brought_to_blo TEXT,             -- Yes | No
  possible_solution TEXT,          -- Form 6 | Form 8 | Form 7 | Other
  possible_solution_other TEXT,
  remarks TEXT,
  stage2_by TEXT,
  stage2_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_phremarks_key ON ph_remarks(voter_key);
