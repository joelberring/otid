-- Additive only; existing entries, results and published bytes are untouched.
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'CHANGE_ENTRY_IDENTITY';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'ENTRY_IDENTITY_ACCESS_CREDENTIAL';
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_entry_identity_lifetime_check
CHECK (capability::text <> 'CHANGE_ENTRY_IDENTITY' OR expires_at <= issued_at + interval '8 hours');

CREATE TABLE entry_identity_change_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL,
  class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  previous_identity jsonb NOT NULL,
  identity jsonb NOT NULL,
  entry_version_before integer NOT NULL,
  entry_version_after integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_identity_change_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT entry_identity_change_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT entry_identity_change_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT entry_identity_change_capability_check CHECK (capability::text = 'CHANGE_ENTRY_IDENTITY'),
  CONSTRAINT entry_identity_change_versions_check CHECK (
    entry_version_before > 0 AND entry_version_after::bigint = entry_version_before::bigint + 1 AND
    snapshot_version_before > 0 AND snapshot_version_after::bigint = snapshot_version_before::bigint + 1),
  CONSTRAINT entry_identity_change_values_check CHECK (
    jsonb_typeof(previous_identity) = 'object' AND jsonb_typeof(identity) = 'object' AND previous_identity <> identity)
);
CREATE UNIQUE INDEX entry_identity_change_request_request_uidx ON entry_identity_change_request(request_id);
CREATE UNIQUE INDEX entry_identity_change_request_entry_version_uidx ON entry_identity_change_request(entry_id, entry_version_before);
CREATE INDEX entry_identity_change_request_race_time_idx ON entry_identity_change_request(race_id, changed_at);
CREATE TRIGGER entry_identity_change_request_immutable BEFORE UPDATE OR DELETE ON entry_identity_change_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
