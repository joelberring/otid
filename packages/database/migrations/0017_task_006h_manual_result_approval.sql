ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'APPROVE_RESULT';
ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'WITHDRAW_RESULT_APPROVAL';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'RESULT_APPROVAL_ACCESS_CREDENTIAL';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_RESULT_APPROVAL';
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'MANUAL_RESULT_APPROVAL_WITHDRAWAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_result_approval_lifetime_check"
CHECK (
  "capability"::text <> 'APPROVE_RESULT'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_result_approval_lifetime_check";

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_result_approval_withdrawal_lifetime_check"
CHECK (
  "capability"::text <> 'WITHDRAW_RESULT_APPROVAL'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_result_approval_withdrawal_lifetime_check";

ALTER TABLE "result_revision"
ADD COLUMN "approval_decision_id" uuid;
ALTER TABLE "result_revision"
ADD COLUMN "approval_withdrawal_id" uuid;

CREATE UNIQUE INDEX "result_revision_approval_decision_uidx"
ON "result_revision"("approval_decision_id");
CREATE UNIQUE INDEX "result_revision_approval_withdrawal_uidx"
ON "result_revision"("approval_withdrawal_id");
CREATE UNIQUE INDEX "result_revision_approval_source_tuple_uidx"
ON "result_revision"(
  "id", "approval_decision_id", "race_id", "entry_id", "revision"
);
CREATE UNIQUE INDEX "result_revision_approval_withdrawal_source_tuple_uidx"
ON "result_revision"(
  "id", "approval_withdrawal_id", "race_id", "entry_id", "revision"
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

CREATE TABLE "result_approval_decision" (
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
  CONSTRAINT "result_approval_decision_target_fk"
    FOREIGN KEY (
      "target_result_revision_id", "race_id", "entry_id", "target_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_decision_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "approval_decision_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_decision_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "result_approval_decision_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "result_approval_decision_target_revision_check"
    CHECK ("target_result_revision" > 0),
  CONSTRAINT "result_approval_decision_created_revision_check"
    CHECK ("created_result_revision" = "target_result_revision" + 1),
  CONSTRAINT "result_approval_decision_policy_version_check"
    CHECK (length(btrim("policy_version")) BETWEEN 1 AND 64),
  CONSTRAINT "result_approval_decision_status_check"
    CHECK ("status" = 'OK' AND "reason" = 'MANUAL_APPROVAL'),
  CONSTRAINT "result_approval_decision_distinct_result_check"
    CHECK ("target_result_revision_id" <> "created_result_revision_id")
);

CREATE UNIQUE INDEX "result_approval_decision_request_uidx"
ON "result_approval_decision"("request_id");
CREATE UNIQUE INDEX "result_approval_decision_target_uidx"
ON "result_approval_decision"("target_result_revision_id");
CREATE UNIQUE INDEX "result_approval_decision_created_result_uidx"
ON "result_approval_decision"("created_result_revision_id");
CREATE UNIQUE INDEX "result_approval_decision_created_source_tuple_uidx"
ON "result_approval_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "result_approval_decision_race_time_idx"
ON "result_approval_decision"("race_id", "decided_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_approval_decision_pair_fk"
FOREIGN KEY (
  "approval_decision_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "result_approval_decision"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "result_approval_withdrawal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "expected_entry_version" integer NOT NULL,
  "expected_class_id" uuid NOT NULL REFERENCES "class"("id"),
  "expected_course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "expected_snapshot_version" integer NOT NULL,
  "approval_decision_id" uuid NOT NULL,
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
  CONSTRAINT "result_approval_withdrawal_decision_fk"
    FOREIGN KEY (
      "approval_decision_id",
      "withdrawn_result_revision_id",
      "race_id",
      "entry_id",
      "withdrawn_result_revision"
    )
    REFERENCES "result_approval_decision"(
      "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_withdrawal_latest_result_fk"
    FOREIGN KEY (
      "expected_latest_result_revision_id", "race_id", "entry_id", "expected_latest_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_withdrawal_restored_from_fk"
    FOREIGN KEY (
      "restored_from_result_revision_id", "race_id", "entry_id", "restored_from_result_revision"
    )
    REFERENCES "result_revision"("id", "race_id", "entry_id", "revision")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_withdrawal_result_pair_fk"
    FOREIGN KEY (
      "created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision"
    )
    REFERENCES "result_revision"(
      "id", "approval_withdrawal_id", "race_id", "entry_id", "revision"
    )
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "result_approval_withdrawal_expected_entry_version_check"
    CHECK ("expected_entry_version" > 0),
  CONSTRAINT "result_approval_withdrawal_expected_snapshot_check"
    CHECK ("expected_snapshot_version" > 0),
  CONSTRAINT "result_approval_withdrawal_revision_chain_check"
    CHECK (
      "withdrawn_result_revision" > 0
      AND "expected_latest_result_revision" >= "withdrawn_result_revision"
      AND "restored_from_result_revision" > 0
      AND "restored_from_result_revision" <= "expected_latest_result_revision"
      AND "created_result_revision" = "expected_latest_result_revision" + 1
    ),
  CONSTRAINT "result_approval_withdrawal_policy_version_check"
    CHECK (length(btrim("policy_version")) BETWEEN 1 AND 64),
  CONSTRAINT "result_approval_withdrawal_reason_check"
    CHECK ("reason" = 'ERRONEOUS_MANUAL_APPROVAL'),
  CONSTRAINT "result_approval_withdrawal_distinct_results_check"
    CHECK (
      "withdrawn_result_revision_id" <> "restored_from_result_revision_id"
      AND "withdrawn_result_revision_id" <> "created_result_revision_id"
      AND "restored_from_result_revision_id" <> "created_result_revision_id"
    )
);

CREATE UNIQUE INDEX "result_approval_withdrawal_request_uidx"
ON "result_approval_withdrawal"("request_id");
CREATE UNIQUE INDEX "result_approval_withdrawal_decision_uidx"
ON "result_approval_withdrawal"("approval_decision_id");
CREATE UNIQUE INDEX "result_approval_withdrawal_result_uidx"
ON "result_approval_withdrawal"("withdrawn_result_revision_id");
CREATE UNIQUE INDEX "result_approval_withdrawal_created_result_uidx"
ON "result_approval_withdrawal"("created_result_revision_id");
CREATE UNIQUE INDEX "result_approval_withdrawal_created_source_tuple_uidx"
ON "result_approval_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
);
CREATE INDEX "result_approval_withdrawal_race_time_idx"
ON "result_approval_withdrawal"("race_id", "withdrawn_at", "id");

ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_approval_withdrawal_pair_fk"
FOREIGN KEY (
  "approval_withdrawal_id", "id", "race_id", "entry_id", "revision"
)
REFERENCES "result_approval_withdrawal"(
  "id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"
)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER result_approval_decision_immutable
BEFORE UPDATE OR DELETE ON "result_approval_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER result_approval_withdrawal_immutable
BEFORE UPDATE OR DELETE ON "result_approval_withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
