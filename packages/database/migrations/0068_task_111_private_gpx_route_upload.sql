-- TASK111 / ADR-0123. Private, participant-bound GPX upload history.
-- This migration does not change maps, PM documents, results or public routes.

CREATE TABLE route_upload_grant (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  issuer_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  secret_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT route_upload_grant_scope_uidx UNIQUE(id, race_id, entry_id),
  CONSTRAINT route_upload_grant_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT route_upload_grant_secret_hash_check CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_upload_grant_expiry_check CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '30 days'),
  CONSTRAINT route_upload_grant_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT route_upload_grant_issuer_scope_fk FOREIGN KEY(issuer_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE INDEX route_upload_grant_entry_idx ON route_upload_grant(race_id, entry_id, expires_at);

CREATE TABLE route_upload_grant_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL,
  CONSTRAINT route_upload_grant_revocation_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT route_upload_grant_revocation_reason_check CHECK(char_length(btrim(reason)) BETWEEN 1 AND 240),
  CONSTRAINT route_upload_grant_revocation_grant_scope_fk FOREIGN KEY(grant_id, race_id, entry_id)
    REFERENCES route_upload_grant(id, race_id, entry_id),
  CONSTRAINT route_upload_grant_revocation_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);

CREATE TABLE route_upload_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  session_secret_hash text NOT NULL,
  csrf_secret_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT route_upload_session_secret_hash_check CHECK(session_secret_hash ~ '^[a-f0-9]{64}$' AND csrf_secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_upload_session_expiry_check CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '1 hour'),
  CONSTRAINT route_upload_session_grant_scope_fk FOREIGN KEY(grant_id, race_id, entry_id)
    REFERENCES route_upload_grant(id, race_id, entry_id)
);
CREATE INDEX route_upload_session_grant_idx ON route_upload_session(grant_id, expires_at);

CREATE TABLE route_upload_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  grant_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  file_name text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  reserved_at timestamptz NOT NULL,
  CONSTRAINT route_upload_reservation_grant_uidx UNIQUE(grant_id),
  CONSTRAINT route_upload_reservation_scope_content_uidx UNIQUE(id, grant_id, race_id, entry_id, media_type, sha256, byte_length),
  CONSTRAINT route_upload_reservation_file_name_check CHECK(char_length(file_name) BETWEEN 1 AND 120 AND file_name = btrim(file_name) AND file_name !~ '[\\/[:cntrl:]]'),
  CONSTRAINT route_upload_reservation_media_type_check CHECK(media_type = 'application/gpx+xml'),
  CONSTRAINT route_upload_reservation_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_upload_reservation_byte_length_check CHECK(byte_length BETWEEN 1 AND 8388608),
  CONSTRAINT route_upload_reservation_grant_scope_fk FOREIGN KEY(grant_id, race_id, entry_id)
    REFERENCES route_upload_grant(id, race_id, entry_id)
);

CREATE TABLE route_upload_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  charged_at timestamptz NOT NULL,
  CONSTRAINT route_upload_attempt_upload_number_uidx UNIQUE(upload_id, attempt_number),
  CONSTRAINT route_upload_attempt_manifest_scope_uidx UNIQUE(id, upload_id, grant_id, race_id, entry_id, media_type, sha256, byte_length),
  CONSTRAINT route_upload_attempt_number_check CHECK(attempt_number BETWEEN 1 AND 8),
  CONSTRAINT route_upload_attempt_media_type_check CHECK(media_type = 'application/gpx+xml'),
  CONSTRAINT route_upload_attempt_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_upload_attempt_byte_length_check CHECK(byte_length BETWEEN 1 AND 8388608),
  CONSTRAINT route_upload_attempt_reservation_content_fk FOREIGN KEY(upload_id, grant_id, race_id, entry_id, media_type, sha256, byte_length)
    REFERENCES route_upload_reservation(id, grant_id, race_id, entry_id, media_type, sha256, byte_length)
);

CREATE TABLE route_object_manifest (
  upload_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE,
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  store_id uuid NOT NULL,
  object_key text NOT NULL,
  version_id text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  point_count integer NOT NULL,
  segment_count integer NOT NULL,
  first_recorded_at timestamptz,
  last_recorded_at timestamptz,
  parser text NOT NULL,
  stored_at timestamptz NOT NULL,
  CONSTRAINT route_object_manifest_store_key_version_uidx UNIQUE(store_id, object_key, version_id),
  CONSTRAINT route_object_manifest_upload_scope_uidx UNIQUE(upload_id, race_id, entry_id),
  CONSTRAINT route_object_manifest_media_type_check CHECK(media_type = 'application/gpx+xml'),
  CONSTRAINT route_object_manifest_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_object_manifest_byte_length_check CHECK(byte_length BETWEEN 1 AND 8388608),
  CONSTRAINT route_object_manifest_counts_check CHECK(point_count BETWEEN 2 AND 100000 AND segment_count BETWEEN 1 AND 2000),
  -- First/last are in original point order, not min/max of a computed interval.
  CONSTRAINT route_object_manifest_time_range_check CHECK((first_recorded_at IS NULL AND last_recorded_at IS NULL) OR (first_recorded_at IS NOT NULL AND last_recorded_at IS NOT NULL)),
  CONSTRAINT route_object_manifest_parser_check CHECK(parser = 'otid-gpx-1.1'),
  CONSTRAINT route_object_manifest_object_key_check CHECK(object_key = 'route/' || race_id::text || '/' || attempt_id::text),
  CONSTRAINT route_object_manifest_version_id_check CHECK(char_length(version_id) BETWEEN 1 AND 1024 AND version_id ~ '^[A-Za-z0-9._~+/-]+$' AND version_id <> 'null'),
  CONSTRAINT route_object_manifest_attempt_scope_fk FOREIGN KEY(attempt_id, upload_id, grant_id, race_id, entry_id, media_type, sha256, byte_length)
    REFERENCES route_upload_attempt(id, upload_id, grant_id, race_id, entry_id, media_type, sha256, byte_length)
);

CREATE TABLE route_point (
  upload_id uuid NOT NULL REFERENCES route_object_manifest(upload_id),
  sequence integer NOT NULL,
  segment integer NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  elevation_meters double precision,
  recorded_at timestamptz,
  CONSTRAINT route_point_pk PRIMARY KEY(upload_id, sequence),
  CONSTRAINT route_point_sequence_check CHECK(sequence BETWEEN 0 AND 99999),
  CONSTRAINT route_point_segment_check CHECK(segment BETWEEN 0 AND 1999),
  CONSTRAINT route_point_latitude_check CHECK(latitude BETWEEN -90 AND 90),
  CONSTRAINT route_point_longitude_check CHECK(longitude BETWEEN -180 AND 180)
);

CREATE TRIGGER route_upload_grant_immutable BEFORE UPDATE OR DELETE ON route_upload_grant FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_upload_grant_revocation_immutable BEFORE UPDATE OR DELETE ON route_upload_grant_revocation FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_upload_session_immutable BEFORE UPDATE OR DELETE ON route_upload_session FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_upload_reservation_immutable BEFORE UPDATE OR DELETE ON route_upload_reservation FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_upload_attempt_immutable BEFORE UPDATE OR DELETE ON route_upload_attempt FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_object_manifest_immutable BEFORE UPDATE OR DELETE ON route_object_manifest FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER route_point_immutable BEFORE UPDATE OR DELETE ON route_point FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only. At incident, disable grant/upload routes and restore a verified
-- backup with the exact private object versions. Never delete, rewrite or
-- translate original GPX manifests or their normalized point order.
