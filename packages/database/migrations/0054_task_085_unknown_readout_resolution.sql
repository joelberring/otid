ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'UNKNOWN_READOUT_RESOLUTION';

DO $$
DECLARE definition text;
DECLARE updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'result_revision'::regclass AND conname = 'result_revision_source_provenance_check';
  IF definition IS NULL THEN RAISE EXCEPTION 'result revision provenance constraint missing'; END IF;
  ALTER TABLE result_revision DROP CONSTRAINT result_revision_source_provenance_check;
  updated_definition := replace(definition, '''EXPLICIT_RECALCULATION''::text',
    '''EXPLICIT_RECALCULATION''::text, ''UNKNOWN_READOUT_RESOLUTION''::text');
  IF updated_definition = definition THEN
    updated_definition := replace(definition, '''EXPLICIT_RECALCULATION''',
      '''EXPLICIT_RECALCULATION'', ''UNKNOWN_READOUT_RESOLUTION''');
  END IF;
  IF updated_definition = definition THEN RAISE EXCEPTION 'technical provenance variants missing'; END IF;
  EXECUTE 'ALTER TABLE result_revision ADD CONSTRAINT result_revision_source_provenance_check ' || updated_definition;
END $$;

CREATE UNIQUE INDEX card_readout_resolution_scope_uidx
ON card_readout(id, race_id, raw_message_id, card_number);

CREATE TABLE unknown_readout_resolution (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  readout_id uuid NOT NULL,
  raw_message_id uuid NOT NULL,
  card_number text NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  target text NOT NULL,
  entry_id uuid NOT NULL,
  class_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  created_result_revision_id uuid NOT NULL,
  created_result_revision integer NOT NULL,
  expected_snapshot_version integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  resolved_at timestamptz NOT NULL,
  UNIQUE(readout_id),
  UNIQUE(created_result_revision_id),
  FOREIGN KEY(readout_id, race_id, raw_message_id, card_number) REFERENCES card_readout(id, race_id, raw_message_id, card_number),
  FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(assignment_id, race_id, entry_id, card_number) REFERENCES card_assignment(id, race_id, entry_id, card_number),
  FOREIGN KEY(created_result_revision_id, race_id, entry_id, created_result_revision) REFERENCES result_revision(id, race_id, entry_id, revision),
  FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(target IN ('EXISTING_ENTRY', 'NEW_ENTRY')),
  CHECK(expected_snapshot_version > 0 AND snapshot_version_after::bigint = expected_snapshot_version::bigint + 1),
  CHECK(created_result_revision > 0),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);
CREATE INDEX unknown_readout_resolution_race_time_idx ON unknown_readout_resolution(race_id, resolved_at);
CREATE TRIGGER unknown_readout_resolution_immutable BEFORE UPDATE OR DELETE ON unknown_readout_resolution
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer/UI, preserve raw observations, journal,
-- assignments and result revisions, then correct forward or restore a verified
-- full PostgreSQL backup. Never drop the enum value or populated journal.
