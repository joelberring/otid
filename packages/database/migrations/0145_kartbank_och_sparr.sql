-- Etapp 3.1: Publik sökbar kartbank (`public_map_listing`) samt nedladdnings- och användningsspärrar
-- på klubbkartor (`club_map`), kartversioner (`club_map_version`) och tävlings-/träningskartkällor.

ALTER TABLE club_map
  ADD COLUMN IF NOT EXISTS source_download_policy text NOT NULL DEFAULT 'ALLOWED',
  ADD COLUMN IF NOT EXISTS usage_scope text NOT NULL DEFAULT 'ANY';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_map_source_download_policy_check') THEN
    ALTER TABLE club_map ADD CONSTRAINT club_map_source_download_policy_check
      CHECK (source_download_policy IN ('ALLOWED', 'CUSTODIANS_ONLY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_map_usage_scope_check') THEN
    ALTER TABLE club_map ADD CONSTRAINT club_map_usage_scope_check
      CHECK (usage_scope IN ('ANY', 'CLUB_ACTIVITIES_ONLY', 'ADMIN_ONLY'));
  END IF;
END $$;

ALTER TABLE club_map_version
  ADD COLUMN IF NOT EXISTS min_lon double precision,
  ADD COLUMN IF NOT EXISTS max_lon double precision,
  ADD COLUMN IF NOT EXISTS min_lat double precision,
  ADD COLUMN IF NOT EXISTS max_lat double precision,
  ADD COLUMN IF NOT EXISTS footprint jsonb,
  ADD COLUMN IF NOT EXISTS scale integer,
  ADD COLUMN IF NOT EXISTS norm text,
  ADD COLUMN IF NOT EXISTS preview_content_sha256 text REFERENCES map_content (sha256) ON DELETE SET NULL;

ALTER TABLE race_map_source
  ADD COLUMN IF NOT EXISTS club_map_id uuid,
  ADD COLUMN IF NOT EXISTS club_map_version_id uuid,
  ADD COLUMN IF NOT EXISTS public_listing_id uuid,
  ADD COLUMN IF NOT EXISTS source_download_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_scope text NOT NULL DEFAULT 'ANY';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_map_source_usage_scope_check') THEN
    ALTER TABLE race_map_source ADD CONSTRAINT race_map_source_usage_scope_check
      CHECK (usage_scope IN ('ANY', 'CLUB_ACTIVITIES_ONLY', 'ADMIN_ONLY'));
  END IF;
END $$;

ALTER TABLE training_group_map_source
  ADD COLUMN IF NOT EXISTS club_map_id uuid,
  ADD COLUMN IF NOT EXISTS club_map_version_id uuid,
  ADD COLUMN IF NOT EXISTS public_listing_id uuid,
  ADD COLUMN IF NOT EXISTS source_download_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_scope text NOT NULL DEFAULT 'ANY';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_group_map_source_usage_scope_check') THEN
    ALTER TABLE training_group_map_source ADD CONSTRAINT training_group_map_source_usage_scope_check
      CHECK (usage_scope IN ('ANY', 'CLUB_ACTIVITIES_ONLY', 'ADMIN_ONLY'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public_map_listing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  club_id uuid REFERENCES club (id) ON DELETE CASCADE,
  club_map_id uuid REFERENCES club_map (id) ON DELETE CASCADE,
  club_map_version_id uuid REFERENCES club_map_version (id) ON DELETE SET NULL,
  map_project_id uuid REFERENCES map_project (id) ON DELETE CASCADE,
  content_sha256 text NOT NULL REFERENCES map_content (sha256),
  preview_content_sha256 text REFERENCES map_content (sha256) ON DELETE SET NULL,
  format text NOT NULL,
  access_mode text NOT NULL DEFAULT 'INFO_ONLY',
  show_preview boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  club_name text NOT NULL DEFAULT '',
  maker text NOT NULL DEFAULT '',
  scale integer,
  norm text NOT NULL DEFAULT 'OTHER',
  map_year integer,
  license_note text NOT NULL DEFAULT '',
  contact text NOT NULL DEFAULT '',
  municipality_codes text[] NOT NULL DEFAULT '{}',
  county_codes text[] NOT NULL DEFAULT '{}',
  min_lon double precision,
  max_lon double precision,
  min_lat double precision,
  max_lat double precision,
  footprint jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_map_listing_format_check CHECK (format IN ('OCD', 'OMAP')),
  CONSTRAINT public_map_listing_access_mode_check CHECK (access_mode IN ('INFO_ONLY', 'USE_IN_OTID_LOCKED', 'OPEN_DOWNLOAD')),
  CONSTRAINT public_map_listing_norm_check CHECK (norm IN ('ISOM', 'ISSprOM', 'OTHER'))
);

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
    OR EXISTS (SELECT 1 FROM club_map_version WHERE content_sha256 = p_sha OR preview_content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project WHERE base_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_output WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_layer WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM map_project_geo_output WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM public_map_listing WHERE content_sha256 = p_sha OR preview_content_sha256 = p_sha) THEN
    RETURN;
  END IF;
  DELETE FROM map_content WHERE sha256 = p_sha;
  DELETE FROM map_content_part WHERE content_id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION otid_map_content_preview_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.preview_content_sha256 IS NOT DISTINCT FROM OLD.preview_content_sha256 THEN RETURN NULL; END IF;
  PERFORM otid_map_content_release(OLD.preview_content_sha256);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS club_map_version_preview_release ON club_map_version;
CREATE TRIGGER club_map_version_preview_release AFTER DELETE OR UPDATE OF preview_content_sha256 ON club_map_version
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_preview_changed();

DROP TRIGGER IF EXISTS public_map_listing_content_release ON public_map_listing;
CREATE TRIGGER public_map_listing_content_release AFTER DELETE OR UPDATE OF content_sha256 ON public_map_listing
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();

DROP TRIGGER IF EXISTS public_map_listing_preview_release ON public_map_listing;
CREATE TRIGGER public_map_listing_preview_release AFTER DELETE OR UPDATE OF preview_content_sha256 ON public_map_listing
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_preview_changed();
