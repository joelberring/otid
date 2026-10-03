ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'RECALCULATE_RESULT';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'RESULT_RECALCULATION_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'EXPLICIT_RECALCULATION';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_result_recalculation_lifetime_check"
CHECK (
  "capability"::text <> 'RECALCULATE_RESULT'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_result_recalculation_lifetime_check";

CREATE TABLE "result_recalculation_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "expected_card_assignment_id" uuid NOT NULL REFERENCES "card_assignment"("id"),
  "expected_readout_id" uuid NOT NULL REFERENCES "card_readout"("id"),
  "expected_latest_result_revision_id" uuid REFERENCES "result_revision"("id"),
  "expected_latest_result_revision" integer NOT NULL,
  "expected_engine_version" text NOT NULL,
  "created_result_revision_id" uuid NOT NULL REFERENCES "result_revision"("id"),
  "created_result_revision" integer NOT NULL,
  "recalculated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "result_recalculation_request_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "result_recalculation_request_expected_snapshot_version_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "result_recalculation_request_expected_revision_pair_check"
    CHECK (
      ("expected_latest_result_revision_id" IS NULL AND "expected_latest_result_revision" = 0)
      OR
      ("expected_latest_result_revision_id" IS NOT NULL AND "expected_latest_result_revision" > 0)
    ),
  CONSTRAINT "result_recalculation_request_created_revision_check"
    CHECK ("created_result_revision" = "expected_latest_result_revision" + 1),
  CONSTRAINT "result_recalculation_request_engine_version_check"
    CHECK (length(btrim("expected_engine_version")) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX "result_recalculation_request_request_uidx"
ON "result_recalculation_request"("request_id");
CREATE UNIQUE INDEX "result_recalculation_request_created_result_uidx"
ON "result_recalculation_request"("created_result_revision_id");
CREATE UNIQUE INDEX "result_recalculation_request_entry_previous_uidx"
ON "result_recalculation_request"("entry_id", "expected_latest_result_revision");
CREATE INDEX "result_recalculation_request_race_time_idx"
ON "result_recalculation_request"("race_id", "recalculated_at");

CREATE TRIGGER result_recalculation_request_immutable
BEFORE UPDATE OR DELETE ON "result_recalculation_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
