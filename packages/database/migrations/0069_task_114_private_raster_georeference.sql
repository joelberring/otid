-- TASK114 / ADR-0124. Private immutable affine calibration for exact map bytes.
-- This migration does not publish maps or read/store GPX routes.

CREATE TABLE map_georeference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id),
  manifest_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revision integer NOT NULL,
  source_hash text NOT NULL,
  intent jsonb NOT NULL,
  image_width integer NOT NULL,
  image_height integer NOT NULL,
  crs text NOT NULL,
  tie_points jsonb NOT NULL,
  transform jsonb NOT NULL,
  max_residual_meters double precision NOT NULL,
  decided_at timestamptz NOT NULL,
  CONSTRAINT map_georeference_race_revision_uidx UNIQUE(race_id, revision),
  CONSTRAINT map_georeference_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT map_georeference_manifest_scope_fk FOREIGN KEY(manifest_id, race_id)
    REFERENCES map_object_manifest(upload_id, race_id),
  CONSTRAINT map_georeference_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT map_georeference_revision_check CHECK(revision > 0),
  CONSTRAINT map_georeference_source_hash_check CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_georeference_intent_check CHECK(jsonb_typeof(intent) = 'object'),
  CONSTRAINT map_georeference_dimensions_check CHECK(image_width BETWEEN 1 AND 200000 AND image_height BETWEEN 1 AND 200000),
  CONSTRAINT map_georeference_crs_check CHECK(crs = 'EPSG:4326'),
  CONSTRAINT map_georeference_tie_points_check CHECK(jsonb_typeof(tie_points) = 'array' AND jsonb_array_length(tie_points) = 3),
  CONSTRAINT map_georeference_transform_check CHECK(jsonb_typeof(transform) = 'object'),
  CONSTRAINT map_georeference_residual_check CHECK(max_residual_meters >= 0 AND max_residual_meters <= 0.01)
);
CREATE INDEX map_georeference_race_revision_idx ON map_georeference(race_id, revision DESC);

CREATE TRIGGER map_georeference_immutable
BEFORE UPDATE OR DELETE ON map_georeference
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only. At incident, disable the private calibration writer/UI and
-- restore a verified PostgreSQL backup. Do not delete or rewrite a calibration
-- journal; correct forward with a new immutable revision. Map publication and
-- all route data remain separate and unchanged.
