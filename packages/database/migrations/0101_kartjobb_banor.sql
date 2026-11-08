-- Ägaren 2026-11-08 (AI-banläggningsassistenten): kartjobben kan också gälla en tävlings banläggning (en bild av en bana på
-- tävlingens karta, ritad i utskriftsarbetaren). Ett jobb gäller antingen ett kartprojekt eller en tävling.
--
-- Bara tillägg och en lättad regel (migrations/README.md): `project_id` får vara tom, en ny nullbar kolumn `race_id` (tas
-- bort med tävlingen) och en kontroll att precis en av dem är satt (alla befintliga rader har `project_id`).
ALTER TABLE map_project_job ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE map_project_job ADD COLUMN IF NOT EXISTS race_id uuid REFERENCES race (id) ON DELETE CASCADE;
ALTER TABLE map_project_job DROP CONSTRAINT IF EXISTS map_project_job_target_check;
ALTER TABLE map_project_job ADD CONSTRAINT map_project_job_target_check CHECK ((project_id IS NULL) <> (race_id IS NULL));
