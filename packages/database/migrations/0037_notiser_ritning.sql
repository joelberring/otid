-- ADR-0181 beslut 8 (ägarens synpunkter 2026-11-02): notiser med ritning och kartfel som eget slag.
--
-- kind: COURSE_SETTING (banläggning, förval) eller MAP_ERROR (kartfel). Ett kartfel sitter på en punkt eller en ritning,
-- aldrig på en kontroll, en sträcka eller en bana, så att exporten till kartritaren inte kan koppla det till banorna.
-- sketch: ritningens linjer och ytor i kartans mm (target SKETCH; at_x/at_y är ritningens mitt). Kontrakten begränsar
-- antalet punkter; här bara formen och en övre gräns för storleken. Banpåtryck, .ppen och överföringen läser den aldrig.
ALTER TABLE course_setting_note ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'COURSE_SETTING';
ALTER TABLE course_setting_note ADD COLUMN IF NOT EXISTS sketch jsonb;
ALTER TABLE course_setting_note DROP CONSTRAINT IF EXISTS course_setting_note_target_check;
ALTER TABLE course_setting_note ADD CONSTRAINT course_setting_note_target_check CHECK (
  (target = 'POINT' AND at_x IS NOT NULL AND at_y IS NOT NULL) OR
  (target = 'CONTROL' AND control_id IS NOT NULL) OR
  (target = 'LEG' AND from_control_id IS NOT NULL AND to_control_id IS NOT NULL) OR
  (target = 'COURSE' AND course_id IS NOT NULL) OR
  (target = 'SKETCH' AND at_x IS NOT NULL AND at_y IS NOT NULL));
ALTER TABLE course_setting_note DROP CONSTRAINT IF EXISTS course_setting_note_sketch_check;
ALTER TABLE course_setting_note ADD CONSTRAINT course_setting_note_sketch_check CHECK ((target = 'SKETCH') = (sketch IS NOT NULL)
  AND (sketch IS NULL OR (jsonb_typeof(sketch) = 'array' AND jsonb_array_length(sketch) BETWEEN 1 AND 20
    AND octet_length(sketch::text) <= 131072)));
ALTER TABLE course_setting_note DROP CONSTRAINT IF EXISTS course_setting_note_kind_check;
ALTER TABLE course_setting_note ADD CONSTRAINT course_setting_note_kind_check CHECK (kind IN ('COURSE_SETTING', 'MAP_ERROR')
  AND (kind = 'COURSE_SETTING' OR target IN ('POINT', 'SKETCH')));

-- Kartritaren (MAP): ser bara kartan och kartfelen, svarar och markerar dem klara; aldrig banläggningens dokument.
ALTER TABLE course_setting_grant DROP CONSTRAINT IF EXISTS course_setting_grant_level_check;
ALTER TABLE course_setting_grant ADD CONSTRAINT course_setting_grant_level_check CHECK (level IN ('EDIT', 'SUGGEST', 'COMMENT', 'MAP'));
