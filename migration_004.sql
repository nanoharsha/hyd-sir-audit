-- Fields the developer added to the Python reference after our initial port.
-- See CLOUDFLARE.md (in the developer's zip) for the full rationale.
ALTER TABLE electors ADD COLUMN contact_phone TEXT;
ALTER TABLE electors ADD COLUMN addition_category TEXT;
ALTER TABLE electors ADD COLUMN form6_given TEXT;
ALTER TABLE electors ADD COLUMN correction_type TEXT;
ALTER TABLE status_history ADD COLUMN correction_type TEXT;

-- form8_given is retired, not dropped: old rows stay readable and SQLite
-- cannot drop a column without rebuilding the table.
