-- Steg 52 (ADR-0176): banhemlighet. Arrangörens val "Visa banorna publikt nu" (NULL = inte valt; går att ångra).
-- Utan valet visas banorna publikt först när ingen deltagare är kvar eller resultaten är fastställda.
ALTER TABLE race ADD COLUMN IF NOT EXISTS courses_public_at timestamp with time zone;
--> statement-breakpoint
-- Steg 52: kontrollernas, startens och målets lägen på kartan ur banfilen (IOF MapPosition, millimeter) och kartans skala
-- (IOF RaceCourseData/Map/Scale). Kontrollkartan använder dem när lägena i WGS 84 saknas.
ALTER TABLE control ADD COLUMN IF NOT EXISTS map_x double precision;
--> statement-breakpoint
ALTER TABLE control ADD COLUMN IF NOT EXISTS map_y double precision;
--> statement-breakpoint
ALTER TABLE control DROP CONSTRAINT IF EXISTS control_map_position_check;
--> statement-breakpoint
ALTER TABLE control ADD CONSTRAINT control_map_position_check CHECK ((map_x IS NULL) = (map_y IS NULL) AND
  (map_x IS NULL OR (abs(map_x) <= 100000 AND abs(map_y) <= 100000)));
--> statement-breakpoint
ALTER TABLE course ADD COLUMN IF NOT EXISTS start_map_position jsonb;
--> statement-breakpoint
ALTER TABLE course ADD COLUMN IF NOT EXISTS finish_map_position jsonb;
--> statement-breakpoint
ALTER TABLE race ADD COLUMN IF NOT EXISTS course_map_scale integer;
--> statement-breakpoint
ALTER TABLE race DROP CONSTRAINT IF EXISTS race_course_map_scale_check;
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_course_map_scale_check CHECK (course_map_scale IS NULL OR course_map_scale BETWEEN 100 AND 1000000);
