CREATE TABLE entry_transfer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  previous_class_id uuid NOT NULL,
  target_class_id uuid NOT NULL,
  request jsonb NOT NULL,
  entry_version_before integer NOT NULL,
  entry_version_after integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (entry_id, race_id) REFERENCES entry(id, race_id),
  FOREIGN KEY (previous_class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY (target_class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT entry_transfer_role_check CHECK (capability::text = 'MANAGE_RACE'),
  CONSTRAINT entry_transfer_class_check CHECK (previous_class_id <> target_class_id),
  CONSTRAINT entry_transfer_request_check CHECK (jsonb_typeof(request) = 'object'),
  CONSTRAINT entry_transfer_entry_version_check CHECK (entry_version_before > 0 AND entry_version_after::bigint = entry_version_before::bigint + 1),
  CONSTRAINT entry_transfer_snapshot_version_check CHECK (snapshot_version_before > 0 AND snapshot_version_after::bigint = snapshot_version_before::bigint + 1)
);
CREATE UNIQUE INDEX entry_transfer_entry_version_uidx ON entry_transfer_request(entry_id, entry_version_before);
CREATE INDEX entry_transfer_race_time_idx ON entry_transfer_request(race_id, changed_at);
CREATE TRIGGER entry_transfer_immutable BEFORE UPDATE OR DELETE ON entry_transfer_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
