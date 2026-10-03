-- ADR-0111. Expand-only provenance for one explicit observed-finish correction.
-- No route is enabled by this migration.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'MANUAL_FINISH_TIME_CORRECTION';

ALTER TABLE result_revision ADD COLUMN manual_finish_time_correction_id uuid;
CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_uidx
ON result_revision(manual_finish_time_correction_id);
CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_source_tuple_uidx
ON result_revision(id, manual_finish_time_correction_id, race_id, entry_id, revision);

CREATE TABLE manual_finish_time_correction (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  expected_entry_version integer NOT NULL,
  class_id uuid NOT NULL,
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  expected_snapshot_version integer NOT NULL,
  basis_hash text NOT NULL,
  source_result_revision_id uuid NOT NULL,
  source_result_revision integer NOT NULL,
  source_readout_id uuid NOT NULL REFERENCES card_readout(id),
  source_finish_time timestamptz NOT NULL,
  corrected_finish_time timestamptz NOT NULL,
  created_result_revision_id uuid NOT NULL,
  created_result_revision integer NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  corrected_at timestamptz NOT NULL,
  CONSTRAINT manual_finish_time_correction_entry_scope_fk
    FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT manual_finish_time_correction_class_scope_fk
    FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT manual_finish_time_correction_actor_scope_fk
    FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT manual_finish_time_correction_source_result_fk
    FOREIGN KEY(source_result_revision_id, race_id, entry_id, source_result_revision)
    REFERENCES result_revision(id, race_id, entry_id, revision),
  CONSTRAINT manual_finish_time_correction_positive_check
    CHECK(expected_entry_version > 0 AND expected_snapshot_version > 0 AND source_result_revision > 0 AND created_result_revision > 0),
  CONSTRAINT manual_finish_time_correction_revision_chain_check
    CHECK(created_result_revision::bigint = source_result_revision::bigint + 1),
  CONSTRAINT manual_finish_time_correction_finish_check
    CHECK(source_finish_time <> corrected_finish_time),
  CONSTRAINT manual_finish_time_correction_capability_check
    CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT manual_finish_time_correction_hash_check
    CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT manual_finish_time_correction_json_check
    CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object'),
  UNIQUE(source_result_revision_id),
  UNIQUE(created_result_revision_id),
  UNIQUE(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
);
CREATE INDEX manual_finish_time_correction_race_time_idx
ON manual_finish_time_correction(race_id, corrected_at);

ALTER TABLE manual_finish_time_correction
ADD CONSTRAINT manual_finish_time_correction_result_pair_fk
FOREIGN KEY(created_result_revision_id, request_id, race_id, entry_id, created_result_revision)
REFERENCES result_revision(id, manual_finish_time_correction_id, race_id, entry_id, revision)
DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE result_revision
ADD CONSTRAINT result_revision_manual_finish_time_correction_pair_fk
FOREIGN KEY(manual_finish_time_correction_id, id, race_id, entry_id, revision)
REFERENCES manual_finish_time_correction(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
DEFERRABLE INITIALLY DEFERRED;

-- The correction is exclusive result provenance. A neutralization remains
-- independent rule provenance and may be retained from its technical source.
ALTER TABLE result_revision
ADD CONSTRAINT result_revision_manual_finish_time_correction_provenance_check
CHECK (
  (cause::text = 'MANUAL_FINISH_TIME_CORRECTION'
    AND readout_id IS NULL
    AND manual_finish_time_correction_id IS NOT NULL
    AND num_nonnulls(
      did_not_start_decision_id, disqualification_decision_id,
      disqualification_withdrawal_id, approval_decision_id,
      approval_withdrawal_id, did_not_finish_decision_id,
      did_not_finish_withdrawal_id, not_competing_decision_id,
      not_competing_withdrawal_id, without_timing_decision_id,
      without_timing_withdrawal_id, start_checkin_dns_decision_id
    ) = 0
    AND ((status = 'OK' AND reason = 'COMPLETE')
      OR (status = 'MP' AND reason IN ('MISSING_CONTROL', 'WRONG_ORDER'))))
  OR (cause::text <> 'MANUAL_FINISH_TIME_CORRECTION'
    AND manual_finish_time_correction_id IS NULL)
) NOT VALID;
ALTER TABLE result_revision
VALIDATE CONSTRAINT result_revision_manual_finish_time_correction_provenance_check;

CREATE TRIGGER manual_finish_time_correction_immutable
BEFORE UPDATE OR DELETE ON manual_finish_time_correction
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the correction writer and UI. Preserve immutable journal
-- rows and revision provenance; repair forward or restore a verified full
-- PostgreSQL backup. Never remove the enum value or populated history.
