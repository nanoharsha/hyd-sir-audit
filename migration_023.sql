-- Okhla public hearing: one token per elector who comes to the hearing (PH-K1, PH-G1, PH-R-01, PH-MISC-01).
-- Additive; run once after migration_022.sql. The elector's details are copied into the row so a token stays
-- readable even if the roll is ever reloaded. Two unique indexes keep it honest: one token per elector, and
-- one sequence number per block (two desks issuing at the same moment can never get the same number).
CREATE TABLE IF NOT EXISTS ok_hearing (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT    NOT NULL UNIQUE,   -- what is shown and called out, e.g. PH-K12
  block_key     TEXT    NOT NULL,          -- the block letter, or MISC when the elector has no block
  seq           INTEGER NOT NULL,          -- 1, 2, 3 ... within block_key
  elector_id    INTEGER NOT NULL,          -- ok_electors.id
  epic_id       TEXT,
  name          TEXT,
  relation_type TEXT,
  relation_name TEXT,
  age           TEXT,
  gender        TEXT,
  house_raw     TEXT,
  house_floor   TEXT,
  old_part      INTEGER,
  new_part      INTEGER,
  block         TEXT,
  status        TEXT,                      -- the elector's SIR tag when the token was issued
  status_detail TEXT,
  phone         TEXT    NOT NULL,          -- 10 digits
  category      TEXT    NOT NULL,          -- deleted | notice | first_time
  issued_by     TEXT,
  issued_at     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_okh_block_seq ON ok_hearing(block_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_okh_elector   ON ok_hearing(elector_id);
