ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'VIEW_RACE_OVERVIEW';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_race_overview_lifetime_check"
CHECK (
  "capability"::text <> 'VIEW_RACE_OVERVIEW'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_race_overview_lifetime_check";
