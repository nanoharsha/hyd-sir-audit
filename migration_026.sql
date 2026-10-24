-- Okhla: possible duplicate entries. Two electors of the same household with the same name, age and gender but different EPICs
-- (e.g. one on the ASDD list and one on the Draft SIR roll: the same person listed twice on the 2025 roll). Stored both ways
-- round so either card can show the other. Additive and safe to re-run; run after migration_025.sql.
CREATE TABLE IF NOT EXISTS ok_twins (
  elector_id INTEGER NOT NULL,
  twin_id    INTEGER NOT NULL,
  PRIMARY KEY (elector_id, twin_id)
);
DELETE FROM ok_twins;
INSERT INTO ok_twins (elector_id, twin_id)
  SELECT a.id, b.id FROM ok_electors a JOIN ok_electors b
    ON b.hh_key = a.hh_key AND b.id <> a.id AND UPPER(TRIM(b.name)) = UPPER(TRIM(a.name)) AND b.age = a.age AND b.gender = a.gender
   AND COALESCE(b.epic_norm, '') <> COALESCE(a.epic_norm, '')
   WHERE a.in_2025_roll = 1 AND b.in_2025_roll = 1 AND a.age <> '' AND a.name <> '';
UPDATE ok_meta SET value = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE key = 'built_at';
