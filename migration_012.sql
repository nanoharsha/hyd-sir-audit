-- Per-field reverification photos for the ASDD List + Draft SIR 2026 rounds.
--
-- Until now each reverification carried a single `re_photo_key`. Field verifiers
-- asked for a photo per follow-up question ("photo of the SIR slip", "photo of
-- the house", ...), so we move to a JSON map:
--
--   re_photos = { "<slot>": ["<r2 key>", ...], ... }
--   slot ∈ outcome | sir | voted | moved | jan     (see src/worklist.ts SLOTS)
--
-- R2 keys are "<prefix><id>/<slot>/<uuid>.<ext>" (src/uploads.ts). The old
-- `re_photo_key` column is retired, not dropped — no production reverification
-- data exists yet (0 history rows on both lists at the time of this migration),
-- so there is nothing to backfill. SQLite cannot drop a column without a table
-- rebuild, and a rebuild would orphan history, so it stays, unused.
--
-- Additive, run once (matches migration_004 style — no ADD COLUMN guards).

ALTER TABLE asddo             ADD COLUMN re_photos TEXT;
ALTER TABLE asddo_history     ADD COLUMN re_photos TEXT;
ALTER TABLE draft_sir         ADD COLUMN re_photos TEXT;
ALTER TABLE draft_sir_history ADD COLUMN re_photos TEXT;
