ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'IMPORT_IOF';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'IOF_IMPORT_ACCESS_CREDENTIAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_import_iof_lifetime_check"
CHECK (
  "capability"::text <> 'IMPORT_IOF'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_import_iof_lifetime_check";

CREATE TABLE "iof_import_request" (
  "request_id" uuid PRIMARY KEY,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "content_hash" text NOT NULL CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  "import_file_id" uuid NOT NULL REFERENCES "import_file"("id"),
  "outcome" text NOT NULL CHECK ("outcome" IN ('stored', 'duplicate')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "iof_import_request_race_time_idx"
ON "iof_import_request"("race_id", "created_at");

CREATE TRIGGER iof_import_request_immutable
BEFORE UPDATE OR DELETE ON "iof_import_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER import_file_immutable
BEFORE UPDATE OR DELETE ON "import_file"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
