-- TASK098 keeps the Eventor API key in its existing server-side connection.
-- These rows bind one pre-existing Testeventor event/race provenance to one
-- race-scoped IMPORT_IOF credential; no new credential secret is introduced.
CREATE UNIQUE INDEX eventor_import_request_provenance_uidx
ON eventor_import_request(request_id, race_id, actor_credential_id);

CREATE TABLE eventor_race_import_grant (
  id uuid PRIMARY KEY,
  eventor_import_request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  recipient_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  issuer_credential_id uuid NOT NULL,
  label text NOT NULL,
  operator_label text NOT NULL,
  issued_at timestamptz NOT NULL,
  CONSTRAINT eventor_race_import_grant_provenance_fk FOREIGN KEY (eventor_import_request_id, race_id, issuer_credential_id)
    REFERENCES eventor_import_request(request_id, race_id, actor_credential_id),
  CONSTRAINT eventor_race_import_grant_recipient_scope_fk FOREIGN KEY (recipient_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT eventor_race_import_grant_capability_check CHECK (capability = 'IMPORT_IOF'),
  CONSTRAINT eventor_race_import_grant_text_check CHECK (length(btrim(label)) BETWEEN 1 AND 120 AND length(btrim(operator_label)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX eventor_race_import_grant_id_race_uidx ON eventor_race_import_grant(id, race_id);
CREATE UNIQUE INDEX eventor_race_import_grant_id_issuer_uidx ON eventor_race_import_grant(id, issuer_credential_id);
CREATE INDEX eventor_race_import_grant_race_time_idx ON eventor_race_import_grant(race_id, issued_at);
CREATE INDEX eventor_race_import_grant_recipient_race_idx ON eventor_race_import_grant(recipient_credential_id, race_id);

CREATE TABLE eventor_race_import_grant_revocation (
  grant_id uuid PRIMARY KEY REFERENCES eventor_race_import_grant(id),
  revoked_at timestamptz NOT NULL,
  issuer_credential_id uuid NOT NULL,
  operator_label text NOT NULL,
  reason text NOT NULL,
  CONSTRAINT eventor_race_import_grant_revocation_issuer_fk FOREIGN KEY (grant_id, issuer_credential_id)
    REFERENCES eventor_race_import_grant(id, issuer_credential_id),
  CONSTRAINT eventor_race_import_grant_revocation_text_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120 AND length(btrim(reason)) BETWEEN 1 AND 240)
);

CREATE TABLE eventor_entry_import_request (
  request_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  event_classes_source_hash text NOT NULL,
  entries_source_hash text NOT NULL,
  mapping_hash text NOT NULL,
  intent_hash text NOT NULL,
  mapping jsonb NOT NULL,
  response jsonb NOT NULL,
  entries_seen integer NOT NULL,
  entries_created integer NOT NULL,
  entries_unchanged integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT eventor_entry_import_request_grant_scope_fk FOREIGN KEY (grant_id, race_id)
    REFERENCES eventor_race_import_grant(id, race_id),
  CONSTRAINT eventor_entry_import_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT eventor_entry_import_request_capability_check CHECK (capability = 'IMPORT_IOF'),
  CONSTRAINT eventor_entry_import_request_hash_check CHECK (event_classes_source_hash ~ '^[a-f0-9]{64}$' AND entries_source_hash ~ '^[a-f0-9]{64}$' AND mapping_hash ~ '^[a-f0-9]{64}$' AND intent_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT eventor_entry_import_request_json_check CHECK (jsonb_typeof(mapping) = 'array' AND jsonb_typeof(response) = 'object'),
  CONSTRAINT eventor_entry_import_request_count_check CHECK (entries_seen BETWEEN 0 AND 10000 AND entries_created BETWEEN 0 AND entries_seen AND entries_unchanged BETWEEN 0 AND entries_seen AND entries_created + entries_unchanged = entries_seen),
  CONSTRAINT eventor_entry_import_request_snapshot_check CHECK (snapshot_version_before > 0 AND snapshot_version_after = snapshot_version_before + CASE WHEN entries_created > 0 THEN 1 ELSE 0 END)
);
CREATE INDEX eventor_entry_import_request_race_time_idx ON eventor_entry_import_request(race_id, created_at);
CREATE UNIQUE INDEX eventor_entry_import_request_intent_uidx ON eventor_entry_import_request(race_id, intent_hash);

CREATE TRIGGER eventor_race_import_grant_immutable BEFORE UPDATE OR DELETE ON eventor_race_import_grant
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER eventor_race_import_grant_revocation_immutable BEFORE UPDATE OR DELETE ON eventor_race_import_grant_revocation
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER eventor_entry_import_request_immutable BEFORE UPDATE OR DELETE ON eventor_entry_import_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable TASK098 routes and revoke grants/connections. Preserve all
-- immutable grants, receipts and imported entries; repair forward or restore a
-- verified PostgreSQL backup. Do not delete history to retry an import.
