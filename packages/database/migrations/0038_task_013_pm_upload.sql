-- Additive, durable PM upload substrate. Runtime issuance, routes, worker-CAS
-- and publication remain inactive until their separate acceptance gates pass.
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'MANAGE_PM_DOCUMENT';
CREATE TYPE pm_scan_job_state AS ENUM ('PENDING', 'LEASED', 'FINISHED');

ALTER TABLE pairing_admin_access_credential
ADD CONSTRAINT pairing_admin_pm_document_lifetime_check
CHECK (capability::text <> 'MANAGE_PM_DOCUMENT' OR expires_at <= issued_at + interval '8 hours');

CREATE TABLE pm_upload_reservation (
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
  CONSTRAINT pm_upload_reservation_request_uidx UNIQUE (request_id),
  CONSTRAINT pm_upload_reservation_race_slot_uidx UNIQUE (race_id, slot),
  CONSTRAINT pm_upload_reservation_scope_content_uidx UNIQUE (id, race_id, sha256, byte_length),
  CONSTRAINT pm_upload_reservation_capability_check CHECK (capability::text = 'MANAGE_PM_DOCUMENT'),
  CONSTRAINT pm_upload_reservation_slot_check CHECK (slot BETWEEN 1 AND 100),
  CONSTRAINT pm_upload_reservation_title_check CHECK (char_length(title) BETWEEN 1 AND 120 AND title = btrim(title)),
  CONSTRAINT pm_upload_reservation_media_type_check CHECK (media_type = 'application/pdf'),
  CONSTRAINT pm_upload_reservation_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pm_upload_reservation_byte_length_check CHECK (byte_length BETWEEN 1 AND 10485760),
  CONSTRAINT pm_upload_reservation_actor_scope_fk
    FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);

CREATE TABLE pm_upload_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  race_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  charged_at timestamptz NOT NULL,
  CONSTRAINT pm_upload_attempt_upload_number_uidx UNIQUE (upload_id, attempt_number),
  CONSTRAINT pm_upload_attempt_manifest_scope_uidx UNIQUE (id, upload_id, race_id, sha256, byte_length),
  CONSTRAINT pm_upload_attempt_number_check CHECK (attempt_number BETWEEN 1 AND 8),
  CONSTRAINT pm_upload_attempt_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pm_upload_attempt_byte_length_check CHECK (byte_length BETWEEN 1 AND 10485760),
  CONSTRAINT pm_upload_attempt_reservation_content_fk
    FOREIGN KEY (upload_id, race_id, sha256, byte_length)
    REFERENCES pm_upload_reservation(id, race_id, sha256, byte_length)
);

CREATE TABLE pm_object_manifest (
  upload_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  race_id uuid NOT NULL,
  store_id uuid NOT NULL,
  object_key text NOT NULL,
  version_id text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  stored_at timestamptz NOT NULL,
  CONSTRAINT pm_object_manifest_store_key_version_uidx UNIQUE (store_id, object_key, version_id),
  CONSTRAINT pm_object_manifest_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pm_object_manifest_byte_length_check CHECK (byte_length BETWEEN 1 AND 10485760),
  CONSTRAINT pm_object_manifest_object_key_check CHECK (object_key = 'pm/' || race_id::text || '/' || attempt_id::text),
  CONSTRAINT pm_object_manifest_version_id_check CHECK (char_length(version_id) BETWEEN 1 AND 1024 AND version_id ~ '^[A-Za-z0-9._~+/-]+$' AND version_id <> 'null'),
  CONSTRAINT pm_object_manifest_attempt_scope_fk
    FOREIGN KEY (attempt_id, upload_id, race_id, sha256, byte_length)
    REFERENCES pm_upload_attempt(id, upload_id, race_id, sha256, byte_length)
);

CREATE TABLE pm_scan_job (
  upload_id uuid PRIMARY KEY REFERENCES pm_object_manifest(upload_id),
  state pm_scan_job_state NOT NULL DEFAULT 'PENDING',
  generation bigint NOT NULL DEFAULT 0,
  lease_owner uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT pm_scan_job_generation_check CHECK (generation >= 0),
  CONSTRAINT pm_scan_job_lease_shape_check CHECK (
    (state::text = 'LEASED' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL
      AND generation > 0 AND lease_until > created_at)
    OR
    (state::text <> 'LEASED' AND lease_owner IS NULL AND lease_until IS NULL)
  )
);

-- Deliberately deferred to permit manifest + first PENDING job in one commit.
ALTER TABLE pm_object_manifest
ADD CONSTRAINT pm_object_manifest_scan_job_fk
FOREIGN KEY (upload_id) REFERENCES pm_scan_job(upload_id)
DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER pm_upload_reservation_immutable
BEFORE UPDATE OR DELETE ON pm_upload_reservation
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER pm_upload_attempt_immutable
BEFORE UPDATE OR DELETE ON pm_upload_attempt
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER pm_object_manifest_immutable
BEFORE UPDATE OR DELETE ON pm_object_manifest
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
