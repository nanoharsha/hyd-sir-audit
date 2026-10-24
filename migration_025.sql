-- Okhla: what changed on each elector's record since the Jan-2025 roll (name / age / gender / relative / house on the
-- Draft SIR roll, and the monthly modification lists). One row per elector with at least one change. Additive; run
-- once after migration_024.sql, then load the rows with okhla_import/draft_changes.py. ok_electors keeps the 2025
-- values; the app shows d_name as the latest name and lists every change on the card.
CREATE TABLE IF NOT EXISTS ok_changes (
  elector_id      INTEGER PRIMARY KEY,   -- ok_electors.id
  fields          TEXT,                  -- comma list of what differs on the draft: name,age,gender,relative,house
  d_name          TEXT,                  -- as printed on the Draft SIR roll
  d_age           TEXT,
  d_gender        TEXT,
  d_relation_name TEXT,
  d_house         TEXT,
  modified_in     TEXT                   -- monthly modification lists, e.g. 2025-12;2026-03
);
