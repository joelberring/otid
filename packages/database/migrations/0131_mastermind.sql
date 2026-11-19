-- Mastermind med kontroller sparas på servern (ADR-0228). Bara nya tabeller.
--
-- mastermind_race: träningens inställningar (det senaste gäller, `settings_at`) och lagens namn per bricknummer
-- ({"<bricka>": {"name": …, "at": …}}). Raden skapas när den första datorn skickar sitt läge. `open_stations_at`: administratören
-- har slagit på "Spela på egen dator" (knappen på tävlingssidan, träningsdagen); NULL = av.
CREATE TABLE IF NOT EXISTS mastermind_race (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  settings jsonb NOT NULL,
  settings_at timestamptz,
  names jsonb NOT NULL,
  open_stations_at timestamptz,
  open_stations_by uuid,
  updated_at timestamptz NOT NULL,
  CONSTRAINT mastermind_race_settings_check CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 4096),
  CONSTRAINT mastermind_race_names_check CHECK (jsonb_typeof(names) = 'object' AND pg_column_size(names) <= 262144)
);

-- mastermind_game: ett spel på en bricka. `id` är datorns id för spelet (idempotent mottagning, per tävling). Mönstret och
-- gissningarna läser bara den som har en roll på tävlingen; den publika ställningen visar namn, status, gissningar och tid.
-- `station_key_hash`: spelet kom från en dator utan inloggning (SHA-256 av datorns nyckel); bara den datorn får ändra det.
-- NULL = arrangörens eller funktionärens dator.
CREATE TABLE IF NOT EXISTS mastermind_game (
  race_id uuid NOT NULL REFERENCES race(id),
  id uuid NOT NULL,
  card_number integer NOT NULL,
  status text NOT NULL,
  secret jsonb NOT NULL,
  settings jsonb NOT NULL,
  guesses jsonb NOT NULL,
  marker jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  abandoned_at timestamptz,
  station_key_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (race_id, id),
  CONSTRAINT mastermind_game_card_check CHECK (card_number BETWEEN 1 AND 99999999),
  CONSTRAINT mastermind_game_status_check CHECK (status IN ('playing', 'won', 'lost', 'abandoned')),
  CONSTRAINT mastermind_game_secret_check CHECK (jsonb_typeof(secret) = 'array' AND pg_column_size(secret) <= 1024),
  CONSTRAINT mastermind_game_settings_check CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 4096),
  CONSTRAINT mastermind_game_station_check CHECK (station_key_hash IS NULL OR station_key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mastermind_game_guesses_check CHECK (jsonb_typeof(guesses) = 'array' AND pg_column_size(guesses) <= 65536)
);
