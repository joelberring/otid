-- Ägaren 2026-11-15 (Tyresta): AI-kopplingens «lägg in grundkartan» (apply_base_map) svarade Bad Gateway. Jobbets begäran bär
-- OpenStreetMap, hyggena och jordarterna för kartans område, och i Tyresta blev den större än villkorets 256 kB
-- (map_project_job_request_check). Gränsen höjs till 16 MB; jobbet läses ändå utan OpenStreetMap och hyggena när det tas.
--
-- Bara en lättnad (migrations/README.md): villkoret byts mot samma villkor med högre gräns. Äldre kod skriver aldrig större
-- begäran än förut, och alla befintliga rader klarar det nya villkoret. NOT VALID och VALIDATE håller låset kort.
ALTER TABLE map_project_job DROP CONSTRAINT IF EXISTS map_project_job_request_check;
ALTER TABLE map_project_job ADD CONSTRAINT map_project_job_request_check
  CHECK (jsonb_typeof(request) = 'object' AND pg_column_size(request) <= 16777216) NOT VALID;
ALTER TABLE map_project_job VALIDATE CONSTRAINT map_project_job_request_check;
