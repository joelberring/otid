-- TASK155 / ADR-0149. Explicit immutable context for one private GPX manifest.
-- Additive only: no historical route, result, map or context is backfilled.

-- Composite keys let the journal prove that its hashes and version identities
-- belong to the exact referenced immutable source rows.
CREATE UNIQUE INDEX map_object_manifest_context_scope_uidx
  ON map_object_manifest(upload_id, race_id, sha256);
CREATE UNIQUE INDEX map_georeference_context_scope_uidx
  ON map_georeference(id, race_id, manifest_id);
CREATE UNIQUE INDEX course_control_geometry_context_scope_uidx
  ON course_control_geometry_revision(id, race_id, course_version_id, map_manifest_id, georeference_id);
CREATE UNIQUE INDEX route_object_manifest_context_scope_uidx
  ON route_object_manifest(upload_id, race_id, entry_id, sha256);
CREATE UNIQUE INDEX result_revision_private_route_context_scope_uidx
  ON result_revision(id, race_id, entry_id, revision, course_version_id);

CREATE TABLE private_route_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  route_manifest_id uuid NOT NULL,
  route_source_hash text NOT NULL,
  map_manifest_id uuid NOT NULL,
  map_source_hash text NOT NULL,
  georeference_id uuid NOT NULL,
  geometry_revision_id uuid NOT NULL,
  source_result_revision_id uuid NOT NULL,
  source_result_revision integer NOT NULL,
  course_version_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revision integer NOT NULL,
  intent jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT private_route_context_entry_scope_fk FOREIGN KEY(entry_id, race_id)
    REFERENCES entry(id, race_id),
  CONSTRAINT private_route_context_route_scope_fk FOREIGN KEY(route_manifest_id, race_id, entry_id, route_source_hash)
    REFERENCES route_object_manifest(upload_id, race_id, entry_id, sha256),
  CONSTRAINT private_route_context_map_scope_fk FOREIGN KEY(map_manifest_id, race_id, map_source_hash)
    REFERENCES map_object_manifest(upload_id, race_id, sha256),
  CONSTRAINT private_route_context_georeference_scope_fk FOREIGN KEY(georeference_id, race_id, map_manifest_id)
    REFERENCES map_georeference(id, race_id, manifest_id),
  CONSTRAINT private_route_context_geometry_scope_fk FOREIGN KEY(geometry_revision_id, race_id, course_version_id, map_manifest_id, georeference_id)
    REFERENCES course_control_geometry_revision(id, race_id, course_version_id, map_manifest_id, georeference_id),
  CONSTRAINT private_route_context_result_scope_fk FOREIGN KEY(source_result_revision_id, race_id, entry_id, source_result_revision, course_version_id)
    REFERENCES result_revision(id, race_id, entry_id, revision, course_version_id),
  CONSTRAINT private_route_context_course_version_fk FOREIGN KEY(course_version_id)
    REFERENCES course_version(id),
  CONSTRAINT private_route_context_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT private_route_context_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT private_route_context_revision_check CHECK(revision BETWEEN 1 AND 2147483647),
  CONSTRAINT private_route_context_source_result_revision_check CHECK(source_result_revision BETWEEN 1 AND 2147483647),
  CONSTRAINT private_route_context_route_hash_check CHECK(route_source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT private_route_context_map_hash_check CHECK(map_source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT private_route_context_intent_check CHECK(jsonb_typeof(intent) = 'object')
);

CREATE UNIQUE INDEX private_route_context_request_uidx
  ON private_route_context(request_id);
CREATE UNIQUE INDEX private_route_context_route_revision_uidx
  ON private_route_context(route_manifest_id, revision);
CREATE INDEX private_route_context_route_latest_idx
  ON private_route_context(route_manifest_id, revision DESC);

CREATE TRIGGER private_route_context_immutable
  BEFORE UPDATE OR DELETE ON private_route_context
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore note: disable TASK155 context write/read/image routes and retain this
-- journal. Restore a verified full PostgreSQL backup together with the exact
-- referenced object versions; never delete or rewrite context history.
