CREATE TABLE eventor_connection (
  id uuid PRIMARY KEY,
  owner_credential_id uuid NOT NULL REFERENCES event_creation_access_credential(id),
  environment text NOT NULL,
  label text NOT NULL,
  key_id text NOT NULL,
  format_version integer NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  ciphertext text NOT NULL,
  issued_at timestamptz NOT NULL,
  operator_label text NOT NULL,
  CONSTRAINT eventor_connection_environment_check CHECK (environment = 'testeventor-se'),
  CONSTRAINT eventor_connection_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 120 AND length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT eventor_connection_key_check CHECK (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT eventor_connection_envelope_check CHECK (format_version = 1 AND iv ~ '^[A-Za-z0-9_-]{16}$' AND tag ~ '^[A-Za-z0-9_-]{22}$' AND ciphertext ~ '^[A-Za-z0-9_-]{43}$')
);
CREATE UNIQUE INDEX eventor_connection_id_owner_uidx ON eventor_connection(id, owner_credential_id);
CREATE INDEX eventor_connection_owner_idx ON eventor_connection(owner_credential_id);
CREATE TABLE eventor_connection_revocation (
  connection_id uuid PRIMARY KEY REFERENCES eventor_connection(id),
  revoked_at timestamptz NOT NULL,
  operator_label text NOT NULL,
  CONSTRAINT eventor_connection_revocation_operator_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120)
);
CREATE TABLE eventor_import_request (
  request_id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL REFERENCES event_creation_access_credential(id),
  environment text NOT NULL,
  external_event_id text NOT NULL,
  external_event_race_id text NOT NULL,
  source_hash text NOT NULL,
  mapping_version integer NOT NULL,
  event_name text NOT NULL,
  event_start_date date NOT NULL,
  race_name text NOT NULL,
  race_date date NOT NULL,
  time_zone text NOT NULL,
  event_id uuid NOT NULL REFERENCES event(id),
  race_id uuid NOT NULL REFERENCES race(id),
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT eventor_import_environment_check CHECK (environment = 'testeventor-se'),
  CONSTRAINT eventor_import_external_id_check CHECK (length(external_event_id) BETWEEN 1 AND 256 AND length(external_event_race_id) BETWEEN 1 AND 256),
  CONSTRAINT eventor_import_hash_check CHECK (source_hash ~ '^[a-f0-9]{64}$' AND mapping_version = 1),
  CONSTRAINT eventor_import_names_check CHECK (length(btrim(event_name)) BETWEEN 2 AND 160 AND length(btrim(race_name)) BETWEEN 2 AND 160 AND length(btrim(time_zone)) BETWEEN 1 AND 100),
  CONSTRAINT eventor_import_connection_owner_fk FOREIGN KEY (connection_id, actor_credential_id) REFERENCES eventor_connection(id, owner_credential_id),
  CONSTRAINT eventor_import_race_event_fk FOREIGN KEY (race_id, event_id) REFERENCES race(id, event_id)
);
CREATE UNIQUE INDEX eventor_import_external_event_uidx ON eventor_import_request(environment, external_event_id);
CREATE UNIQUE INDEX eventor_import_event_uidx ON eventor_import_request(event_id);
CREATE UNIQUE INDEX eventor_import_race_uidx ON eventor_import_request(race_id);
CREATE TRIGGER eventor_connection_immutable BEFORE UPDATE OR DELETE ON eventor_connection
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER eventor_connection_revocation_immutable BEFORE UPDATE OR DELETE ON eventor_connection_revocation
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER eventor_import_request_immutable BEFORE UPDATE OR DELETE ON eventor_import_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only. Disable the import routes and revoke connections for rollback.
-- Keep journals/external references; restore a verified full DB backup and the
-- separately held master keys if required. Never delete history to retry import.
