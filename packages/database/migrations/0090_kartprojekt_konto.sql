-- ADR-0219 (rättelse 2026-11-07): ett kartprojekt ägs av sina medlemmar, inte av en klubb. Klubben är valfri: ett projekt kan
-- utgå från en kartversion i klubbarkivet (som i 0089), från en egen uppladdad kartfil eller från en ny tom karta (K1).
-- Ett nytt resultat sparas alltid i projektet (innehåll och filnamn) och läggs dessutom i klubbarkivet när projektet hör till
-- en klubb och den som skriver är administratör där.
--
-- Bara lättnader och tillägg (migrations/README.md): två kolumner blir nullbara, nya nullbara kolumner och nya villkor som
-- befintliga rader redan uppfyller (alla rader från 0089 har klubb och kartversion).

ALTER TABLE map_project ALTER COLUMN club_id DROP NOT NULL;
ALTER TABLE map_project ALTER COLUMN base_version_id DROP NOT NULL;
-- Grundfilens namn när den inte kommer från klubbarkivet (där står namnet på kartversionen).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS base_file_name text;
-- Var grundfilen kom ifrån (`MapProjectBaseSource` i contracts: ARCHIVE, UPLOAD eller NEW); null = ARCHIVE (rader från 0089).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS base_source text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_base_file_name_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_base_file_name_check
      CHECK (base_file_name IS NULL OR char_length(btrim(base_file_name)) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_base_source_kind_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_base_source_kind_check CHECK (base_source IS NULL OR base_source ~ '^[A-Z][A-Z_]{1,30}$');
  END IF;
  -- Grundfilen har alltid ett namn: kartversionens eller projektets eget.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_base_source_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_base_source_check
      CHECK (base_version_id IS NOT NULL OR base_file_name IS NOT NULL);
  END IF;
  -- En kartversion ur arkivet hör alltid till en klubb.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_version_club_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_version_club_check
      CHECK (base_version_id IS NULL OR club_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS map_project_created_by_idx ON map_project (created_by, created_at);

-- Resultaten: innehållet och filnamnet sparas i projektet; kartversionen bara när resultatet också lades i klubbarkivet.
ALTER TABLE map_project_output ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE map_project_output ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE map_project_output ADD COLUMN IF NOT EXISTS file_name text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_output_content_fkey') THEN
    ALTER TABLE map_project_output ADD CONSTRAINT map_project_output_content_fkey
      FOREIGN KEY (content_sha256) REFERENCES map_content (sha256);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_output_target_check') THEN
    ALTER TABLE map_project_output ADD CONSTRAINT map_project_output_target_check
      CHECK (version_id IS NOT NULL OR (content_sha256 IS NOT NULL AND file_name IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_output_file_name_check') THEN
    ALTER TABLE map_project_output ADD CONSTRAINT map_project_output_file_name_check
      CHECK (file_name IS NULL OR char_length(btrim(file_name)) BETWEEN 1 AND 200);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS map_project_output_content_idx ON map_project_output (content_sha256) WHERE content_sha256 IS NOT NULL;
