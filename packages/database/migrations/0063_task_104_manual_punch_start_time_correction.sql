-- ADR-0118. Expand-only provenance for an explicit observed PUNCH-start correction.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'MANUAL_PUNCH_START_TIME_CORRECTION';

ALTER TABLE result_revision ADD COLUMN manual_punch_start_time_correction_id uuid;
CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_uidx
ON result_revision(manual_punch_start_time_correction_id);
CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_source_tuple_uidx
ON result_revision(id, manual_punch_start_time_correction_id, race_id, entry_id, revision);

CREATE TABLE manual_punch_start_time_correction (
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
  source_start_time timestamptz NOT NULL,
  corrected_start_time timestamptz NOT NULL,
  created_result_revision_id uuid NOT NULL,
  created_result_revision integer NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  corrected_at timestamptz NOT NULL,
  CONSTRAINT manual_punch_start_time_correction_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT manual_punch_start_time_correction_class_scope_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT manual_punch_start_time_correction_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT manual_punch_start_time_correction_source_result_fk FOREIGN KEY(source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES result_revision(id, race_id, entry_id, revision),
  CONSTRAINT manual_punch_start_time_correction_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT manual_punch_start_time_correction_positive_check CHECK(expected_entry_version > 0 AND expected_snapshot_version > 0 AND source_result_revision > 0 AND created_result_revision > 0),
  CONSTRAINT manual_punch_start_time_correction_revision_chain_check CHECK(created_result_revision::bigint = source_result_revision::bigint + 1),
  CONSTRAINT manual_punch_start_time_correction_start_check CHECK(source_start_time <> corrected_start_time),
  CONSTRAINT manual_punch_start_time_correction_hash_check CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT manual_punch_start_time_correction_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object'),
  UNIQUE(source_result_revision_id), UNIQUE(created_result_revision_id),
  UNIQUE(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
);
CREATE INDEX manual_punch_start_time_correction_race_time_idx ON manual_punch_start_time_correction(race_id, corrected_at);

ALTER TABLE manual_punch_start_time_correction ADD CONSTRAINT manual_punch_start_time_correction_result_pair_fk
FOREIGN KEY(created_result_revision_id, request_id, race_id, entry_id, created_result_revision)
REFERENCES result_revision(id, manual_punch_start_time_correction_id, race_id, entry_id, revision)
DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE result_revision ADD CONSTRAINT result_revision_manual_punch_start_time_correction_pair_fk
FOREIGN KEY(manual_punch_start_time_correction_id, id, race_id, entry_id, revision)
REFERENCES manual_punch_start_time_correction(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
DEFERRABLE INITIALLY DEFERRED;

-- Extend the long-lived source rule. The additional narrow check below also
-- requires the new reference to be exclusive, but cannot make this older
-- exhaustive cause rule accept the new cause on its own.
DO $$
DECLARE definition text; DECLARE updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid = 'result_revision'::regclass AND conname = 'result_revision_source_provenance_check';
  IF definition IS NULL OR substring(definition from 1 for 7) <> 'CHECK (' THEN
    RAISE EXCEPTION 'result revision provenance constraint missing or noncanonical';
  END IF;
  ALTER TABLE result_revision DROP CONSTRAINT result_revision_source_provenance_check;
  updated_definition := 'CHECK (((cause)::text = ''MANUAL_PUNCH_START_TIME_CORRECTION'' AND readout_id IS NULL '
    || 'AND manual_punch_start_time_correction_id IS NOT NULL AND manual_finish_time_correction_id IS NULL '
    || 'AND manual_finish_time_correction_withdrawal_id IS NULL AND num_nonnulls('
    || 'did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, '
    || 'approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, '
    || 'not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, '
    || 'without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0 '
    || 'AND ((status = ''OK'' AND reason = ''COMPLETE'') OR '
    || '(status = ''MP'' AND reason IN (''MISSING_CONTROL'', ''WRONG_ORDER'')))) OR ('
    || substring(definition from 8 for length(definition) - 8) || '))';
  EXECUTE 'ALTER TABLE result_revision ADD CONSTRAINT result_revision_source_provenance_check ' || updated_definition;
END $$;

ALTER TABLE result_revision ADD CONSTRAINT result_revision_manual_punch_start_time_correction_provenance_check
CHECK (
  (cause::text = 'MANUAL_PUNCH_START_TIME_CORRECTION'
    AND readout_id IS NULL AND manual_punch_start_time_correction_id IS NOT NULL
    AND manual_finish_time_correction_id IS NULL AND manual_finish_time_correction_withdrawal_id IS NULL
    AND num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id,
      approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id,
      not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id,
      without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0
    AND ((status = 'OK' AND reason = 'COMPLETE') OR (status = 'MP' AND reason IN ('MISSING_CONTROL', 'WRONG_ORDER'))))
  OR (cause::text <> 'MANUAL_PUNCH_START_TIME_CORRECTION' AND manual_punch_start_time_correction_id IS NULL)
) NOT VALID;
ALTER TABLE result_revision VALIDATE CONSTRAINT result_revision_manual_punch_start_time_correction_provenance_check;

CREATE TRIGGER manual_punch_start_time_correction_immutable
BEFORE UPDATE OR DELETE ON manual_punch_start_time_correction
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable writer/UI and repair forward or restore a verified full PostgreSQL backup.
-- Never remove the enum value, immutable journal, or result provenance rows.
