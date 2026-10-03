-- TASK094 restores only the exact direct technical source of one current TASK093 correction.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL';

ALTER TABLE result_revision ADD COLUMN manual_finish_time_correction_withdrawal_id uuid;
CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_withdrawal_uidx
ON result_revision(manual_finish_time_correction_withdrawal_id);
CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_withdrawal_source_tuple_uidx
ON result_revision(id, manual_finish_time_correction_withdrawal_id, race_id, entry_id, revision);

CREATE TABLE manual_finish_time_correction_withdrawal (
  request_id uuid PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  expected_entry_version integer NOT NULL,
  class_id uuid NOT NULL,
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  expected_snapshot_version integer NOT NULL,
  basis_hash text NOT NULL,
  correction_id uuid NOT NULL,
  source_result_revision_id uuid NOT NULL,
  source_result_revision integer NOT NULL,
  corrected_result_revision_id uuid NOT NULL,
  corrected_result_revision integer NOT NULL,
  created_result_revision_id uuid NOT NULL,
  created_result_revision integer NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  withdrawn_at timestamptz NOT NULL,
  CONSTRAINT manual_finish_time_correction_withdrawal_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT manual_finish_time_correction_withdrawal_class_scope_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT manual_finish_time_correction_withdrawal_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT manual_finish_time_correction_withdrawal_source_fk FOREIGN KEY(source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES result_revision(id, race_id, entry_id, revision),
  CONSTRAINT manual_finish_time_correction_withdrawal_corrected_fk FOREIGN KEY(corrected_result_revision_id, correction_id, race_id, entry_id, corrected_result_revision) REFERENCES result_revision(id, manual_finish_time_correction_id, race_id, entry_id, revision),
  CONSTRAINT manual_finish_time_correction_withdrawal_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT manual_finish_time_correction_withdrawal_positive_check CHECK(expected_entry_version > 0 AND expected_snapshot_version > 0 AND source_result_revision > 0 AND corrected_result_revision > 0 AND created_result_revision > 0),
  CONSTRAINT manual_finish_time_correction_withdrawal_chain_check CHECK(corrected_result_revision::bigint = source_result_revision::bigint + 1 AND created_result_revision::bigint = corrected_result_revision::bigint + 1),
  CONSTRAINT manual_finish_time_correction_withdrawal_hash_check CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT manual_finish_time_correction_withdrawal_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object'),
  UNIQUE(correction_id), UNIQUE(created_result_revision_id), UNIQUE(id, created_result_revision_id, race_id, entry_id, created_result_revision)
);
CREATE INDEX manual_finish_time_correction_withdrawal_race_time_idx ON manual_finish_time_correction_withdrawal(race_id, withdrawn_at);

ALTER TABLE manual_finish_time_correction_withdrawal ADD CONSTRAINT manual_finish_time_correction_withdrawal_created_fk
FOREIGN KEY(created_result_revision_id, id, race_id, entry_id, created_result_revision)
REFERENCES result_revision(id, manual_finish_time_correction_withdrawal_id, race_id, entry_id, revision)
DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE result_revision ADD CONSTRAINT result_revision_manual_finish_time_correction_withdrawal_pair_fk
FOREIGN KEY(manual_finish_time_correction_withdrawal_id, id, race_id, entry_id, revision)
REFERENCES manual_finish_time_correction_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision)
DEFERRABLE INITIALLY DEFERRED;

-- Extend, rather than replace, the existing exclusive provenance rule.
DO $$
DECLARE definition text; DECLARE updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid = 'result_revision'::regclass AND conname = 'result_revision_source_provenance_check';
  IF definition IS NULL OR substring(definition from 1 for 7) <> 'CHECK (' THEN RAISE EXCEPTION 'result revision provenance constraint missing or noncanonical'; END IF;
  ALTER TABLE result_revision DROP CONSTRAINT result_revision_source_provenance_check;
  updated_definition := 'CHECK (((cause)::text = ''MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL'' AND readout_id IS NULL '
    || 'AND manual_finish_time_correction_id IS NULL AND manual_finish_time_correction_withdrawal_id IS NOT NULL AND num_nonnulls('
    || 'did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, '
    || 'did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0 '
    || 'AND ((status = ''OK'' AND reason = ''COMPLETE'') OR (status = ''MP'' AND reason IN (''MISSING_CONTROL'', ''WRONG_ORDER'')))) OR ('
    || substring(definition from 8 for length(definition) - 8) || '))';
  EXECUTE 'ALTER TABLE result_revision ADD CONSTRAINT result_revision_source_provenance_check ' || updated_definition;
END $$;

CREATE TRIGGER manual_finish_time_correction_withdrawal_immutable
BEFORE UPDATE OR DELETE ON manual_finish_time_correction_withdrawal
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the TASK094 writer/UI. Preserve immutable rows and enum values;
-- repair forward or restore a verified PostgreSQL backup, never delete history.
