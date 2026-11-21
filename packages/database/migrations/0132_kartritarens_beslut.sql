-- Kartritarens beslut om grundkartans förslag (ägaren 2026-11-21, idé 1 «lär av kartritarens egna beslut»). Bara en ny tabell.
--
-- En rad per gång ett utkast läggs in: vilken fil (laserjobb och inställningar), hur det lades in (lägg till, utvidga, byt ut),
-- lagren som erbjöds med antal och vald symbol, och nycklarna på objekten som lades till. Objektens öden (flyttade, ändrade,
-- borttagna) står redan i map_project_edit, och utkastet går att räkna fram igen ur laserjobbets filer och inställningarna,
-- så här sparas ingen geometri.
CREATE TABLE IF NOT EXISTS map_project_decision (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES map_project(id),
  account_id uuid NOT NULL,
  source text NOT NULL,
  geo_job_id uuid,
  settings jsonb NOT NULL,
  mode text NOT NULL,
  layers jsonb NOT NULL,
  added_keys jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT map_project_decision_mode_check CHECK (mode IN ('ADD', 'EXTEND', 'REPLACE')),
  CONSTRAINT map_project_decision_size_check CHECK (pg_column_size(layers) <= 65536 AND pg_column_size(added_keys) <= 1048576 AND pg_column_size(settings) <= 4096)
);
CREATE INDEX IF NOT EXISTS map_project_decision_project_idx ON map_project_decision (project_id, created_at);
