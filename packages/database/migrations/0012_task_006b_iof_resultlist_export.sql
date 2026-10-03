ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'EXPORT_IOF_RESULT_LIST';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_iof_result_list_export_lifetime_check"
CHECK (
  "capability"::text <> 'EXPORT_IOF_RESULT_LIST'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_iof_result_list_export_lifetime_check";
