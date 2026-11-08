-- ADR-0219 K5 (ägaren 2026-11-08): geo-arbetarens jobb (Karttapullautin på laserdata) och deras resultatfiler. Jobben körs av
-- en egen geo-server som hämtar dem över HTTPS; resultaten ligger i kartinnehållet tills jobbet tas bort.
CREATE TABLE IF NOT EXISTS map_project_geo_job (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  request jsonb NOT NULL,
  progress jsonb,
  result jsonb,
  error text,
  worker text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  request_id uuid NOT NULL,
  CONSTRAINT map_project_geo_job_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_geo_job_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id) ON DELETE CASCADE,
  CONSTRAINT map_project_geo_job_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id) ON DELETE CASCADE,
  CONSTRAINT map_project_geo_job_request_key UNIQUE (request_id),
  CONSTRAINT map_project_geo_job_kind_check CHECK (kind IN ('PULLAUTIN')),
  CONSTRAINT map_project_geo_job_status_check CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  CONSTRAINT map_project_geo_job_request_check CHECK (jsonb_typeof(request) = 'object' AND pg_column_size(request) <= 65536),
  CONSTRAINT map_project_geo_job_error_check CHECK (error IS NULL OR char_length(error) <= 2000)
);
CREATE INDEX IF NOT EXISTS map_project_geo_job_queue_idx ON map_project_geo_job (status, created_at);
CREATE INDEX IF NOT EXISTS map_project_geo_job_project_idx ON map_project_geo_job (project_id, created_at);

CREATE TABLE IF NOT EXISTS map_project_geo_output (
  job_id uuid NOT NULL,
  name text NOT NULL,
  content_sha256 text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT map_project_geo_output_pkey PRIMARY KEY (job_id, name),
  CONSTRAINT map_project_geo_output_job_fkey FOREIGN KEY (job_id) REFERENCES map_project_geo_job (id) ON DELETE CASCADE,
  CONSTRAINT map_project_geo_output_content_fkey FOREIGN KEY (content_sha256) REFERENCES map_content (sha256),
  CONSTRAINT map_project_geo_output_name_check CHECK (name ~ '^[a-z0-9_.-]{1,60}$')
);
CREATE INDEX IF NOT EXISTS map_project_geo_output_content_idx ON map_project_geo_output (content_sha256);

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
    OR EXISTS (SELECT 1 FROM map_project_layer WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_geo_output WHERE content_sha256 = p_sha) THEN
    RETURN;
  END IF;
  DELETE FROM map_content WHERE sha256 = p_sha;
  DELETE FROM map_content_part WHERE content_id = v_id;
END;
$$;

DROP TRIGGER IF EXISTS map_project_geo_output_content_release ON map_project_geo_output;
CREATE TRIGGER map_project_geo_output_content_release AFTER DELETE OR UPDATE OF content_sha256 ON map_project_geo_output
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
