-- TASK106 / ADR-0120. Separate immutable map asset journal.
-- This migration deliberately does not alter PM tables or PM object keys.

CREATE TABLE map_upload_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race(id),
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  slot integer NOT NULL,
  title text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  reserved_at timestamptz NOT NULL,
  CONSTRAINT map_upload_reservation_request_uidx UNIQUE(request_id),
  CONSTRAINT map_upload_reservation_race_slot_uidx UNIQUE(race_id, slot),
  CONSTRAINT map_upload_reservation_scope_content_uidx UNIQUE(id, race_id, media_type, sha256, byte_length),
  CONSTRAINT map_upload_reservation_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT map_upload_reservation_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT map_upload_reservation_slot_check CHECK(slot BETWEEN 1 AND 100),
  CONSTRAINT map_upload_reservation_title_check CHECK(char_length(title) BETWEEN 1 AND 120 AND title = btrim(title)),
  CONSTRAINT map_upload_reservation_media_type_check CHECK(media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT map_upload_reservation_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_upload_reservation_byte_length_check CHECK(byte_length BETWEEN 1 AND 52428800)
);

CREATE TABLE map_upload_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  race_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  charged_at timestamptz NOT NULL,
  CONSTRAINT map_upload_attempt_upload_number_uidx UNIQUE(upload_id, attempt_number),
  CONSTRAINT map_upload_attempt_manifest_scope_uidx UNIQUE(id, upload_id, race_id, media_type, sha256, byte_length),
  CONSTRAINT map_upload_attempt_reservation_content_fk FOREIGN KEY(upload_id, race_id, media_type, sha256, byte_length)
    REFERENCES map_upload_reservation(id, race_id, media_type, sha256, byte_length),
  CONSTRAINT map_upload_attempt_number_check CHECK(attempt_number BETWEEN 1 AND 8),
  CONSTRAINT map_upload_attempt_media_type_check CHECK(media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT map_upload_attempt_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_upload_attempt_byte_length_check CHECK(byte_length BETWEEN 1 AND 52428800)
);

CREATE TABLE map_object_manifest (
  upload_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  race_id uuid NOT NULL,
  store_id uuid NOT NULL,
  object_key text NOT NULL,
  version_id text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  stored_at timestamptz NOT NULL,
  CONSTRAINT map_object_manifest_store_key_version_uidx UNIQUE(store_id, object_key, version_id),
  CONSTRAINT map_object_manifest_attempt_uidx UNIQUE(attempt_id),
  CONSTRAINT map_object_manifest_upload_race_uidx UNIQUE(upload_id, race_id),
  CONSTRAINT map_object_manifest_attempt_scope_fk FOREIGN KEY(attempt_id, upload_id, race_id, media_type, sha256, byte_length)
    REFERENCES map_upload_attempt(id, upload_id, race_id, media_type, sha256, byte_length),
  CONSTRAINT map_object_manifest_media_type_check CHECK(media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT map_object_manifest_sha256_check CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_object_manifest_byte_length_check CHECK(byte_length BETWEEN 1 AND 52428800),
  CONSTRAINT map_object_manifest_object_key_check CHECK(object_key = 'map/' || race_id::text || '/' || attempt_id::text),
  CONSTRAINT map_object_manifest_version_id_check CHECK(char_length(version_id) BETWEEN 1 AND 1024 AND version_id ~ '^[A-Za-z0-9._~+/-]+$' AND version_id <> 'null')
);

CREATE TABLE map_publication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  manifest_id uuid,
  source_hash text,
  intent jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT map_publication_request_uidx UNIQUE(request_id),
  CONSTRAINT map_publication_race_revision_uidx UNIQUE(race_id, revision),
  CONSTRAINT map_publication_id_scope_uidx UNIQUE(id, race_id, revision),
  CONSTRAINT map_publication_race_fk FOREIGN KEY(race_id) REFERENCES race(id),
  CONSTRAINT map_publication_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT map_publication_manifest_scope_fk FOREIGN KEY(manifest_id, race_id)
    REFERENCES map_object_manifest(upload_id, race_id),
  CONSTRAINT map_publication_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT map_publication_revision_check CHECK(revision > 0),
  CONSTRAINT map_publication_action_check CHECK(action IN ('PUBLISH', 'WITHDRAW')),
  CONSTRAINT map_publication_intent_check CHECK(jsonb_typeof(intent) = 'object'),
  CONSTRAINT map_publication_payload_check CHECK(
    (action = 'PUBLISH' AND manifest_id IS NOT NULL AND source_hash IS NOT NULL AND source_hash ~ '^[a-f0-9]{64}$')
    OR (action = 'WITHDRAW' AND manifest_id IS NULL AND source_hash IS NULL)
  )
);

CREATE INDEX map_publication_race_revision_idx ON map_publication(race_id, revision DESC);

CREATE TRIGGER map_upload_reservation_immutable
BEFORE UPDATE OR DELETE ON map_upload_reservation
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER map_upload_attempt_immutable
BEFORE UPDATE OR DELETE ON map_upload_attempt
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER map_object_manifest_immutable
BEFORE UPDATE OR DELETE ON map_object_manifest
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER map_publication_immutable
BEFORE UPDATE OR DELETE ON map_publication
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback/restore: disable map upload/release routes and restore a verified
-- PostgreSQL backup together with the exact private object versions. Do not
-- delete or rewrite map manifests or publication history as an operational
-- rollback; a later withdraw/release is a new immutable journal row.
