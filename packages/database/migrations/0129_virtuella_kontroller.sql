-- Ägaren 2026-11-16: virtuella kontroller på samma grund som bingon (ADR-0226). Bara tillägg och ett villkor som lättas:
-- läget CONTROLS, träningens inställningar (radie, stämpling, poäng per kod) och löparens duell, lag och stämplingar.
ALTER TABLE bingo_race DROP CONSTRAINT IF EXISTS bingo_race_mode_check;
ALTER TABLE bingo_race ADD CONSTRAINT bingo_race_mode_check CHECK (mode IN ('BINGO', 'SHIPS', 'CONTROLS')) NOT VALID;
ALTER TABLE bingo_race VALIDATE CONSTRAINT bingo_race_mode_check;
ALTER TABLE bingo_race ADD COLUMN IF NOT EXISTS settings jsonb;
ALTER TABLE bingo_race DROP CONSTRAINT IF EXISTS bingo_race_settings_check;
ALTER TABLE bingo_race ADD CONSTRAINT bingo_race_settings_check CHECK (settings IS NULL OR (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 65536));

ALTER TABLE bingo_runner ADD COLUMN IF NOT EXISTS duel text;
ALTER TABLE bingo_runner ADD COLUMN IF NOT EXISTS team text;
ALTER TABLE bingo_runner ADD COLUMN IF NOT EXISTS punches jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bingo_runner DROP CONSTRAINT IF EXISTS bingo_runner_duel_check;
ALTER TABLE bingo_runner ADD CONSTRAINT bingo_runner_duel_check CHECK ((duel IS NULL OR duel ~ '^[A-Z0-9]{2,12}$') AND (team IS NULL OR char_length(team) BETWEEN 1 AND 60));
ALTER TABLE bingo_runner DROP CONSTRAINT IF EXISTS bingo_runner_punches_check;
ALTER TABLE bingo_runner ADD CONSTRAINT bingo_runner_punches_check CHECK (jsonb_typeof(punches) = 'array' AND pg_column_size(punches) <= 131072);
