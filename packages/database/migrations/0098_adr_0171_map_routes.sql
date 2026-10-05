-- ADR-0171 / PLAN.md steg 16: karta och vägval. Den parkerade kart- och ruttkoden (MinIO-objekt, reservationer,
-- deltagarlänkar för uppladdning, samtycken, publiceringsjournaler och kontrollgeometri) tas bort. Ingen
-- produktionsdata finns (ADR-0168 beslut 6). I stället: en karta per lopp och en rutt per deltagare, båda i
-- PostgreSQL så att den nattliga pg_dump tar med dem och ingen objektlagring behövs.
DROP TABLE IF EXISTS private_route_context, route_publication, route_publication_consent, route_point,
  route_object_manifest, route_upload_attempt, route_upload_reservation, route_upload_session,
  route_upload_grant_revocation, route_upload_grant, course_control_geometry_point, course_control_geometry_revision,
  map_georeference, map_publication, map_object_manifest, map_upload_attempt, map_upload_reservation CASCADE;

-- Kartbilden (PNG eller JPEG) och dess georeferens: tre punkter med pixel och WGS84 och den affina
-- transformen som domänen räknar ut. Utan georeferens visas inga vägval.
CREATE TABLE race_map (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  file_name text NOT NULL,
  media_type text NOT NULL,
  image bytea NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  tie_points jsonb,
  transform jsonb,
  uploaded_at timestamptz NOT NULL,
  georeferenced_at timestamptz,
  CONSTRAINT race_map_media_type_check CHECK (media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT race_map_size_check CHECK (byte_length BETWEEN 1 AND 31457280 AND byte_length = octet_length(image)),
  CONSTRAINT race_map_dimensions_check CHECK (width BETWEEN 1 AND 30000 AND height BETWEEN 1 AND 30000),
  CONSTRAINT race_map_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT race_map_georeference_check CHECK (
    (tie_points IS NULL) = (transform IS NULL) AND (transform IS NULL) = (georeferenced_at IS NULL) AND
    (tie_points IS NULL OR jsonb_typeof(tie_points) = 'array') AND (transform IS NULL OR jsonb_typeof(transform) = 'object'))
);

-- Löparens GPS-rutt (GPX) med de tolkade punkterna [tid ms, lat, lon] i tidsordning. Bara punkter med tid
-- sparas, eftersom rutten kopplas till sträckorna med stämplingstiderna. Den publika vyn visar bara delen
-- mellan start och mål.
CREATE TABLE participant_route (
  entry_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  file_name text NOT NULL,
  gpx bytea NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  points jsonb NOT NULL,
  point_count integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  uploaded_at timestamptz NOT NULL,
  CONSTRAINT participant_route_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT participant_route_size_check CHECK (byte_length BETWEEN 1 AND 8388608 AND byte_length = octet_length(gpx)),
  CONSTRAINT participant_route_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT participant_route_points_check CHECK (jsonb_typeof(points) = 'array' AND point_count >= 2 AND starts_at < ends_at)
);
CREATE INDEX participant_route_race_idx ON participant_route(race_id);
