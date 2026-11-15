-- Ägaren 2026-11-15: Sänka skepp på samma grund som bingon (ADR-0225). Bara tillägg: läget per träning, löparens frö (egna
-- skepp) och skotten (ruta, tid, position i kartans mm och noggrannhet).
ALTER TABLE bingo_race ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'BINGO';
ALTER TABLE bingo_race DROP CONSTRAINT IF EXISTS bingo_race_mode_check;
ALTER TABLE bingo_race ADD CONSTRAINT bingo_race_mode_check CHECK (mode IN ('BINGO', 'SHIPS'));

ALTER TABLE bingo_runner ADD COLUMN IF NOT EXISTS seed bigint;
ALTER TABLE bingo_runner ADD COLUMN IF NOT EXISTS shots jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bingo_runner DROP CONSTRAINT IF EXISTS bingo_runner_seed_check;
ALTER TABLE bingo_runner ADD CONSTRAINT bingo_runner_seed_check CHECK (seed IS NULL OR seed BETWEEN 0 AND 4294967295);
ALTER TABLE bingo_runner DROP CONSTRAINT IF EXISTS bingo_runner_shots_check;
ALTER TABLE bingo_runner ADD CONSTRAINT bingo_runner_shots_check CHECK (jsonb_typeof(shots) = 'array' AND pg_column_size(shots) <= 262144);
