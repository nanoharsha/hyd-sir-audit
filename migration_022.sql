-- Okhla: block letter per elector + a small list of blocks, so a house search can be limited to one block
-- (K-78 in block K, never G-78 in block G). Additive; run once after migration_021.sql.
ALTER TABLE ok_electors ADD COLUMN block TEXT;
CREATE INDEX IF NOT EXISTS idx_ok_block_hh ON ok_electors(block, hh_norm);
CREATE INDEX IF NOT EXISTS idx_ok_hhnorm   ON ok_electors(hh_norm);
CREATE TABLE IF NOT EXISTS ok_blocks (
  old_part INTEGER NOT NULL,
  block    TEXT    NOT NULL,      -- the block letter, e.g. K
  label    TEXT,                  -- the section name as printed, e.g. BLOCK- K  BATLA HOUSE
  electors INTEGER,
  PRIMARY KEY (old_part, block)
);
