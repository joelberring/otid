-- TASK116 / ADR-0126. This is private participant consent evidence, never a public route release.
CREATE TABLE route_publication_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  grant_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  source_hash text NOT NULL,
  revision integer NOT NULL,
  decision text NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT route_publication_consent_manifest_revision_uidx UNIQUE(manifest_id, revision),
  CONSTRAINT route_publication_consent_hash_check CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT route_publication_consent_revision_check CHECK(revision BETWEEN 1 AND 2147483647),
  CONSTRAINT route_publication_consent_decision_check CHECK(decision IN ('GRANT', 'WITHDRAW')),
  CONSTRAINT route_publication_consent_manifest_scope_fk FOREIGN KEY(manifest_id, race_id, entry_id)
    REFERENCES route_object_manifest(upload_id, race_id, entry_id),
  CONSTRAINT route_publication_consent_grant_scope_fk FOREIGN KEY(grant_id, race_id, entry_id)
    REFERENCES route_upload_grant(id, race_id, entry_id)
);
CREATE INDEX route_publication_consent_manifest_latest_idx ON route_publication_consent(manifest_id, revision DESC);
CREATE TRIGGER route_publication_consent_immutable BEFORE UPDATE OR DELETE ON route_publication_consent FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Expand-only. At incident disable the consent writer; do not drop or rewrite consent history.
-- Restore a verified PostgreSQL backup or correct forward. No route object or public projection is changed.
