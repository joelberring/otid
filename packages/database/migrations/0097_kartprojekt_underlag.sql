-- ADR-0219 (steg K4a, tillägget om underlagen): egna underlag i kartprojektet, en georefererad bild (ortofoto, skannad gammal
-- karta, skuggning) som visas under eller över kartan med genomskinlighet. Bilden lagras som annat kartinnehåll (ADR-0189:
-- `map_content`, en gång per sha256, kvot per konto) och georeferensen som en affin transform från bildens pixlar till
-- koordinatsystemets enheter (världsfilens sex tal) med EPSG-numret.
--
-- Rättelse: funktionen som släpper kartinnehåll när sista referensen försvinner (0044, 0061) kände inte till kartprojektens
-- grundfil och versioner (0089, 0090). Fanns samma fil också i klubbarkivet stoppades borttagningen där av främmande nyckeln
-- (serverfel). Nu räknas de, och underlagen, som referenser.
--
-- Bara tillägg och en ersatt funktion (migrations/README.md).
CREATE TABLE IF NOT EXISTS map_project_layer (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  content_sha256 text NOT NULL,
  media_type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  crs integer NOT NULL,
  transform jsonb NOT NULL,
  opacity real NOT NULL DEFAULT 0.5,
  sort integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT map_project_layer_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_layer_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_layer_content_fkey FOREIGN KEY (content_sha256) REFERENCES map_content (sha256),
  CONSTRAINT map_project_layer_request_key UNIQUE (request_id),
  CONSTRAINT map_project_layer_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT map_project_layer_media_check CHECK (media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT map_project_layer_size_check CHECK (width BETWEEN 1 AND 30000 AND height BETWEEN 1 AND 30000),
  CONSTRAINT map_project_layer_crs_check CHECK (crs BETWEEN 1 AND 999999),
  CONSTRAINT map_project_layer_transform_check CHECK (jsonb_typeof(transform) = 'object' AND pg_column_size(transform) <= 1024),
  CONSTRAINT map_project_layer_opacity_check CHECK (opacity >= 0 AND opacity <= 1)
);
CREATE INDEX IF NOT EXISTS map_project_layer_project_idx ON map_project_layer (project_id, sort);
CREATE INDEX IF NOT EXISTS map_project_layer_content_idx ON map_project_layer (content_sha256);

CREATE OR REPLACE FUNCTION otid_map_content_release(p_sha text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sha IS NULL THEN RETURN; END IF;
  SELECT content_id INTO v_id FROM map_content WHERE sha256 = p_sha FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM race_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM race_map_source WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map_source WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM club_map_version WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project WHERE base_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_output WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_layer WHERE content_sha256 = p_sha) THEN
    RETURN;
  END IF;
  DELETE FROM map_content WHERE sha256 = p_sha;
  DELETE FROM map_content_part WHERE content_id = v_id;
END;
$$;

DROP TRIGGER IF EXISTS map_project_layer_content_release ON map_project_layer;
CREATE TRIGGER map_project_layer_content_release AFTER DELETE OR UPDATE OF content_sha256 ON map_project_layer
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
