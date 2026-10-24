-- Backs the Feb 2025 - Jun 2026 official roll update import (deletions,
-- modifications, additions supplied by the project owner as a CSV of
-- Part No / Serial No / EPIC / Name / Month / Year / Form Type, matched
-- into our roll by EPIC ID). Existing "deleted in source roll" tagging
-- (source_deleted) already covers deletions with no schema change needed;
-- these two columns cover the other two categories the same way.
--
-- source_modified: 'Yes' when the official roll recorded a correction
-- (Form 8-equivalent) against this voter that we have no field-level
-- detail on — surfaced as a card badge and its own dashboard drill-down,
-- same shape as deleted_in_source.
--
-- source_added_update: 'Yes' for a voter who came from this roll update
-- rather than the original import, and therefore has no house number yet
-- (the update file carries no address at all) — surfaces as its own
-- drill-down tab so the field team can find and complete these records
-- rather than expecting them to turn up in an ordinary house search.
ALTER TABLE electors ADD COLUMN source_modified TEXT;
ALTER TABLE electors ADD COLUMN source_added_update TEXT;
