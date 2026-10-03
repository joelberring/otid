-- ADR-0050. Expand-only substrate; no write API is activated by this migration.
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'START_CHECKIN';
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'FINISH_FOREST_WATCH';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'START_CHECKIN_ACCESS_CREDENTIAL';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'FINISH_FOREST_WATCH_ACCESS_CREDENTIAL';

CREATE UNIQUE INDEX entry_id_race_uidx ON entry(id, race_id);
CREATE UNIQUE INDEX pairing_admin_credential_scope_uidx
  ON pairing_admin_access_credential(id, race_id, capability);
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_start_checkin_lifetime_check
  CHECK (capability::text NOT IN ('START_CHECKIN', 'FINISH_FOREST_WATCH') OR expires_at <= issued_at + interval '8 hours');

CREATE TABLE start_checkin_device (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  label text NOT NULL,
  registered_at timestamptz NOT NULL,
  CONSTRAINT start_checkin_device_capability_check CHECK (capability::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH')),
  CONSTRAINT start_checkin_device_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT start_checkin_device_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE UNIQUE INDEX start_checkin_device_scope_uidx ON start_checkin_device(id, race_id, actor_credential_id);
CREATE INDEX start_checkin_device_race_idx ON start_checkin_device(race_id);

CREATE TABLE start_checkin_operation (
  request_id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  local_sequence integer NOT NULL,
  package_version integer NOT NULL,
  expected_entry_version integer NOT NULL,
  expected_revision integer NOT NULL,
  content_hash text NOT NULL,
  intent jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  effect text NOT NULL,
  resulting_revision integer NOT NULL,
  created_revision_id uuid,
  conflict_reason text,
  receipt jsonb NOT NULL,
  CONSTRAINT start_checkin_operation_device_scope_fk FOREIGN KEY (device_id, race_id, actor_credential_id)
    REFERENCES start_checkin_device(id, race_id, actor_credential_id),
  CONSTRAINT start_checkin_operation_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT start_checkin_operation_counters_check CHECK (
    local_sequence > 0 AND package_version > 0 AND expected_entry_version > 0 AND expected_revision >= 0 AND resulting_revision >= 0),
  CONSTRAINT start_checkin_operation_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT start_checkin_operation_json_check CHECK (jsonb_typeof(intent) = 'object' AND jsonb_typeof(receipt) = 'object'),
  CONSTRAINT start_checkin_operation_effect_check CHECK (
    (effect = 'APPLIED' AND created_revision_id IS NOT NULL AND resulting_revision::bigint = expected_revision::bigint + 1 AND conflict_reason IS NULL)
    OR (effect = 'UNCHANGED' AND created_revision_id IS NULL AND resulting_revision = expected_revision AND conflict_reason IS NULL)
    OR (effect = 'CONFLICT' AND created_revision_id IS NULL AND conflict_reason IS NOT NULL AND conflict_reason IN (
      'STALE_ENTRY', 'STALE_PACKAGE', 'STALE_REVISION', 'RETURN_ALREADY_REGISTERED', 'RESULT_CONFLICT', 'DEPENDENCY_CONFLICT')))
);
CREATE UNIQUE INDEX start_checkin_operation_sequence_uidx ON start_checkin_operation(device_id, local_sequence);
CREATE UNIQUE INDEX start_checkin_operation_revision_scope_uidx
  ON start_checkin_operation(request_id, race_id, entry_id, effect, resulting_revision);
CREATE UNIQUE INDEX start_checkin_operation_created_revision_uidx ON start_checkin_operation(created_revision_id);
CREATE INDEX start_checkin_operation_entry_idx ON start_checkin_operation(race_id, entry_id, received_at);

CREATE TABLE start_checkin_revision (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision integer NOT NULL,
  operation_effect text NOT NULL DEFAULT 'APPLIED',
  start_state text NOT NULL,
  manual_return_registered boolean NOT NULL,
  CONSTRAINT start_checkin_revision_positive_check CHECK (revision > 0),
  CONSTRAINT start_checkin_revision_effect_check CHECK (operation_effect = 'APPLIED'),
  CONSTRAINT start_checkin_revision_state_check CHECK (start_state IN ('UNMARKED', 'STARTED', 'REPORTED_NOT_STARTED')),
  CONSTRAINT start_checkin_revision_operation_fk FOREIGN KEY (request_id, race_id, entry_id, operation_effect, revision)
    REFERENCES start_checkin_operation(request_id, race_id, entry_id, effect, resulting_revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX start_checkin_revision_entry_uidx ON start_checkin_revision(race_id, entry_id, revision);
CREATE UNIQUE INDEX start_checkin_revision_request_uidx ON start_checkin_revision(request_id);
CREATE UNIQUE INDEX start_checkin_revision_reciprocal_uidx ON start_checkin_revision(id, request_id, race_id, entry_id, revision);
ALTER TABLE start_checkin_operation ADD CONSTRAINT start_checkin_operation_created_revision_fk
  FOREIGN KEY (created_revision_id, request_id, race_id, entry_id, resulting_revision)
  REFERENCES start_checkin_revision(id, request_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER start_checkin_device_immutable BEFORE UPDATE OR DELETE ON start_checkin_device
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER start_checkin_operation_immutable BEFORE UPDATE OR DELETE ON start_checkin_operation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER start_checkin_revision_immutable BEFORE UPDATE OR DELETE ON start_checkin_revision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable new routes and keep all journal rows and sequence identities.
-- No destructive down migration. For full restore use a verified complete DB
-- backup. Existing manual DNS, raw data and result revisions are not altered.
