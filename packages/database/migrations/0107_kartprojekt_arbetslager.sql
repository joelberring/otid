-- ADR-0219 (ägaren 2026-11-09, lagren fas 2): egna lager i kartprojektet utöver normens huvudlager.
--
-- * Arbetslager (`SYMBOLS`): en namngiven grupp av normens symboler (t.ex. "Stigar att reka" med 505–507), delad i projektet.
--   Vilka lager som syns, är låsta eller nedtonade väljer var och en själv (i webbläsaren), som för huvudlagren.
-- * Skisslager (`SKETCH`): skisser som inte hör till kartan (linjer på fri hand, punkter och korta texter), t.ex. från
--   fältet. Skisserna skrivs aldrig till kartfilen.
--
-- Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS map_project_work_layer (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  color text NOT NULL DEFAULT '#c0262d',
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_work_layer_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_work_layer_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_work_layer_kind_check CHECK (kind IN ('SYMBOLS', 'SKETCH')),
  CONSTRAINT map_project_work_layer_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT map_project_work_layer_codes_check CHECK (jsonb_typeof(codes) = 'array' AND pg_column_size(codes) <= 16384),
  CONSTRAINT map_project_work_layer_color_check CHECK (color ~ '^#[0-9a-f]{6}$')
);
CREATE INDEX IF NOT EXISTS map_project_work_layer_project_idx ON map_project_work_layer (project_id, created_at);

CREATE TABLE IF NOT EXISTS map_project_sketch (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  layer_id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL,
  points jsonb NOT NULL,
  text text,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_sketch_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_sketch_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_sketch_layer_fkey FOREIGN KEY (layer_id) REFERENCES map_project_work_layer (id),
  CONSTRAINT map_project_sketch_kind_check CHECK (kind IN ('LINE', 'POINT', 'TEXT')),
  CONSTRAINT map_project_sketch_points_check CHECK (jsonb_typeof(points) = 'array' AND pg_column_size(points) <= 65536),
  CONSTRAINT map_project_sketch_text_check CHECK (text IS NULL OR char_length(text) <= 200)
);
CREATE INDEX IF NOT EXISTS map_project_sketch_layer_idx ON map_project_sketch (layer_id, created_at);
CREATE INDEX IF NOT EXISTS map_project_sketch_project_idx ON map_project_sketch (project_id);
