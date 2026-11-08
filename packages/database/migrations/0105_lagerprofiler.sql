-- ADR-0219 K6b (planen för baskartor): lagermappningsprofiler. En vektorfils lager → symbolnummer, sparade per konto och
-- valfritt delade med kartprojektets klubb, så att nästa fil från samma källa (t.ex. Stockholms baskarta) känns igen direkt.
CREATE TABLE IF NOT EXISTS map_layer_profile (
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  club_id uuid,
  name text NOT NULL,
  rules jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT map_layer_profile_pkey PRIMARY KEY (id),
  CONSTRAINT map_layer_profile_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id) ON DELETE CASCADE,
  CONSTRAINT map_layer_profile_club_fkey FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE,
  CONSTRAINT map_layer_profile_request_key UNIQUE (request_id),
  CONSTRAINT map_layer_profile_name_key UNIQUE (account_id, name),
  CONSTRAINT map_layer_profile_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT map_layer_profile_rules_check CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) BETWEEN 1 AND 1000
    AND pg_column_size(rules) <= 262144)
);
CREATE INDEX IF NOT EXISTS map_layer_profile_club_idx ON map_layer_profile (club_id) WHERE club_id IS NOT NULL;
