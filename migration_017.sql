-- PH FOLLOW UP: a free-text notes/remarks field alongside the four Yes/No
-- questions, so the field team can record context the fixed questions don't
-- capture (owner request, 2026-09-16).
ALTER TABLE ph_followup ADD COLUMN notes TEXT;
