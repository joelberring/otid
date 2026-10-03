-- TASK117 / ADR-0127. Exact public route/map/calibration selection; no route bytes are copied.
ALTER TABLE map_georeference ADD CONSTRAINT map_georeference_id_race_uidx UNIQUE(id, race_id);
CREATE TABLE route_publication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  route_manifest_id uuid,
  route_source_hash text,
  map_manifest_id uuid,
  map_source_hash text,
  georeference_id uuid,
  intent jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT route_publication_entry_revision_uidx UNIQUE(entry_id, revision),
  CONSTRAINT route_publication_capability_check CHECK(capability::text = 'MANAGE_RACE'),
  CONSTRAINT route_publication_revision_check CHECK(revision BETWEEN 1 AND 2147483647),
  CONSTRAINT route_publication_action_check CHECK(action IN ('RELEASE', 'WITHDRAW')),
  CONSTRAINT route_publication_intent_check CHECK(jsonb_typeof(intent) = 'object'),
  CONSTRAINT route_publication_payload_check CHECK(
    (action = 'RELEASE' AND route_manifest_id IS NOT NULL AND route_source_hash ~ '^[a-f0-9]{64}$' AND map_manifest_id IS NOT NULL AND map_source_hash ~ '^[a-f0-9]{64}$' AND georeference_id IS NOT NULL)
    OR (action = 'WITHDRAW' AND route_manifest_id IS NULL AND route_source_hash IS NULL AND map_manifest_id IS NULL AND map_source_hash IS NULL AND georeference_id IS NULL)
  ),
  CONSTRAINT route_publication_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT route_publication_route_scope_fk FOREIGN KEY(route_manifest_id, race_id, entry_id) REFERENCES route_object_manifest(upload_id, race_id, entry_id),
  CONSTRAINT route_publication_map_scope_fk FOREIGN KEY(map_manifest_id, race_id) REFERENCES map_object_manifest(upload_id, race_id),
  CONSTRAINT route_publication_georeference_scope_fk FOREIGN KEY(georeference_id, race_id) REFERENCES map_georeference(id, race_id),
  CONSTRAINT route_publication_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE INDEX route_publication_entry_latest_idx ON route_publication(entry_id, revision DESC);
CREATE TRIGGER route_publication_immutable BEFORE UPDATE OR DELETE ON route_publication FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Expand-only. At incident disable the route-release writer and public route reader;
-- do not drop or rewrite history. Restore verified PostgreSQL/object-store backups or correct forward.
