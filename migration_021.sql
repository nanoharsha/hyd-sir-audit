-- Okhla field verification — Notice and Deleted forms (extends migration_020.sql).
-- One row per voter still; `form_type` (asdd | notice | deleted) says which form it holds and always
-- follows the elector's CURRENT tag. Additive, run once after migration_020.sql.

-- notice form
ALTER TABLE ok_verification ADD COLUMN notice_received TEXT;   -- yes | no   physical copy received by the elector
ALTER TABLE ok_verification ADD COLUMN hearing_status TEXT;    -- completed | due | not_known
ALTER TABLE ok_verification ADD COLUMN docs_submitted TEXT;    -- yes | no | unaware  required documents given to the BLO
-- deleted form
ALTER TABLE ok_verification ADD COLUMN del_status TEXT;        -- wrongful | valid
ALTER TABLE ok_verification ADD COLUMN del_aware TEXT;         -- yes | no   aware of the reason (when wrongful)
ALTER TABLE ok_verification ADD COLUMN del_got_form TEXT;      -- yes | no   received the SIR enumeration form
ALTER TABLE ok_verification ADD COLUMN del_submitted_form TEXT;-- yes | no   submitted it to the BLO (when received)

ALTER TABLE ok_verification_history ADD COLUMN form_type TEXT;
ALTER TABLE ok_verification_history ADD COLUMN notice_received TEXT;
ALTER TABLE ok_verification_history ADD COLUMN hearing_status TEXT;
ALTER TABLE ok_verification_history ADD COLUMN docs_submitted TEXT;
ALTER TABLE ok_verification_history ADD COLUMN del_status TEXT;
ALTER TABLE ok_verification_history ADD COLUMN del_aware TEXT;
ALTER TABLE ok_verification_history ADD COLUMN del_got_form TEXT;
ALTER TABLE ok_verification_history ADD COLUMN del_submitted_form TEXT;
