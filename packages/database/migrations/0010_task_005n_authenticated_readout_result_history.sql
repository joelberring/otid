ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'VIEW_READOUT_RESULT_HISTORY';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_readout_result_history_lifetime_check"
CHECK (
  "capability"::text <> 'VIEW_READOUT_RESULT_HISTORY'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_readout_result_history_lifetime_check";

CREATE INDEX "raw_device_message_race_received_id_idx"
ON "raw_device_message" ("race_id", "server_received_at" DESC, "id" DESC);
