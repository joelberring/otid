-- Steg 59 (ADR-0179 beslut 1–3): banläggarens kartfil (OCAD eller Mapper) orörd, högst 60 MB. Webbläsaren läser och ritar
-- den; bilden och georeferensen går till race_map som förut. bounds är kartans yta i mm, georeference kartfilens
-- georeferens (mm → projicerade meter), render bildens upplösning och övre vänstra hörn i kartans mm och summary det
-- arbetsytan visar (antal objekt, varningar och förenklingar i skärmbilden).
CREATE TABLE IF NOT EXISTS race_map_source (
    race_id uuid NOT NULL,
    file_name text NOT NULL,
    format text NOT NULL,
    version text NOT NULL,
    file bytea NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    scale integer NOT NULL,
    bounds jsonb NOT NULL,
    georeference jsonb,
    render jsonb NOT NULL,
    summary jsonb NOT NULL,
    uploaded_at timestamp with time zone NOT NULL,
    CONSTRAINT race_map_source_pkey PRIMARY KEY (race_id),
    CONSTRAINT race_map_source_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT race_map_source_format_check CHECK (format IN ('OCD', 'OMAP')),
    CONSTRAINT race_map_source_version_check CHECK (char_length(version) BETWEEN 1 AND 80),
    CONSTRAINT race_map_source_name_check CHECK (char_length(file_name) BETWEEN 1 AND 200),
    CONSTRAINT race_map_source_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT race_map_source_size_check CHECK (byte_length BETWEEN 1 AND 62914560 AND byte_length = octet_length(file)),
    CONSTRAINT race_map_source_scale_check CHECK (scale BETWEEN 100 AND 1000000),
    CONSTRAINT race_map_source_json_check CHECK (jsonb_typeof(bounds) = 'object' AND jsonb_typeof(render) = 'object' AND jsonb_typeof(summary) = 'object' AND
      (georeference IS NULL OR jsonb_typeof(georeference) = 'object'))
);
