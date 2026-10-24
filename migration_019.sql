-- Okhla: a voter whose EPIC was re-issued appears twice across the source files
-- (old EPIC in the 2025 roll, new EPIC on the ASDD list). The 2025-roll row keeps the
-- person; `alt_epic_norm` records the other EPIC so searching either one finds them.
-- Additive, run once (after migration_018.sql).
ALTER TABLE ok_electors ADD COLUMN alt_epic_norm TEXT;
CREATE INDEX IF NOT EXISTS idx_ok_alt_epic ON ok_electors(alt_epic_norm);
