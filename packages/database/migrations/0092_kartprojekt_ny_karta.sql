-- ADR-0219 (K1, nya kartor): ett kartprojekt med en ny tom karta har ett område, polygonen som kartan ska täcka, i kartans mm
-- med y uppåt (som delområdena). Projekt med en befintlig karta har inget område (null).
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn och ett villkor som befintliga rader uppfyller.

ALTER TABLE map_project ADD COLUMN IF NOT EXISTS area jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_area_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_area_check
      CHECK (area IS NULL OR (jsonb_typeof(area) = 'array' AND jsonb_array_length(area) BETWEEN 1 AND 20));
  END IF;
END $$;
