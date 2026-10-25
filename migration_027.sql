-- Reason sub-filters, and the two new verification forms (SIR Cleared, NO SIR).
-- Additive and safe to re-run. Run once after migration_026.sql.
--
-- 1. ok_elector_reasons
--    One row per elector PER REASON. The official notice list gives some electors
--    two reasons in one comma-joined string ("Parent Age Difference <15,Parent
--    Name Mismatch"): 23 electors in the Secunderabad load. Splitting them means
--    a surveyor filtering on "Parent Name Mismatch" finds all 100, not just the
--    86 whose notice says nothing else — which is the whole point of letting the
--    team prioritise. Built by hyd_import/build_hyd.py, never edited by hand.
--
--    Consequence worth knowing before anyone reads these as a total: an elector
--    with two reasons is counted under both, so the per-reason counts sum to MORE
--    than the number of electors (973 vs 950 notices in the current load).
--
--    Substring matching on ok_electors.status_detail was the alternative and is
--    a trap: the real data contains both "Parent Age Difference <15" and
--    "Parent Age difference >50", which differ only in case and operator.

CREATE TABLE IF NOT EXISTS ok_elector_reasons (
  elector_id INTEGER NOT NULL,
  status     TEXT    NOT NULL,   -- ASDD | NOTICE — which list the reason came from
  reason     TEXT    NOT NULL,   -- one reason, already trimmed; never a comma-joined pair
  PRIMARY KEY (elector_id, status, reason)
);
CREATE INDEX IF NOT EXISTS idx_ok_reason        ON ok_elector_reasons(status, reason);
CREATE INDEX IF NOT EXISTS idx_ok_reason_elector ON ok_elector_reasons(elector_id);

-- 2. Two more verification forms.
--    Until now a form existed only for ASDD / NOTICE / DELETED, so a CLEARED or
--    NO_SIR elector was on nobody's worklist. The team asked for both, which
--    takes the focus-area worklist from 1,216 electors to about 1,839.
--
--    SIR Cleared — the voter survived the revision, but their entry may still be
--    wrong. cl_corrections is a comma-joined list of the fields that need fixing
--    (name, dob_age, gender, photo, relative_name, relation_type, address), or
--    'none'. A correction means a Form 8, so cl_form8 records whether it is in.
ALTER TABLE ok_verification ADD COLUMN cl_corrections TEXT;
ALTER TABLE ok_verification ADD COLUMN cl_form8 TEXT;        -- yes | no

--    NO SIR — in the 2025 roll, absent from the draft, with no ASD-D entry and no
--    notice. The most serious case: removed with no published reason. The form
--    establishes what the elector can still prove and whether they have re-applied.
ALTER TABLE ok_verification ADD COLUMN ns_has_id TEXT;       -- yes | no  (holds a voter ID copy)
ALTER TABLE ok_verification ADD COLUMN ns_epic_text TEXT;    -- EPIC as the elector reads it out; not trusted as a key
ALTER TABLE ok_verification ADD COLUMN ns_last_voted TEXT;   -- free text: "2023 assembly", "never", ...

--    Shared by the Form 6 flows (NO SIR now, new-voter additions later).
--    form6_mode replaces the plain yes/no the ASDD form used, because "submitted
--    online" and "submitted on paper" need different follow-up.
ALTER TABLE ok_verification ADD COLUMN form6_mode TEXT;      -- online | offline | both | no
ALTER TABLE ok_verification ADD COLUMN ack_no TEXT;          -- acknowledgement number, when the elector has it

--    Uploads. One photo per record was the old limit; the team needs several
--    (Form 6 alone asks for a photo, ID proof, address proof and a reference).
--    A JSON array of R2 keys, so the count can differ per form without another
--    schema change. PDFs are allowed here too — see src/uploads.ts.
ALTER TABLE ok_verification ADD COLUMN doc_keys TEXT;        -- JSON array of R2 keys

-- 3. The same columns on the history table, so a saved form can always be replayed.
ALTER TABLE ok_verification_history ADD COLUMN cl_corrections TEXT;
ALTER TABLE ok_verification_history ADD COLUMN cl_form8 TEXT;
ALTER TABLE ok_verification_history ADD COLUMN ns_has_id TEXT;
ALTER TABLE ok_verification_history ADD COLUMN ns_epic_text TEXT;
ALTER TABLE ok_verification_history ADD COLUMN ns_last_voted TEXT;
ALTER TABLE ok_verification_history ADD COLUMN form6_mode TEXT;
ALTER TABLE ok_verification_history ADD COLUMN ack_no TEXT;
ALTER TABLE ok_verification_history ADD COLUMN doc_keys TEXT;
