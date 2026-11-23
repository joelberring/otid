-- PLAN K4c Huvudkälla (ägaren 2026-11-23): en inläst vektorfil (t.ex. Stockholms baskarta) är kartprojektets huvudkälla inom sitt
-- område för de slag den täcker; där hoppar grundkartan över OpenStreetMaps objekt av de slagen. Bara en ny tabell.
--
-- En rad per markerad fil: filens namn, täckningsområdet (ytor i kartans mm, yttre ring först) och slagen (hus, vägar, …).
-- Markeringen tas bort genom att raden tas bort; kartans objekt påverkas inte av det.
CREATE TABLE IF NOT EXISTS map_project_primary_source (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES map_project(id),
  name text NOT NULL,
  area jsonb NOT NULL,
  kinds jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT map_project_primary_source_size_check CHECK (pg_column_size(area) <= 1048576 AND pg_column_size(kinds) <= 1024)
);
CREATE INDEX IF NOT EXISTS map_project_primary_source_project_idx ON map_project_primary_source (project_id, created_at);
