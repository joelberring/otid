-- Etapp 2: Nedladdningsspärr för kartprojekt (`map_project.source_download_policy`).
ALTER TABLE map_project
  ADD COLUMN IF NOT EXISTS source_download_policy text NOT NULL DEFAULT 'ALLOWED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_source_download_policy_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_source_download_policy_check
      CHECK (source_download_policy IN ('ALLOWED', 'CUSTODIANS_ONLY'));
  END IF;
END $$;
