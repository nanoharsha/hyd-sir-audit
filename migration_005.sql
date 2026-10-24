-- Why a deletion is being proposed. Previously a Deletion carried only an
-- optional death-certificate photo, which meant "shifted away permanently"
-- and "died" were indistinguishable in the data — and a deletion with no
-- photo was ambiguous between "died, certificate unavailable" and "not a
-- death at all". The type is now recorded explicitly, and the certificate
-- upload only appears when the type is Death.
--
-- Values are validated against DELETION_TYPES in src/records.ts:
--   Death | Absent / Permanently shifted | Other
ALTER TABLE electors ADD COLUMN deletion_type TEXT;
ALTER TABLE status_history ADD COLUMN deletion_type TEXT;
