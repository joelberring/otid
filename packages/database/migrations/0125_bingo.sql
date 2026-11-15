-- Ägaren 2026-11-15: bingoorientering med telefonen (ADR-0225). Bara nya tabeller.
--
-- bingo_race: bingon med telefonen är påslagen för tävlingen (admin slår på den i banläggningens bingo). Rutnätet står i
-- banläggningens dokument (CourseTraining.bingo); här finns bara att den är på, när och av vem.
CREATE TABLE IF NOT EXISTS bingo_race (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  enabled_at timestamptz NOT NULL,
  enabled_by uuid NOT NULL
);

-- bingo_runner: en löpare som anmält sig på plats utan konto. `client_id` är telefonens id för loppet (idempotent mottagning;
-- aldrig primärnyckel). Namnet är det enda som löparen skriver; spåret (kartans mm, förenklat) läses bara av admin.
CREATE TABLE IF NOT EXISTS bingo_runner (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  client_id uuid NOT NULL,
  name text NOT NULL,
  group_course text NOT NULL,
  group_name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  distance_m integer NOT NULL,
  taken jsonb NOT NULL,
  track jsonb NOT NULL,
  gaps jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT bingo_runner_name_check CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT bingo_runner_group_check CHECK (char_length(group_course) BETWEEN 1 AND 64 AND char_length(group_name) BETWEEN 1 AND 200),
  CONSTRAINT bingo_runner_status_check CHECK (status IN ('RUNNING', 'FINISHED', 'ABANDONED')),
  CONSTRAINT bingo_runner_distance_check CHECK (distance_m BETWEEN 0 AND 500000),
  CONSTRAINT bingo_runner_taken_check CHECK (jsonb_typeof(taken) = 'array' AND pg_column_size(taken) <= 262144),
  CONSTRAINT bingo_runner_track_check CHECK (jsonb_typeof(track) = 'array' AND pg_column_size(track) <= 1048576),
  CONSTRAINT bingo_runner_gaps_check CHECK (jsonb_typeof(gaps) = 'array' AND pg_column_size(gaps) <= 65536)
);
CREATE UNIQUE INDEX IF NOT EXISTS bingo_runner_client_uidx ON bingo_runner (race_id, client_id);
