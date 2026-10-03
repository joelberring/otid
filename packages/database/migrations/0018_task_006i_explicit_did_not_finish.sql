ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'DECIDE_DID_NOT_FINISH';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'DID_NOT_FINISH_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_DID_NOT_FINISH';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_did_not_finish_lifetime_check"
CHECK (
  "capability"::text <> 'DECIDE_DID_NOT_FINISH'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_did_not_finish_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "did_not_finish_decision_id" uuid;

CREATE UNIQUE INDEX "result_revision_did_not_finish_decision_uidx"
ON "result_revision"("did_not_finish_decision_id");
CREATE UNIQUE INDEX "result_revision_did_not_finish_source_tuple_uidx"
ON "result_revision"(
  "id", "did_not_finish_decision_id", "race_id", "entry_id", "revision"
);

ALTER TABLE "result_revision"
DROP CONSTRAINT "result_revision_source_provenance_check";
ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_source_provenance_check"
CHECK (
  (
    "cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION')
    AND "readout_id" IS NOT NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND (
      ("status" = 'OK' AND "reason" = 'COMPLETE')
      OR (
        "status" = 'MP'
        AND "reason" IN (
          'MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'
        )
      )
    )
  )
  OR
  (
    "cause"::text = 'MANUAL_DID_NOT_START'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NOT NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND "status" = 'DNS'
    AND "reason" = 'DID_NOT_START'
  )
  OR
  (
    "cause"::text = 'MANUAL_DISQUALIFICATION'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NOT NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND "status" = 'DSQ'
    AND "reason" = 'MANUAL_DISQUALIFICATION'
  )
  OR
  (
    "cause"::text = 'MANUAL_DISQUALIFICATION_WITHDRAWAL'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NOT NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND (
      ("status" = 'OK' AND "reason" = 'COMPLETE')
      OR (
        "status" = 'MP'
        AND "reason" IN (
          'MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'
        )
      )
    )
  )
  OR
  (
    "cause"::text = 'MANUAL_RESULT_APPROVAL'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NOT NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND "status" = 'OK'
    AND "reason" = 'MANUAL_APPROVAL'
  )
  OR
  (
    "cause"::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NOT NULL
    AND "did_not_finish_decision_id" IS NULL
    AND (
      ("status" = 'OK' AND "reason" = 'COMPLETE')
      OR (
        "status" = 'MP'
        AND "reason" IN (
          'MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'
        )
      )
    )
  )
  OR
  (
    "cause"::text = 'MANUAL_DID_NOT_FINISH'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NOT NULL
    AND "status" = 'DNF'
    AND "reason" = 'DID_NOT_FINISH'
  )
) NOT VALID;
ALTER TABLE "result_revision"
VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TABLE "did_not_finish_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "target_result_revision_id" uuid NOT NULL,
  "target_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "created_result_revision_id" uuid NOT NULL,
  "created_result_revision" integer NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "did_not_finish_decision_target_fk"
    FOREIGN KEY (
      "target_result_revision_id", "race_id", "entry_id", "target_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_decision_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "did_not_finish_decision_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_decision_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "did_not_finish_decision_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "did_not_finish_decision_target_revision_check"
    CHECK ("target_result_revision" > 0),
  CONSTRAINT "did_not_finish_decision_created_revision_check"
    CHECK ("created_result_revision" = "target_result_revision" + 1),
  CONSTRAINT "did_not_finish_decision_policy_version_check"
    CHECK (length(btrim("policy_version")) BETWEEN 1 AND 64),
  CONSTRAINT "did_not_finish_decision_status_check"
    CHECK ("status" = 'DNF' AND "reason" = 'DID_NOT_FINISH'),
  CONSTRAINT "did_not_finish_decision_distinct_result_check"
    CHECK ("target_result_revision_id" <> "created_result_revision_id")
);

CREATE UNIQUE INDEX "did_not_finish_decision_request_uidx"
ON "did_not_finish_decision"("request_id");
CREATE UNIQUE INDEX "did_not_finish_decision_entry_uidx"
ON "did_not_finish_decision"("entry_id");
CREATE UNIQUE INDEX "did_not_finish_decision_target_uidx"
ON "did_not_finish_decision"("target_result_revision_id");
CREATE UNIQUE INDEX "did_not_finish_decision_created_result_uidx"
ON "did_not_finish_decision"("created_result_revision_id");
CREATE UNIQUE INDEX "did_not_finish_decision_created_source_tuple_uidx"
ON "did_not_finish_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "did_not_finish_decision_race_time_idx"
ON "did_not_finish_decision"("race_id", "decided_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_did_not_finish_decision_pair_fk"
FOREIGN KEY (
  "did_not_finish_decision_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "did_not_finish_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER did_not_finish_decision_immutable
BEFORE UPDATE OR DELETE ON "did_not_finish_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
