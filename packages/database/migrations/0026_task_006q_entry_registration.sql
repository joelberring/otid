ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'REGISTER_ENTRY';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'ENTRY_REGISTRATION_ACCESS_CREDENTIAL';
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_entry_registration_lifetime_check
CHECK (capability::text <> 'REGISTER_ENTRY' OR expires_at <= issued_at + interval '8 hours');

CREATE TABLE entry_registration_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race(id),
  actor_credential_id uuid NOT NULL REFERENCES pairing_admin_access_credential(id),
  entry_id uuid NOT NULL REFERENCES entry(id),
  assignment_id uuid REFERENCES card_assignment(id),
  request jsonb NOT NULL,
  snapshot_version_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_registration_request_object_check CHECK (jsonb_typeof(request) = 'object'),
  CONSTRAINT entry_registration_request_version_check CHECK (snapshot_version_after > 1)
);
CREATE UNIQUE INDEX entry_registration_request_request_uidx ON entry_registration_request(request_id);
CREATE UNIQUE INDEX entry_registration_request_entry_uidx ON entry_registration_request(entry_id);
CREATE INDEX entry_registration_request_race_time_idx ON entry_registration_request(race_id, created_at);
CREATE TRIGGER entry_registration_request_immutable BEFORE UPDATE OR DELETE ON entry_registration_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
