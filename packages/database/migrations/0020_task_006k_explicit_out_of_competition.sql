ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'DECIDE_OUT_OF_COMPETITION';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'OUT_OF_COMPETITION_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_OUT_OF_COMPETITION';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_out_of_competition_lifetime_check"
CHECK (
  "capability"::text <> 'DECIDE_OUT_OF_COMPETITION'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_out_of_competition_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "not_competing_decision_id" uuid;

CREATE UNIQUE INDEX "result_revision_not_competing_decision_uidx"
ON "result_revision"("not_competing_decision_id");
CREATE UNIQUE INDEX "result_revision_not_competing_source_tuple_uidx"
ON "result_revision"(
  "id", "not_competing_decision_id", "race_id", "entry_id", "revision"
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
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
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NULL
    AND "status" = 'DNF'
    AND "reason" = 'DID_NOT_FINISH'
  )
  OR
  (
    "cause"::text = 'MANUAL_DID_NOT_FINISH_WITHDRAWAL'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND "did_not_finish_withdrawal_id" IS NOT NULL
    AND "not_competing_decision_id" IS NULL
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
    "cause"::text = 'MANUAL_OUT_OF_COMPETITION'
    AND "readout_id" IS NULL
    AND "did_not_start_decision_id" IS NULL
    AND "disqualification_decision_id" IS NULL
    AND "disqualification_withdrawal_id" IS NULL
    AND "approval_decision_id" IS NULL
    AND "approval_withdrawal_id" IS NULL
    AND "did_not_finish_decision_id" IS NULL
    AND "did_not_finish_withdrawal_id" IS NULL
    AND "not_competing_decision_id" IS NOT NULL
    AND "status" = 'OOC'
    AND "reason" = 'OUT_OF_COMPETITION'
  )
) NOT VALID;
ALTER TABLE "result_revision"
VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TABLE "not_competing_decision" (
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
  CONSTRAINT "not_competing_decision_target_fk"
    FOREIGN KEY (
      "target_result_revision_id", "race_id", "entry_id", "target_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "not_competing_decision_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "not_competing_decision_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "not_competing_decision_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "not_competing_decision_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "not_competing_decision_target_revision_check"
    CHECK ("target_result_revision" > 0),
  CONSTRAINT "not_competing_decision_created_revision_check"
    CHECK ("created_result_revision" = "target_result_revision" + 1),
  CONSTRAINT "not_competing_decision_policy_version_check"
    CHECK ("policy_version" = 'out-of-competition-v1'),
  CONSTRAINT "not_competing_decision_status_check"
    CHECK ("status" = 'OOC' AND "reason" = 'OUT_OF_COMPETITION'),
  CONSTRAINT "not_competing_decision_distinct_result_check"
    CHECK ("target_result_revision_id" <> "created_result_revision_id")
);

CREATE UNIQUE INDEX "not_competing_decision_request_uidx"
ON "not_competing_decision"("request_id");
CREATE UNIQUE INDEX "not_competing_decision_entry_uidx"
ON "not_competing_decision"("entry_id");
CREATE UNIQUE INDEX "not_competing_decision_target_uidx"
ON "not_competing_decision"("target_result_revision_id");
CREATE UNIQUE INDEX "not_competing_decision_created_result_uidx"
ON "not_competing_decision"("created_result_revision_id");
CREATE UNIQUE INDEX "not_competing_decision_created_source_tuple_uidx"
ON "not_competing_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "not_competing_decision_race_time_idx"
ON "not_competing_decision"("race_id", "decided_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_not_competing_decision_pair_fk"
FOREIGN KEY (
  "not_competing_decision_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "not_competing_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER not_competing_decision_immutable
BEFORE UPDATE OR DELETE ON "not_competing_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
