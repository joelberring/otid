ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'DECIDE_DID_NOT_START';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'DID_NOT_START_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_DID_NOT_START';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_did_not_start_lifetime_check"
CHECK (
  "capability"::text <> 'DECIDE_DID_NOT_START'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_did_not_start_lifetime_check";

ALTER TABLE "result_revision"
ALTER COLUMN "readout_id" DROP NOT NULL;

CREATE TABLE "did_not_start_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "expected_latest_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "created_result_revision_id" uuid NOT NULL,
  "created_result_revision" integer NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "did_not_start_decision_created_result_fk"
    FOREIGN KEY ("created_result_revision_id") REFERENCES "result_revision"("id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_start_decision_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "did_not_start_decision_expected_snapshot_version_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "did_not_start_decision_expected_revision_check"
    CHECK ("expected_latest_result_revision" = 0),
  CONSTRAINT "did_not_start_decision_created_revision_check"
    CHECK ("created_result_revision" = 1),
  CONSTRAINT "did_not_start_decision_policy_version_check"
    CHECK (length(btrim("policy_version")) BETWEEN 1 AND 64),
  CONSTRAINT "did_not_start_decision_status_check"
    CHECK ("status" = 'DNS' AND "reason" = 'DID_NOT_START')
);
CREATE UNIQUE INDEX "did_not_start_decision_request_uidx"
ON "did_not_start_decision"("request_id");
CREATE UNIQUE INDEX "did_not_start_decision_entry_previous_uidx"
ON "did_not_start_decision"("entry_id", "expected_latest_result_revision");
CREATE UNIQUE INDEX "did_not_start_decision_created_result_uidx"
ON "did_not_start_decision"("created_result_revision_id");
CREATE INDEX "did_not_start_decision_race_time_idx"
ON "did_not_start_decision"("race_id", "decided_at");

ALTER TABLE "result_revision"
ADD COLUMN "did_not_start_decision_id" uuid;
ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_did_not_start_decision_fk"
FOREIGN KEY ("did_not_start_decision_id") REFERENCES "did_not_start_decision"("id")
DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX "result_revision_did_not_start_decision_uidx"
ON "result_revision"("did_not_start_decision_id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_source_provenance_check"
CHECK (
  (
    "cause" = 'MANUAL_DID_NOT_START'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NOT NULL
    AND "status" = 'DNS'
    AND "reason" = 'DID_NOT_START'
  )
  OR
  (
    "cause" <> 'MANUAL_DID_NOT_START'
    AND "readout_id" IS NOT NULL
    AND "did_not_start_decision_id" IS NULL
    AND "status" <> 'DNS'
    AND "reason" <> 'DID_NOT_START'
  )
) NOT VALID;
ALTER TABLE "result_revision"
VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TRIGGER did_not_start_decision_immutable
BEFORE UPDATE OR DELETE ON "did_not_start_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
