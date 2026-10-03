ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'WITHDRAW_WITHOUT_TIMING';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_WITHOUT_TIMING_WITHDRAWAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_without_timing_withdrawal_lifetime_check"
CHECK (
  "capability"::text <> 'WITHDRAW_WITHOUT_TIMING'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_without_timing_withdrawal_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "without_timing_withdrawal_id" uuid;

CREATE UNIQUE INDEX "result_revision_without_timing_withdrawal_uidx"
ON "result_revision"("without_timing_withdrawal_id");
CREATE UNIQUE INDEX "result_revision_without_timing_withdrawal_source_tuple_uidx"
ON "result_revision"(
  "id", "without_timing_withdrawal_id", "race_id", "entry_id", "revision"
);

-- TASK 006M's entry-wide uniqueness was deliberately temporary while no
-- withdrawal lifecycle existed. Historical rows remain unchanged; active
-- uniqueness now belongs to the entry-locked application resolver.
DROP INDEX "without_timing_decision_entry_uidx";
CREATE INDEX "without_timing_decision_race_entry_revision_idx"
ON "without_timing_decision"("race_id", "entry_id", "created_result_revision", "id");

-- This tuple proves the original technical target and reciprocal NT revision
-- through the immutable decision row.
CREATE UNIQUE INDEX "without_timing_decision_withdrawal_source_tuple_uidx"
ON "without_timing_decision"(
  "id",
  "target_result_revision_id",
  "target_result_revision",
  "created_result_revision_id",
  "race_id",
  "entry_id",
  "created_result_revision"
);

-- This check deliberately proves only provenance shape. Eligibility of the
-- target and restoration source (current, published and direct technical)
-- belongs to the entry-locked application/domain resolver, never a SQL trigger.
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
        "not_competing_withdrawal_id", "without_timing_decision_id",
        "without_timing_withdrawal_id"
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
        "not_competing_withdrawal_id", "without_timing_decision_id",
        "without_timing_withdrawal_id"
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
        "not_competing_withdrawal_id", "without_timing_decision_id",
        "without_timing_withdrawal_id"
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
        "not_competing_withdrawal_id", "without_timing_decision_id",
        "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "without_timing_decision_id", "without_timing_withdrawal_id"
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
        "not_competing_withdrawal_id", "without_timing_withdrawal_id"
      ) = 0
    )
    OR (
      "cause"::text = 'MANUAL_WITHOUT_TIMING_WITHDRAWAL'
      AND "readout_id" IS NULL
      AND "without_timing_withdrawal_id" IS NOT NULL
      AND num_nonnulls(
        "did_not_start_decision_id", "disqualification_decision_id",
        "disqualification_withdrawal_id", "approval_decision_id",
        "approval_withdrawal_id", "did_not_finish_decision_id",
        "did_not_finish_withdrawal_id", "not_competing_decision_id",
        "not_competing_withdrawal_id", "without_timing_decision_id"
      ) = 0
    )
  )
  AND (
    (
      "cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION',
        'MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
        'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL',
        'MANUAL_WITHOUT_TIMING_WITHDRAWAL')
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

CREATE TABLE "without_timing_withdrawal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "without_timing_decision_id" uuid NOT NULL,
  "target_result_revision_id" uuid NOT NULL,
  "target_result_revision" integer NOT NULL,
  "withdrawn_result_revision_id" uuid NOT NULL,
  "withdrawn_result_revision" integer NOT NULL,
  "expected_latest_result_revision_id" uuid NOT NULL,
  "expected_latest_result_revision" integer NOT NULL,
  "restored_from_result_revision_id" uuid NOT NULL,
  "restored_from_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "reason" text NOT NULL,
  "created_result_revision_id" uuid NOT NULL,
  "created_result_revision" integer NOT NULL,
  "withdrawn_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "without_timing_withdrawal_decision_fk"
    FOREIGN KEY (
      "without_timing_decision_id",
      "target_result_revision_id",
      "target_result_revision",
      "withdrawn_result_revision_id",
      "race_id",
      "entry_id",
      "withdrawn_result_revision"
    )
    REFERENCES "without_timing_decision"(
      "id",
      "target_result_revision_id",
      "target_result_revision",
      "created_result_revision_id",
      "race_id",
      "entry_id",
      "created_result_revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_withdrawal_latest_result_fk"
    FOREIGN KEY (
      "expected_latest_result_revision_id", "race_id", "entry_id", "expected_latest_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_withdrawal_restored_from_fk"
    FOREIGN KEY (
      "restored_from_result_revision_id", "race_id", "entry_id", "restored_from_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_withdrawal_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "without_timing_withdrawal_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "without_timing_withdrawal_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "without_timing_withdrawal_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "without_timing_withdrawal_revision_chain_check"
    CHECK (
      "target_result_revision" > 0
      AND "withdrawn_result_revision" = "target_result_revision" + 1
      AND "expected_latest_result_revision" >= "withdrawn_result_revision"
      AND (
        "restored_from_result_revision" = "target_result_revision"
        OR "restored_from_result_revision" > "withdrawn_result_revision"
      )
      AND "restored_from_result_revision" <= "expected_latest_result_revision"
      AND "created_result_revision" = "expected_latest_result_revision" + 1
    ),
  CONSTRAINT "without_timing_withdrawal_policy_version_check"
    CHECK ("policy_version" = 'without-timing-withdrawal-v1'),
  CONSTRAINT "without_timing_withdrawal_reason_check"
    CHECK ("reason" = 'ERRONEOUS_MANUAL_WITHOUT_TIMING'),
  CONSTRAINT "without_timing_withdrawal_distinct_results_check"
    CHECK (
      "target_result_revision_id" <> "withdrawn_result_revision_id"
      AND "withdrawn_result_revision_id" <> "restored_from_result_revision_id"
      AND "withdrawn_result_revision_id" <> "created_result_revision_id"
      AND "restored_from_result_revision_id" <> "created_result_revision_id"
    )
);

CREATE UNIQUE INDEX "without_timing_withdrawal_request_uidx"
ON "without_timing_withdrawal"("request_id");
CREATE UNIQUE INDEX "without_timing_withdrawal_decision_uidx"
ON "without_timing_withdrawal"("without_timing_decision_id");
CREATE UNIQUE INDEX "without_timing_withdrawal_result_uidx"
ON "without_timing_withdrawal"("withdrawn_result_revision_id");
CREATE UNIQUE INDEX "without_timing_withdrawal_created_result_uidx"
ON "without_timing_withdrawal"("created_result_revision_id");
CREATE UNIQUE INDEX "without_timing_withdrawal_created_source_tuple_uidx"
ON "without_timing_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "without_timing_withdrawal_race_time_idx"
ON "without_timing_withdrawal"("race_id", "withdrawn_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_without_timing_withdrawal_pair_fk"
FOREIGN KEY (
  "without_timing_withdrawal_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "without_timing_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER without_timing_withdrawal_immutable
BEFORE UPDATE OR DELETE ON "without_timing_withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
