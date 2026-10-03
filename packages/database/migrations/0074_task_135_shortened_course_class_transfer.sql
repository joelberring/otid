-- ADR-0139. A shortened course is a separately ranked local class. This is
-- expand-only provenance: the original course/class and its result history
-- remain unchanged.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'SHORTENED_COURSE_CLASS_TRANSFER';

ALTER TABLE result_revision ADD COLUMN shortened_course_class_transfer_id uuid;
CREATE UNIQUE INDEX result_revision_shortened_course_class_transfer_source_tuple_uidx
ON result_revision(id, shortened_course_class_transfer_id, race_id, entry_id, revision);

CREATE TABLE shortened_course_class_transfer (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  source_class_id uuid NOT NULL,
  source_course_id uuid NOT NULL,
  source_course_version_id uuid NOT NULL,
  short_course_id uuid NOT NULL,
  short_course_version_id uuid NOT NULL,
  short_class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  source_snapshot_version integer NOT NULL,
  source_hash text NOT NULL,
  frozen_basis jsonb NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  transferred_at timestamptz NOT NULL,
  CONSTRAINT shortened_course_class_transfer_source_class_scope_fk FOREIGN KEY(source_class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT shortened_course_class_transfer_source_course_scope_fk FOREIGN KEY(source_course_id, race_id) REFERENCES course(id, race_id),
  CONSTRAINT shortened_course_class_transfer_source_version_course_fk FOREIGN KEY(source_course_version_id, source_course_id) REFERENCES course_version(id, course_id),
  CONSTRAINT shortened_course_class_transfer_short_course_scope_fk FOREIGN KEY(short_course_id, race_id) REFERENCES course(id, race_id),
  CONSTRAINT shortened_course_class_transfer_short_version_course_fk FOREIGN KEY(short_course_version_id, short_course_id) REFERENCES course_version(id, course_id),
  CONSTRAINT shortened_course_class_transfer_short_class_scope_fk FOREIGN KEY(short_class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT shortened_course_class_transfer_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT shortened_course_class_transfer_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT shortened_course_class_transfer_snapshot_check CHECK(source_snapshot_version > 0),
  CONSTRAINT shortened_course_class_transfer_hash_check CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT shortened_course_class_transfer_json_check CHECK(jsonb_typeof(frozen_basis) = 'object' AND jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object'),
  UNIQUE(request_id, race_id)
);
CREATE INDEX shortened_course_class_transfer_race_time_idx ON shortened_course_class_transfer(race_id, transferred_at);

ALTER TABLE result_revision ADD CONSTRAINT result_revision_shortened_course_class_transfer_header_fk
FOREIGN KEY(shortened_course_class_transfer_id) REFERENCES shortened_course_class_transfer(request_id)
DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE shortened_course_class_transfer_item (
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  entry_version_before integer NOT NULL,
  entry_version_after integer NOT NULL,
  source_result_revision_id uuid,
  source_result_revision integer,
  source_readout_id uuid,
  created_result_revision_id uuid,
  created_result_revision integer,
  PRIMARY KEY(request_id, entry_id),
  CONSTRAINT shortened_course_class_transfer_item_header_scope_fk FOREIGN KEY(request_id, race_id) REFERENCES shortened_course_class_transfer(request_id, race_id),
  CONSTRAINT shortened_course_class_transfer_item_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT shortened_course_class_transfer_item_source_result_fk FOREIGN KEY(source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES result_revision(id, race_id, entry_id, revision),
  CONSTRAINT shortened_course_class_transfer_item_source_readout_fk FOREIGN KEY(source_readout_id) REFERENCES card_readout(id),
  CONSTRAINT shortened_course_class_transfer_item_created_result_fk FOREIGN KEY(created_result_revision_id, request_id, race_id, entry_id, created_result_revision) REFERENCES result_revision(id, shortened_course_class_transfer_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT shortened_course_class_transfer_item_version_check CHECK(entry_version_before > 0 AND entry_version_after::bigint = entry_version_before::bigint + 1),
  CONSTRAINT shortened_course_class_transfer_item_result_chain_check CHECK(
    (source_result_revision_id IS NULL AND source_result_revision IS NULL AND source_readout_id IS NULL AND created_result_revision_id IS NULL AND created_result_revision IS NULL)
    OR
    (source_result_revision_id IS NOT NULL AND source_result_revision IS NOT NULL AND source_readout_id IS NOT NULL AND created_result_revision_id IS NOT NULL AND created_result_revision IS NOT NULL AND created_result_revision::bigint = source_result_revision::bigint + 1)
  ),
  UNIQUE(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
);

ALTER TABLE result_revision ADD CONSTRAINT result_revision_shortened_course_class_transfer_item_fk
FOREIGN KEY(shortened_course_class_transfer_id, id, race_id, entry_id, revision)
REFERENCES shortened_course_class_transfer_item(request_id, created_result_revision_id, race_id, entry_id, created_result_revision)
DEFERRABLE INITIALLY DEFERRED;

-- The long-lived generic source rule predates this explicit technical cause.
-- Wrap it instead of weakening historical provenance guarantees.
DO $$
DECLARE definition text; DECLARE updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
  WHERE conrelid = 'result_revision'::regclass AND conname = 'result_revision_source_provenance_check';
  IF definition IS NULL OR substring(definition from 1 for 7) <> 'CHECK (' THEN
    RAISE EXCEPTION 'result revision provenance constraint missing or noncanonical';
  END IF;
  ALTER TABLE result_revision DROP CONSTRAINT result_revision_source_provenance_check;
  updated_definition := 'CHECK (((cause)::text = ''SHORTENED_COURSE_CLASS_TRANSFER'' AND readout_id IS NOT NULL '
    || 'AND shortened_course_class_transfer_id IS NOT NULL AND manual_finish_time_correction_id IS NULL '
    || 'AND manual_finish_time_correction_withdrawal_id IS NULL AND manual_punch_start_time_correction_id IS NULL '
    || 'AND manual_punch_start_time_correction_withdrawal_id IS NULL AND num_nonnulls('
    || 'did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, '
    || 'approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, '
    || 'not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0 '
    || 'AND ((status = ''OK'' AND reason = ''COMPLETE'') OR (status = ''MP'' AND reason IN (''MISSING_START'', ''MISSING_FINISH'', ''MISSING_CONTROL'', ''WRONG_ORDER'', ''INVALID_TIME_ORDER'')))) OR ('
    || substring(definition from 8 for length(definition) - 8) || '))';
  EXECUTE 'ALTER TABLE result_revision ADD CONSTRAINT result_revision_source_provenance_check ' || updated_definition;
END $$;

ALTER TABLE result_revision ADD CONSTRAINT result_revision_shortened_course_class_transfer_provenance_check
CHECK (
  (cause::text = 'SHORTENED_COURSE_CLASS_TRANSFER'
    AND readout_id IS NOT NULL AND shortened_course_class_transfer_id IS NOT NULL
    AND manual_finish_time_correction_id IS NULL AND manual_finish_time_correction_withdrawal_id IS NULL
    AND manual_punch_start_time_correction_id IS NULL AND manual_punch_start_time_correction_withdrawal_id IS NULL
    AND num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id,
      approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id,
      not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id,
      without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0
    AND ((status = 'OK' AND reason = 'COMPLETE') OR (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
  OR (cause::text <> 'SHORTENED_COURSE_CLASS_TRANSFER' AND shortened_course_class_transfer_id IS NULL)
) NOT VALID;
ALTER TABLE result_revision VALIDATE CONSTRAINT result_revision_shortened_course_class_transfer_provenance_check;

CREATE TRIGGER shortened_course_class_transfer_immutable
BEFORE UPDATE OR DELETE ON shortened_course_class_transfer
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER shortened_course_class_transfer_item_immutable
BEFORE UPDATE OR DELETE ON shortened_course_class_transfer_item
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the TASK135 writer/UI and repair forward, or restore a
-- verified full PostgreSQL backup. Never delete this journal, appended
-- revision provenance, or enum value from a production database.
