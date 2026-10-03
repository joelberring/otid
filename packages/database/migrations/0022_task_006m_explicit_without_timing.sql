ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'DECIDE_WITHOUT_TIMING';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'WITHOUT_TIMING_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_WITHOUT_TIMING';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_without_timing_lifetime_check"
CHECK (
  "capability"::text <> 'DECIDE_WITHOUT_TIMING'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_without_timing_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "without_timing_decision_id" uuid;

CREATE UNIQUE INDEX "result_revision_without_timing_decision_uidx"
ON "result_revision"("without_timing_decision_id");
CREATE UNIQUE INDEX "result_revision_without_timing_source_tuple_uidx"
ON "result_revision"(
  "id", "without_timing_decision_id", "race_id", "entry_id", "revision"
);

-- This check deliberately proves only provenance shape. Eligibility of the
-- target (current, published, direct technical OK/COMPLETE) belongs to the
-- entry-locked application/domain resolver, never a SQL trigger.
ALTER TABLE "result_revision"
DROP CONSTRAINT "result_revision_source_provenance_check";
ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_source_provenance_check"
CHECK (
  (
    (
      "cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION')
      AND "readout_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id", "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_DID_NOT_START'
      AND "readout_id" IS NULL
      AND "did_not_start_decision_id" IS NOT NULL
      AND num_nonnulls(
        "disqualification_decision_id", "disqualification_withdrawal_id",
        "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id", "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_DISQUALIFICATION'
      AND "readout_id" IS NULL
      AND "disqualification_decision_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_withdrawal_id",
        "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id", "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_DISQUALIFICATION_WITHDRAWAL'
      AND "readout_id" IS NULL
      AND "disqualification_withdrawal_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id", "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_RESULT_APPROVAL'
      AND "readout_id" IS NULL
      AND "approval_decision_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_withdrawal_id",
        "did_not_finish_decision_id", "did_not_finish_withdrawal_id",
        "not_competing_decision_id", "not_competing_withdrawal_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'
      AND "readout_id" IS NULL
      AND "approval_withdrawal_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "did_not_finish_decision_id", "did_not_finish_withdrawal_id",
        "not_competing_decision_id", "not_competing_withdrawal_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_DID_NOT_FINISH'
      AND "readout_id" IS NULL
      AND "did_not_finish_decision_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_withdrawal_id",
        "not_competing_decision_id", "not_competing_withdrawal_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_DID_NOT_FINISH_WITHDRAWAL'
      AND "readout_id" IS NULL
      AND "did_not_finish_withdrawal_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "not_competing_decision_id", "not_competing_withdrawal_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_OUT_OF_COMPETITION'
      AND "readout_id" IS NULL
      AND "not_competing_decision_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_withdrawal_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL'
      AND "readout_id" IS NULL
      AND "not_competing_withdrawal_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "without_timing_decision_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_WITHOUT_TIMING'
      AND "readout_id" IS NULL
      AND "without_timing_decision_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id"
      ) = 0
    )
  )
  AND (
    (
      "cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION',
        'MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
        'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL')
      AND (
        ("status" = 'OK' AND "reason" = 'COMPLETE')
        OR ("status" = 'MP' AND "reason" IN (
          'MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'
        ))
      )
    )
    OR ("cause"::text = 'MANUAL_DID_NOT_START' AND "status" = 'DNS' AND "reason" = 'DID_NOT_START')
    OR ("cause"::text = 'MANUAL_DISQUALIFICATION' AND "status" = 'DSQ' AND "reason" = 'MANUAL_DISQUALIFICATION')
    OR ("cause"::text = 'MANUAL_RESULT_APPROVAL' AND "status" = 'OK' AND "reason" = 'MANUAL_APPROVAL')
    OR ("cause"::text = 'MANUAL_DID_NOT_FINISH' AND "status" = 'DNF' AND "reason" = 'DID_NOT_FINISH')
    OR ("cause"::text = 'MANUAL_OUT_OF_COMPETITION' AND "status" = 'OOC' AND "reason" = 'OUT_OF_COMPETITION')
    OR ("cause"::text = 'MANUAL_WITHOUT_TIMING' AND "status" = 'NT' AND "reason" = 'WITHOUT_TIMING')
  )
) NOT VALID;
ALTER TABLE "result_revision"
VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TABLE "without_timing_decision" (
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
  CONSTRAINT "without_timing_decision_target_fk"
    FOREIGN KEY ("target_result_revision_id", "race_id", "entry_id", "target_result_revision")
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_decision_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "without_timing_decision_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_decision_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "without_timing_decision_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "without_timing_decision_target_revision_check"
    CHECK ("target_result_revision" > 0),
  CONSTRAINT "without_timing_decision_created_revision_check"
    CHECK ("created_result_revision" = "target_result_revision" + 1),
  CONSTRAINT "without_timing_decision_policy_version_check"
    CHECK ("policy_version" = 'without-timing-v1'),
  CONSTRAINT "without_timing_decision_status_check"
    CHECK ("status" = 'NT' AND "reason" = 'WITHOUT_TIMING'),
  CONSTRAINT "without_timing_decision_distinct_result_check"
    CHECK ("target_result_revision_id" <> "created_result_revision_id")
);

CREATE UNIQUE INDEX "without_timing_decision_request_uidx"
ON "without_timing_decision"("request_id");
CREATE UNIQUE INDEX "without_timing_decision_entry_uidx"
ON "without_timing_decision"("entry_id");
CREATE UNIQUE INDEX "without_timing_decision_target_uidx"
ON "without_timing_decision"("target_result_revision_id");
CREATE UNIQUE INDEX "without_timing_decision_created_result_uidx"
ON "without_timing_decision"("created_result_revision_id");
CREATE UNIQUE INDEX "without_timing_decision_created_source_tuple_uidx"
ON "without_timing_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "without_timing_decision_race_time_idx"
ON "without_timing_decision"("race_id", "decided_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_without_timing_decision_pair_fk"
FOREIGN KEY (
  "without_timing_decision_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "without_timing_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER without_timing_decision_immutable
BEFORE UPDATE OR DELETE ON "without_timing_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
