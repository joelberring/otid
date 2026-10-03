-- ADR-0055. Additive, immutable recovery provenance only; no route or CLI is enabled here.
CREATE UNIQUE INDEX start_checkin_device_capability_scope_uidx
  ON start_checkin_device(id, race_id, actor_credential_id, capability);
CREATE UNIQUE INDEX start_checkin_operation_recovery_source_uidx
  ON start_checkin_operation(request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash);

CREATE TABLE checkin_recovery_grant (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  race_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  manifest_canonical_json text NOT NULL,
  manifest_hash text NOT NULL,
  secret_hash text NOT NULL,
  first_sequence integer NOT NULL,
  last_sequence integer NOT NULL,
  operator_label text NOT NULL,
  reason text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT checkin_recovery_grant_capability_check CHECK (capability::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH')),
  CONSTRAINT checkin_recovery_grant_manifest_check CHECK (jsonb_typeof(manifest_canonical_json::jsonb) = 'object'),
  CONSTRAINT checkin_recovery_grant_hash_check CHECK (manifest_hash ~ '^[a-f0-9]{64}$' AND secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT checkin_recovery_grant_sequence_check CHECK (first_sequence > 0 AND last_sequence >= first_sequence),
  CONSTRAINT checkin_recovery_grant_operator_label_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT checkin_recovery_grant_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT checkin_recovery_grant_lifetime_check CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '1 hour'),
  CONSTRAINT checkin_recovery_grant_device_scope_fk FOREIGN KEY (device_id, race_id, actor_credential_id, capability)
    REFERENCES start_checkin_device(id, race_id, actor_credential_id, capability),
  CONSTRAINT checkin_recovery_grant_credential_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE UNIQUE INDEX checkin_recovery_grant_scope_uidx ON checkin_recovery_grant(id, device_id, actor_credential_id, race_id);
CREATE INDEX checkin_recovery_grant_race_expiry_idx ON checkin_recovery_grant(race_id, expires_at);

CREATE TABLE checkin_recovery_grant_item (
  grant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  race_id uuid NOT NULL,
  local_sequence integer NOT NULL,
  content_hash text NOT NULL,
  CONSTRAINT checkin_recovery_grant_item_sequence_check CHECK (local_sequence > 0),
  CONSTRAINT checkin_recovery_grant_item_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT checkin_recovery_grant_item_grant_scope_fk FOREIGN KEY (grant_id, device_id, actor_credential_id, race_id)
    REFERENCES checkin_recovery_grant(id, device_id, actor_credential_id, race_id)
);
CREATE UNIQUE INDEX checkin_recovery_grant_item_pk ON checkin_recovery_grant_item(grant_id, request_id);
CREATE UNIQUE INDEX checkin_recovery_grant_item_sequence_uidx ON checkin_recovery_grant_item(grant_id, local_sequence);
CREATE UNIQUE INDEX checkin_recovery_grant_item_delivery_scope_uidx
  ON checkin_recovery_grant_item(grant_id, request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash);

CREATE TABLE checkin_recovery_grant_revocation (
  grant_id uuid PRIMARY KEY REFERENCES checkin_recovery_grant(id),
  operator_label text NOT NULL,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL,
  CONSTRAINT checkin_recovery_grant_revocation_operator_label_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT checkin_recovery_grant_revocation_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE TABLE checkin_recovery_delivery (
  grant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  race_id uuid NOT NULL,
  local_sequence integer NOT NULL,
  content_hash text NOT NULL,
  delivered_at timestamptz NOT NULL,
  CONSTRAINT checkin_recovery_delivery_sequence_check CHECK (local_sequence > 0),
  CONSTRAINT checkin_recovery_delivery_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT checkin_recovery_delivery_item_scope_hash_fk FOREIGN KEY
    (grant_id, request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash)
    REFERENCES checkin_recovery_grant_item(grant_id, request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash),
  CONSTRAINT checkin_recovery_delivery_operation_scope_hash_fk FOREIGN KEY
    (request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash)
    REFERENCES start_checkin_operation(request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash)
);
CREATE UNIQUE INDEX checkin_recovery_delivery_pk ON checkin_recovery_delivery(grant_id, request_id);

CREATE TRIGGER checkin_recovery_grant_immutable BEFORE UPDATE OR DELETE ON checkin_recovery_grant
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER checkin_recovery_grant_item_immutable BEFORE UPDATE OR DELETE ON checkin_recovery_grant_item
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER checkin_recovery_grant_revocation_immutable BEFORE UPDATE OR DELETE ON checkin_recovery_grant_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER checkin_recovery_delivery_immutable BEFORE UPDATE OR DELETE ON checkin_recovery_delivery
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the recovery CLI/route and preserve every grant, item,
-- revocation and delivery. Do not run a destructive down migration. Restore a
-- verified complete PostgreSQL backup, or correct forward with a new migration.
