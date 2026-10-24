-- Okhla public hearing, exit desk: what happened at the hearing for an elector who holds a token (migration_023.sql).
-- Additive; run once after migration_023.sql. The latest answers live on the ok_hearing row (editable any time);
-- every save is also appended to ok_hearing_exit_log so earlier answers are never lost.
ALTER TABLE ok_hearing ADD COLUMN exit_testimony TEXT;   -- yes | no
ALTER TABLE ok_hearing ADD COLUMN exit_status    TEXT;   -- comma-separated: form6_filled,form6_submitted,ack_received,notice_help,first_time_form6
ALTER TABLE ok_hearing ADD COLUMN exit_remarks   TEXT;
ALTER TABLE ok_hearing ADD COLUMN exit_by        TEXT;   -- who saved it last
ALTER TABLE ok_hearing ADD COLUMN exit_at        TEXT;   -- when it was last saved
CREATE TABLE IF NOT EXISTS ok_hearing_exit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  elector_id  INTEGER NOT NULL,
  token       TEXT    NOT NULL,
  testimony   TEXT,
  status      TEXT,
  remarks     TEXT,
  saved_by    TEXT,
  saved_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_okhexit_elector ON ok_hearing_exit_log(elector_id);
