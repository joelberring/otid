-- ADR-0051. Expand-only provenance for an explicit check-in DNS report.
-- No write route is enabled by this migration.
ALTER TYPE "revision_cause" ADD VALUE IF NOT EXISTS 'START_CHECKIN_DID_NOT_START';

ALTER TABLE "result_revision"
ADD COLUMN "start_checkin_dns_decision_id" uuid;
CREATE UNIQUE INDEX "result_revision_start_checkin_dns_decision_uidx"
ON "result_revision"("start_checkin_dns_decision_id");
CREATE UNIQUE INDEX "result_revision_start_checkin_dns_source_tuple_uidx"
ON "result_revision"("id", "start_checkin_dns_decision_id", "race_id", "entry_id", "revision");

CREATE TABLE "start_checkin_dns_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "operation_request_id" uuid NOT NULL,
  "start_checkin_revision_id" uuid NOT NULL,
  "operational_revision" integer NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "class"("id"),
  "course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "snapshot_version" integer NOT NULL,
  "expected_latest_result_revision" integer NOT NULL,
  "created_result_revision_id" uuid NOT NULL,
  "created_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "start_checkin_dns_decision_entry_scope_fk"
    FOREIGN KEY ("entry_id", "race_id") REFERENCES "entry"("id", "race_id"),
  CONSTRAINT "start_checkin_dns_decision_class_scope_fk"
    FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "start_checkin_dns_decision_operation_revision_fk"
    FOREIGN KEY ("start_checkin_revision_id", "operation_request_id", "race_id", "entry_id", "operational_revision")
    REFERENCES "start_checkin_revision"("id", "request_id", "race_id", "entry_id", "revision"),
  CONSTRAINT "start_checkin_dns_decision_positive_check"
    CHECK ("operational_revision" > 0 AND "snapshot_version" > 0 AND "expected_latest_result_revision" >= 0 AND "created_result_revision" > 0),
  CONSTRAINT "start_checkin_dns_decision_created_revision_check"
    CHECK ("created_result_revision"::bigint = "expected_latest_result_revision"::bigint + 1),
  CONSTRAINT "start_checkin_dns_decision_policy_version_check"
    CHECK ("policy_version" = 'start-checkin-dns-v1')
);
CREATE UNIQUE INDEX "start_checkin_dns_decision_operation_uidx"
ON "start_checkin_dns_decision"("operation_request_id");
CREATE UNIQUE INDEX "start_checkin_dns_decision_created_result_uidx"
ON "start_checkin_dns_decision"("created_result_revision_id");
CREATE UNIQUE INDEX "start_checkin_dns_decision_result_pair_uidx"
ON "start_checkin_dns_decision"("id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision");
CREATE INDEX "start_checkin_dns_decision_race_time_idx"
ON "start_checkin_dns_decision"("race_id", "decided_at");

ALTER TABLE "start_checkin_dns_decision"
ADD CONSTRAINT "start_checkin_dns_decision_result_pair_fk"
FOREIGN KEY ("created_result_revision_id", "id", "race_id", "entry_id", "created_result_revision")
REFERENCES "result_revision"("id", "start_checkin_dns_decision_id", "race_id", "entry_id", "revision")
DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "result_revision"
ADD CONSTRAINT "result_revision_start_checkin_dns_decision_pair_fk"
FOREIGN KEY ("start_checkin_dns_decision_id", "id", "race_id", "entry_id", "revision")
REFERENCES "start_checkin_dns_decision"("id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision")
DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "start_checkin_dns_withdrawal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "operation_request_id" uuid NOT NULL,
  "start_checkin_revision_id" uuid NOT NULL,
  "operational_revision" integer NOT NULL,
  "start_checkin_dns_decision_id" uuid NOT NULL,
  "withdrawn_result_revision_id" uuid NOT NULL,
  "withdrawn_result_revision" integer NOT NULL,
  "policy_version" text NOT NULL,
  "withdrawn_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "start_checkin_dns_withdrawal_entry_scope_fk"
    FOREIGN KEY ("entry_id", "race_id") REFERENCES "entry"("id", "race_id"),
  CONSTRAINT "start_checkin_dns_withdrawal_operation_revision_fk"
    FOREIGN KEY ("start_checkin_revision_id", "operation_request_id", "race_id", "entry_id", "operational_revision")
    REFERENCES "start_checkin_revision"("id", "request_id", "race_id", "entry_id", "revision"),
  CONSTRAINT "start_checkin_dns_withdrawal_target_fk"
    FOREIGN KEY ("start_checkin_dns_decision_id", "withdrawn_result_revision_id", "race_id", "entry_id", "withdrawn_result_revision")
    REFERENCES "start_checkin_dns_decision"("id", "created_result_revision_id", "race_id", "entry_id", "created_result_revision"),
  CONSTRAINT "start_checkin_dns_withdrawal_positive_check"
    CHECK ("operational_revision" > 0 AND "withdrawn_result_revision" > 0),
  CONSTRAINT "start_checkin_dns_withdrawal_policy_version_check"
    CHECK ("policy_version" = 'start-checkin-dns-withdrawal-v1')
);
CREATE UNIQUE INDEX "start_checkin_dns_withdrawal_operation_uidx"
ON "start_checkin_dns_withdrawal"("operation_request_id");
CREATE UNIQUE INDEX "start_checkin_dns_withdrawal_decision_uidx"
ON "start_checkin_dns_withdrawal"("start_checkin_dns_decision_id");
CREATE UNIQUE INDEX "start_checkin_dns_withdrawal_result_uidx"
ON "start_checkin_dns_withdrawal"("withdrawn_result_revision_id");
CREATE INDEX "start_checkin_dns_withdrawal_race_time_idx"
ON "start_checkin_dns_withdrawal"("race_id", "withdrawn_at");

-- Existing provenance variants retain their original source constraints. The
-- new source is exclusive: no readout nor older decision/withdrawal may join it.
ALTER TABLE "result_revision" DROP CONSTRAINT "result_revision_source_provenance_check";
ALTER TABLE "result_revision" ADD CONSTRAINT "result_revision_source_provenance_check"
CHECK (
  (
    ("cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION') AND "readout_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_DID_NOT_START' AND "readout_id" IS NULL AND "did_not_start_decision_id" IS NOT NULL AND num_nonnulls("disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_DISQUALIFICATION' AND "readout_id" IS NULL AND "disqualification_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_DISQUALIFICATION_WITHDRAWAL' AND "readout_id" IS NULL AND "disqualification_withdrawal_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_RESULT_APPROVAL' AND "readout_id" IS NULL AND "approval_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL' AND "readout_id" IS NULL AND "approval_withdrawal_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_DID_NOT_FINISH' AND "readout_id" IS NULL AND "did_not_finish_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_DID_NOT_FINISH_WITHDRAWAL' AND "readout_id" IS NULL AND "did_not_finish_withdrawal_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_OUT_OF_COMPETITION' AND "readout_id" IS NULL AND "not_competing_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL' AND "readout_id" IS NULL AND "not_competing_withdrawal_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "without_timing_decision_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_WITHOUT_TIMING' AND "readout_id" IS NULL AND "without_timing_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_withdrawal_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'MANUAL_WITHOUT_TIMING_WITHDRAWAL' AND "readout_id" IS NULL AND "without_timing_withdrawal_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "start_checkin_dns_decision_id") = 0)
    OR ("cause"::text = 'START_CHECKIN_DID_NOT_START' AND "readout_id" IS NULL AND "start_checkin_dns_decision_id" IS NOT NULL AND num_nonnulls("did_not_start_decision_id", "disqualification_decision_id", "disqualification_withdrawal_id", "approval_decision_id", "approval_withdrawal_id", "did_not_finish_decision_id", "did_not_finish_withdrawal_id", "not_competing_decision_id", "not_competing_withdrawal_id", "without_timing_decision_id", "without_timing_withdrawal_id") = 0)
  )
  AND (
    (("cause"::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION', 'MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL', 'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL', 'MANUAL_WITHOUT_TIMING_WITHDRAWAL')) AND (("status" = 'OK' AND "reason" = 'COMPLETE') OR ("status" = 'MP' AND "reason" IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
    OR ("cause"::text IN ('MANUAL_DID_NOT_START', 'START_CHECKIN_DID_NOT_START') AND "status" = 'DNS' AND "reason" = 'DID_NOT_START')
    OR ("cause"::text = 'MANUAL_DISQUALIFICATION' AND "status" = 'DSQ' AND "reason" = 'MANUAL_DISQUALIFICATION')
    OR ("cause"::text = 'MANUAL_RESULT_APPROVAL' AND "status" = 'OK' AND "reason" = 'MANUAL_APPROVAL')
    OR ("cause"::text = 'MANUAL_DID_NOT_FINISH' AND "status" = 'DNF' AND "reason" = 'DID_NOT_FINISH')
    OR ("cause"::text = 'MANUAL_OUT_OF_COMPETITION' AND "status" = 'OOC' AND "reason" = 'OUT_OF_COMPETITION')
    OR ("cause"::text = 'MANUAL_WITHOUT_TIMING' AND "status" = 'NT' AND "reason" = 'WITHOUT_TIMING')
  )
) NOT VALID;
ALTER TABLE "result_revision" VALIDATE CONSTRAINT "result_revision_source_provenance_check";

CREATE TRIGGER "start_checkin_dns_decision_immutable" BEFORE UPDATE OR DELETE ON "start_checkin_dns_decision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER "start_checkin_dns_withdrawal_immutable" BEFORE UPDATE OR DELETE ON "start_checkin_dns_withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable new DNS writes and preserve all decision/withdrawal rows.
-- There is no destructive down migration. Full restoration requires a verified
-- database backup; do not run an old application with new writes enabled.
