-- Ägaren 2026-11-17: spara en version av banläggningen med namn och tidpunkt. Namngivna versioner rensas inte bort bland de
-- 50 senaste. Bara ett tillägg (kolumnen får vara tom).
ALTER TABLE course_setting_revision ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE course_setting_revision DROP CONSTRAINT IF EXISTS course_setting_revision_label_check;
ALTER TABLE course_setting_revision ADD CONSTRAINT course_setting_revision_label_check CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 80);
