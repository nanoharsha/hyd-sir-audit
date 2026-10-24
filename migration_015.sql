-- Public Hearing participation flow (owner request, 2026-09-05). Adds the
-- fields for the new "Public Hearing Participation" branch (Testimony /
-- Support / Assistance / Other) on top of the existing case_type. Additive
-- only, per project convention.
--
-- root_cause, brought_to_blo and remarks already existed (migration_013) and
-- are reused with new meanings/labels rather than renamed:
--   root_cause -> "Description of the Issue", now captured in Stage 1 for a
--                 Testimony case (was a Stage-2-only field before).
--   brought_to_blo -> unchanged, now only asked when knows_blo = 'Yes'.
--   remarks -> "Other Remarks" on the Testimony follow-up, or the sole field
--              on an "Other" participation case — never both on one case.
-- possible_solution / possible_solution_other (migration_013) are no longer
-- written by the app; left in place, unused, rather than dropped.
ALTER TABLE ph_remarks ADD COLUMN participation_type TEXT;   -- Testimony | Support / Assistance | Other
ALTER TABLE ph_remarks ADD COLUMN phone TEXT;                -- mandatory 10-digit contact, taken at Stage 1
ALTER TABLE ph_remarks ADD COLUMN knows_blo TEXT;            -- Yes | No. Testimony: asked in stage 2.
                                                              -- Support / Assistance: asked in stage 1
                                                              -- instead (that branch has no stage 2).
ALTER TABLE ph_remarks ADD COLUMN support_type TEXT;         -- Form 6 - Self Filling | Form 6 - Assisted | Other
ALTER TABLE ph_remarks ADD COLUMN photo_key TEXT;            -- R2 key, Testimony follow-up photo (optional)
