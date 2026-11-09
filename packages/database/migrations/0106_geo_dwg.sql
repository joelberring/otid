-- ADR-0219 K6b (ägaren 2026-11-09): geo-arbetaren gör också om DWG-ritningar till DXF (LibreDWG), så att baskartor i DWG kan
-- läsas in som kandidater. Bara en vidare kontroll av jobbets slag; inga data ändras.
ALTER TABLE map_project_geo_job DROP CONSTRAINT IF EXISTS map_project_geo_job_kind_check;
ALTER TABLE map_project_geo_job ADD CONSTRAINT map_project_geo_job_kind_check CHECK (kind IN ('PULLAUTIN', 'DWG'));
