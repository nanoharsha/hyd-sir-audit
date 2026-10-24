-- Case ID for Public Hearing Remarks — a short human-shareable reference
-- (PH-00001, ...) generated once when a case is first opened (stage 1),
-- so a voter can be handed one slip of paper that later resolves their
-- entire history for that EPIC. See src/comprehensive_search.ts.
ALTER TABLE ph_remarks ADD COLUMN case_id TEXT;
CREATE INDEX IF NOT EXISTS idx_phremarks_caseid ON ph_remarks(case_id);
