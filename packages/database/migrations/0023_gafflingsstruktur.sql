-- Steg 49 (ADR-0175): gafflingsstruktur per banversion, gafflingssätt per bana och längd per variant.
-- Strukturen (grundföljd med enkla gafflingar och fjärilar) sparas med banversionen så att den kan redigeras igen.
-- NULL = ingen struktur (en bana utan gafflingar, eller varianter från en banfil som redigeras per variant).
ALTER TABLE course_version ADD COLUMN IF NOT EXISTS forking jsonb;
--> statement-breakpoint
ALTER TABLE course_version DROP CONSTRAINT IF EXISTS course_version_forking_check;
--> statement-breakpoint
ALTER TABLE course_version ADD CONSTRAINT course_version_forking_check
  CHECK (forking IS NULL OR (jsonb_typeof(forking) = 'object' AND jsonb_typeof(forking -> 'items') = 'array'));
--> statement-breakpoint
-- Utjämnad: varianterna ska ge samma sträckor (varning annars). Fulgaffling: alternativen får skilja (bara upplysning).
ALTER TABLE course ADD COLUMN IF NOT EXISTS forking_mode text NOT NULL DEFAULT 'BALANCED';
--> statement-breakpoint
ALTER TABLE course DROP CONSTRAINT IF EXISTS course_forking_mode_check;
--> statement-breakpoint
ALTER TABLE course ADD CONSTRAINT course_forking_mode_check CHECK (forking_mode IN ('BALANCED', 'UNEQUAL'));
--> statement-breakpoint
-- Variantens längd i meter: från banfilen (IOF Length per Course) eller räknad ur kontrollernas lägen.
ALTER TABLE course_variant ADD COLUMN IF NOT EXISTS length_meters integer;
--> statement-breakpoint
ALTER TABLE course_variant DROP CONSTRAINT IF EXISTS course_variant_length_check;
--> statement-breakpoint
ALTER TABLE course_variant ADD CONSTRAINT course_variant_length_check
  CHECK (length_meters IS NULL OR length_meters BETWEEN 1 AND 1000000);
--> statement-breakpoint
-- Kontrollernas lägen ur banfilen (IOF Control/Position, WGS 84), och startens och målets lägen per bana.
-- Används för variantens längd när banfilen saknar Length och för banan på kartan (ADR-0171).
ALTER TABLE control ADD COLUMN IF NOT EXISTS latitude double precision;
--> statement-breakpoint
ALTER TABLE control ADD COLUMN IF NOT EXISTS longitude double precision;
--> statement-breakpoint
ALTER TABLE control DROP CONSTRAINT IF EXISTS control_position_check;
--> statement-breakpoint
ALTER TABLE control ADD CONSTRAINT control_position_check CHECK ((latitude IS NULL) = (longitude IS NULL) AND
  (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)));
--> statement-breakpoint
ALTER TABLE course ADD COLUMN IF NOT EXISTS start_position jsonb;
--> statement-breakpoint
ALTER TABLE course ADD COLUMN IF NOT EXISTS finish_position jsonb;
