-- TASK119 / ADR-0129. Private immutable control geometry; no public course or route overlay.
ALTER TABLE course_control ADD CONSTRAINT course_control_id_version_uidx UNIQUE(id, course_version_id);

CREATE TABLE course_control_geometry_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id),
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  map_manifest_id uuid NOT NULL,
  georeference_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revision integer NOT NULL,
  source_hash text NOT NULL,
  intent jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT course_control_geometry_revision_uidx UNIQUE(course_version_id, map_manifest_id, revision),
  CONSTRAINT course_control_geometry_map_scope_fk FOREIGN KEY(map_manifest_id, race_id) REFERENCES map_object_manifest(upload_id, race_id),
  CONSTRAINT course_control_geometry_georeference_scope_fk FOREIGN KEY(georeference_id, race_id) REFERENCES map_georeference(id, race_id),
  CONSTRAINT course_control_geometry_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT course_control_geometry_capability_check CHECK(capability::text = 'MANAGE_RACE'),
  CONSTRAINT course_control_geometry_revision_check CHECK(revision > 0),
  CONSTRAINT course_control_geometry_source_hash_check CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT course_control_geometry_intent_check CHECK(jsonb_typeof(intent) = 'object')
);
CREATE INDEX course_control_geometry_latest_idx ON course_control_geometry_revision(course_version_id, map_manifest_id, revision DESC);
CREATE TRIGGER course_control_geometry_revision_immutable BEFORE UPDATE OR DELETE ON course_control_geometry_revision FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE course_control_geometry_point (
  revision_id uuid NOT NULL REFERENCES course_control_geometry_revision(id),
  course_control_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  sequence integer NOT NULL,
  pixel_x double precision NOT NULL,
  pixel_y double precision NOT NULL,
  CONSTRAINT course_control_geometry_point_control_uidx UNIQUE(revision_id, course_control_id),
  CONSTRAINT course_control_geometry_point_sequence_uidx UNIQUE(revision_id, sequence),
  CONSTRAINT course_control_geometry_point_sequence_check CHECK(sequence > 0),
  CONSTRAINT course_control_geometry_point_finite_check CHECK(pixel_x = pixel_x AND pixel_y = pixel_y),
  CONSTRAINT course_control_geometry_point_control_scope_fk FOREIGN KEY(course_control_id, course_version_id) REFERENCES course_control(id, course_version_id)
);
CREATE TRIGGER course_control_geometry_point_immutable BEFORE UPDATE OR DELETE ON course_control_geometry_point FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only. Disable the private writer/UI during an incident and restore a verified backup;
-- never delete or rewrite geometry history. Correct with a later revision.
