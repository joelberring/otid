ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'WITHDRAW_DID_NOT_START';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_did_not_start_withdrawal_lifetime_check"
CHECK (
  "capability"::text <> 'WITHDRAW_DID_NOT_START'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_did_not_start_withdrawal_lifetime_check";

-- Both directions now prove one exact immutable DNS source pair, including
-- race, entry and revision number. They are deferred because TASK 006E inserts
-- the circular pair atomically in one transaction.
CREATE UNIQUE INDEX "result_revision_dns_source_tuple_uidx"
ON "result_revision"("id", "did_not_start_decision_id", "race_id", "entry_id", "revision");
CREATE UNIQUE INDEX "did_not_start_decision_source_tuple_uidx"
ON "did_not_start_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);

ALTER TABLE "did_not_start_decision"
ADD CONSTRAINT "did_not_start_decision_result_pair_fk"
FOREIGN KEY (
  "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
)
REFERENCES "result_revision"(
  "id", "did_not_start_decision_id", "race_id", "entry_id", "revision"
)
DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_did_not_start_decision_pair_fk"
FOREIGN KEY (
  "did_not_start_decision_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "did_not_start_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "did_not_start_withdrawal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "did_not_start_decision_id" uuid NOT NULL,
  "withdrawn_result_revision_id" uuid NOT NULL,
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "expected_latest_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "reason" text NOT NULL,
  "withdrawn_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "did_not_start_withdrawal_target_fk"
    FOREIGN KEY (
      "did_not_start_decision_id",
      "withdrawn_result_revision_id",
      "race_id",
      "entry_id",
      "expected_latest_result_revision"
    )
    REFERENCES "did_not_start_decision"(
      "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
    ),
  CONSTRAINT "did_not_start_withdrawal_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "did_not_start_withdrawal_expected_snapshot_version_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "did_not_start_withdrawal_expected_revision_check"
    CHECK ("expected_latest_result_revision" > 0),
  CONSTRAINT "did_not_start_withdrawal_policy_version_check"
    CHECK (length(btrim("policy_version")) BETWEEN 1 AND 64),
  CONSTRAINT "did_not_start_withdrawal_reason_check"
    CHECK ("reason" = 'ERRONEOUS_MANUAL_DNS')
);

CREATE UNIQUE INDEX "did_not_start_withdrawal_request_uidx"
ON "did_not_start_withdrawal"("request_id");
CREATE UNIQUE INDEX "did_not_start_withdrawal_decision_uidx"
ON "did_not_start_withdrawal"("did_not_start_decision_id");
CREATE UNIQUE INDEX "did_not_start_withdrawal_result_uidx"
ON "did_not_start_withdrawal"("withdrawn_result_revision_id");
CREATE INDEX "did_not_start_withdrawal_race_time_idx"
ON "did_not_start_withdrawal"("race_id", "withdrawn_at", "id");

CREATE TRIGGER did_not_start_withdrawal_immutable
BEFORE UPDATE OR DELETE ON "did_not_start_withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
