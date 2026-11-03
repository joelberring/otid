-- ADR-0197: färre gafflingsvarianter. Banläggningen kan välja bort varianter av en fulgafflad bana; bara de behållna förs
-- över som varianter (course_variant). De bortvalda sparas här med banversionen ([{ "code": "BDF", "controlCodes": [31, …] }])
-- så att avläsningen kan säga att en löpare sprungit en bortvald variant i stället för att bara visa felstämplat.
-- Bara en ny kolumn; NULL = inga bortvalda.
ALTER TABLE course_version ADD COLUMN IF NOT EXISTS excluded_variants jsonb;
--> statement-breakpoint
ALTER TABLE course_version DROP CONSTRAINT IF EXISTS course_version_excluded_variants_check;
--> statement-breakpoint
ALTER TABLE course_version ADD CONSTRAINT course_version_excluded_variants_check
  CHECK (excluded_variants IS NULL OR jsonb_typeof(excluded_variants) = 'array');
