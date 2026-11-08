-- ADR-0219 (steg K3, tillägget om rekningen): GPS-spår från fältläget eller en GPX-fil, bekräftade objekt ("kollat") och
-- projektets inställningar för rekningen (siktavstånd per symbolgrupp). "Passerat" och täckningen räknas i webbläsaren ur
-- spåren och sparas inte.
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn på map_project och tre nya tabeller. Spåren är personuppgifter
-- (var någon gått): de syns bara för projektets medlemmar, var och en tar bort sina egna, och de tas bort med kontot (i koden,
-- som kartjobben i 0093). Konton har ingen främmande nyckel här (som 0091).

-- Rekningens inställningar (`ReconSettings` i map-revision); null = förvalen.
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS recon jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_recon_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_recon_check CHECK (recon IS NULL OR (jsonb_typeof(recon) = 'object'
      AND pg_column_size(recon) <= 4096));
  END IF;
END $$;

-- Ett spår: id:t skapas i telefonen (samma spår två gånger blir ett). Källan: fältläget (`FIELD`) eller en GPX-fil (`GPX`).
CREATE TABLE IF NOT EXISTS map_project_track (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  point_count integer NOT NULL DEFAULT 0,
  length_m double precision NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_track_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_track_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_track_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT map_project_track_source_check CHECK (source ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_track_count_check CHECK (point_count >= 0 AND length_m >= 0)
);
CREATE INDEX IF NOT EXISTS map_project_track_project_idx ON map_project_track (project_id, created_at);
CREATE INDEX IF NOT EXISTS map_project_track_account_idx ON map_project_track (account_id);

-- Spårets punkter i delar (en del i taget från telefonen; samma del två gånger görs en gång): [lat, lon, sekunder från spårets
-- start, noggrannhet i meter] per punkt.
CREATE TABLE IF NOT EXISTS map_project_track_part (
  track_id uuid NOT NULL,
  seq integer NOT NULL,
  points jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_track_part_pkey PRIMARY KEY (track_id, seq),
  CONSTRAINT map_project_track_part_track_fkey FOREIGN KEY (track_id) REFERENCES map_project_track (id) ON DELETE CASCADE,
  CONSTRAINT map_project_track_part_seq_check CHECK (seq BETWEEN 0 AND 999),
  CONSTRAINT map_project_track_part_points_check CHECK (jsonb_typeof(points) = 'array' AND pg_column_size(points) <= 1048576)
);

-- Ett bekräftat objekt ("kollat"): gäller så länge objektets senaste ändring är `basis_edit_id` (null = grundfilens objekt).
CREATE TABLE IF NOT EXISTS map_project_check (
  project_id uuid NOT NULL,
  object_key text NOT NULL,
  account_id uuid NOT NULL,
  basis_edit_id uuid,
  checked_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_check_pkey PRIMARY KEY (project_id, object_key),
  CONSTRAINT map_project_check_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_check_key_check CHECK (char_length(object_key) BETWEEN 3 AND 300)
);
CREATE INDEX IF NOT EXISTS map_project_check_account_idx ON map_project_check (account_id);
