-- Extends the Feb 2025 - Jun 2026 official roll update import
-- (migration_007.sql) with two things the owner asked for after reviewing
-- the first pass:
--
-- 1. source_unidentified_deletion: the 49 deletions from the update file
--    whose EPIC does not match anything in our roll. Name-only matching
--    against our existing voters was tried and rejected (common first
--    names produced multiple ambiguous candidates per part, and a wrong
--    match would falsely mark a real voter deleted) — instead these are
--    inserted as their own base-roll-shaped rows, tagged so the field team
--    can locate and resolve them in person rather than by name-guessing.
--
-- 2. *_month columns: the owner wants the CSV's Month/Year shown directly
--    on the card (not just buried in the notes history line) for both
--    additions and deletions. Only populated when the value comes from
--    this CSV import — a pre-existing source_deleted='Yes' row from the
--    original roll import has no CSV date and stays NULL here.
ALTER TABLE electors ADD COLUMN source_unidentified_deletion TEXT;
ALTER TABLE electors ADD COLUMN source_deleted_month TEXT;
ALTER TABLE electors ADD COLUMN source_added_update_month TEXT;
ALTER TABLE electors ADD COLUMN source_unidentified_deletion_month TEXT;
