-- ADR-0187: arrangörens säkerhetskopia och återställning av en tävling.
-- Bara tillägg: en kolumn som får vara tom och en ny tabell (ingen omskrivning, inget borttaget).

-- När säkerhetskopian senast laddades ner (Inställningar). Bara tiden; vem som laddade ner står i journalen (audit_event).
ALTER TABLE race ADD COLUMN IF NOT EXISTS last_backup_at timestamp with time zone;

-- Kvittot för en återställning: samma begäran (request_id) ger samma tävling, så ett omförsök skapar aldrig två.
CREATE TABLE IF NOT EXISTS race_restore_request (
  request_id uuid PRIMARY KEY,
  actor_account_id uuid NOT NULL REFERENCES user_account(id),
  event_id uuid NOT NULL REFERENCES event(id),
  race_id uuid NOT NULL REFERENCES race(id),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  people text NOT NULL CHECK (people IN ('link', 'skip')),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS race_restore_request_race_uidx ON race_restore_request (race_id);
