-- PH FOLLOW UP tab — a post-hearing follow-up note against one voter.
-- Deliberately a SEPARATE table from ph_remarks, not new columns on it:
-- ph_remarks is the Public Hearing case register (case_id, case_type,
-- participation_type...) and its row count is read elsewhere as "how many
-- cases came to the hearing" (reports, the Tribunal numbers). Follow-up is a
-- broader net — "for any voter" per the owner's request, not only people who
-- filed a case — so writing follow-up answers into ph_remarks would silently
-- inflate the case count for someone who was never at the hearing. Isolated
-- from electors/asddo/draft_sir/ph_remarks: read-only lookups into them,
-- never written back.
--
-- One row per voter followed up with. voter_key uses the same convention as
-- ph_remarks.voter_key (epic_norm, or "elector:<id>" when no EPIC), so a
-- follow-up note and a Public Hearing case for the same person share a key
-- without a join table. name/house_number_raw/part_number/epic_id are a
-- snapshot taken at save time (kept even if the source record changes),
-- mirroring ph_remarks so this table can render its own part/house list
-- without a live join back to electors/asddo/draft_sir.

CREATE TABLE IF NOT EXISTS ph_followup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_key TEXT NOT NULL UNIQUE,
  name TEXT,
  house_number_raw TEXT,
  part_number TEXT,
  epic_id TEXT,
  blo_contacted TEXT,      -- Yes | No — "Has the BLO contacted you?"
  form6_submitted TEXT,    -- Yes | No — "Have you submitted your Form 6?" (Yes closes the case)
  form6_assistance TEXT,   -- Yes | No — "Do you need assistance submitting Form 6?" (only asked/stored when form6_submitted = 'No')
  notice_received TEXT,    -- Yes | No — "Have you received a notice?"
  updated_by TEXT,
  updated_at TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ph_followup_key  ON ph_followup(voter_key);
CREATE INDEX IF NOT EXISTS idx_ph_followup_part ON ph_followup(part_number);
