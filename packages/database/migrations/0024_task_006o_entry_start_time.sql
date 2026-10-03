ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'CHANGE_ENTRY_START_TIME';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'ENTRY_START_TIME_ACCESS_CREDENTIAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_entry_start_time_lifetime_check"
CHECK (
  "capability"::text <> 'CHANGE_ENTRY_START_TIME'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_entry_start_time_lifetime_check";

CREATE TABLE "entry_start_time_change_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "previous_fixed_start_time" timestamptz,
  "fixed_start_time" timestamptz NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "class"("id"),
  "entry_version_before" integer NOT NULL,
  "entry_version_after" integer NOT NULL,
  "snapshot_version_before" integer NOT NULL,
  "snapshot_version_after" integer NOT NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "entry_start_time_change_request_expected_version_check"
    CHECK ("expected_entry_version" > 0 AND "entry_version_before" = "expected_entry_version"),
  CONSTRAINT "entry_start_time_change_request_entry_increment_check"
    CHECK ("entry_version_after" = "entry_version_before" + 1),
  CONSTRAINT "entry_start_time_change_request_snapshot_increment_check"
    CHECK ("snapshot_version_before" > 0 AND "snapshot_version_after" = "snapshot_version_before" + 1),
  CONSTRAINT "entry_start_time_change_request_time_change_check"
    CHECK ("previous_fixed_start_time" IS DISTINCT FROM "fixed_start_time")
);
CREATE UNIQUE INDEX "entry_start_time_change_request_request_uidx"
ON "entry_start_time_change_request"("request_id");
CREATE UNIQUE INDEX "entry_start_time_change_request_entry_version_uidx"
ON "entry_start_time_change_request"("entry_id", "entry_version_before");
CREATE INDEX "entry_start_time_change_request_race_time_idx"
ON "entry_start_time_change_request"("race_id", "changed_at");

CREATE TRIGGER entry_start_time_change_request_immutable
BEFORE UPDATE OR DELETE ON "entry_start_time_change_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
