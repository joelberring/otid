ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'WITHDRAW_DID_NOT_FINISH';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_DID_NOT_FINISH_WITHDRAWAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_did_not_finish_withdrawal_lifetime_check"
CHECK (
  "capability"::text <> 'WITHDRAW_DID_NOT_FINISH'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_did_not_finish_withdrawal_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "did_not_finish_withdrawal_id" uuid;

CREATE UNIQUE INDEX "result_revision_did_not_finish_withdrawal_uidx"
ON "result_revision"("did_not_finish_withdrawal_id");
CREATE UNIQUE INDEX "result_revision_did_not_finish_withdrawal_source_tuple_uidx"
ON "result_revision"(
  "id", "did_not_finish_withdrawal_id", "race_id", "entry_id", "revision"
);

-- TASK 006I's entry-wide uniqueness was intentionally temporary while no
-- withdrawal lifecycle existed. Historical rows remain unchanged; active
-- uniqueness now belongs to the entry-locked application resolver.
DROP INDEX "did_not_finish_decision_entry_uidx";
CREATE INDEX "did_not_finish_decision_race_entry_revision_idx"
ON "did_not_finish_decision"("race_id", "entry_id", "created_result_revision", "id");

-- This tuple lets one withdrawal prove both the original technical target and
-- the reciprocal DNF revision through the immutable decision row.
CREATE UNIQUE INDEX "did_not_finish_decision_withdrawal_source_tuple_uidx"
ON "did_not_finish_decision"(
  "id",
  "target_result_revision_id",
  "target_result_revision",
  "created_result_revision_id",
  "race_id",
  "entry_id",
  "created_result_revision"
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
) NOT VALID;
ALTER TABLE "result_revision"
VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TABLE "did_not_finish_withdrawal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "did_not_finish_decision_id" uuid NOT NULL,
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
  CONSTRAINT "did_not_finish_withdrawal_decision_fk"
    FOREIGN KEY (
      "did_not_finish_decision_id",
      "target_result_revision_id",
      "target_result_revision",
      "withdrawn_result_revision_id",
      "race_id",
      "entry_id",
      "withdrawn_result_revision"
    )
    REFERENCES "did_not_finish_decision"(
      "id",
      "target_result_revision_id",
      "target_result_revision",
      "created_result_revision_id",
      "race_id",
      "entry_id",
      "created_result_revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_withdrawal_latest_result_fk"
    FOREIGN KEY (
      "expected_latest_result_revision_id", "race_id", "entry_id", "expected_latest_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_withdrawal_restored_from_fk"
    FOREIGN KEY (
      "restored_from_result_revision_id", "race_id", "entry_id", "restored_from_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_withdrawal_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "did_not_finish_withdrawal_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "did_not_finish_withdrawal_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "did_not_finish_withdrawal_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "did_not_finish_withdrawal_revision_chain_check"
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
  CONSTRAINT "did_not_finish_withdrawal_policy_version_check"
    CHECK ("policy_version" = 'did-not-finish-withdrawal-v1'),
  CONSTRAINT "did_not_finish_withdrawal_reason_check"
    CHECK ("reason" = 'ERRONEOUS_MANUAL_DID_NOT_FINISH'),
  CONSTRAINT "did_not_finish_withdrawal_distinct_results_check"
    CHECK (
      "target_result_revision_id" <> "withdrawn_result_revision_id"
      AND "withdrawn_result_revision_id" <> "restored_from_result_revision_id"
      AND "withdrawn_result_revision_id" <> "created_result_revision_id"
      AND "restored_from_result_revision_id" <> "created_result_revision_id"
    )
);

CREATE UNIQUE INDEX "did_not_finish_withdrawal_request_uidx"
ON "did_not_finish_withdrawal"("request_id");
CREATE UNIQUE INDEX "did_not_finish_withdrawal_decision_uidx"
ON "did_not_finish_withdrawal"("did_not_finish_decision_id");
CREATE UNIQUE INDEX "did_not_finish_withdrawal_result_uidx"
ON "did_not_finish_withdrawal"("withdrawn_result_revision_id");
CREATE UNIQUE INDEX "did_not_finish_withdrawal_created_result_uidx"
ON "did_not_finish_withdrawal"("created_result_revision_id");
CREATE UNIQUE INDEX "did_not_finish_withdrawal_created_source_tuple_uidx"
ON "did_not_finish_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "did_not_finish_withdrawal_race_time_idx"
ON "did_not_finish_withdrawal"("race_id", "withdrawn_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_did_not_finish_withdrawal_pair_fk"
FOREIGN KEY (
  "did_not_finish_withdrawal_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "did_not_finish_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER did_not_finish_withdrawal_immutable
BEFORE UPDATE OR DELETE ON "did_not_finish_withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
