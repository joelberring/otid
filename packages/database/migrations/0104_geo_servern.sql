-- ADR-0219 K5b (ägaren 2026-11-08): geo-servern som O-Tid startar hos Hetzner när ett geo-jobb väntar och raderar efter
-- tomgång. En rad per server (även raderade, för månadens kostnad); nyckeln som geo-arbetaren på servern använder lagras
-- bara som sha256. Läget och när ägaren senast fick mejl ligger i geo_server_state.
CREATE TABLE IF NOT EXISTS geo_server (
  id uuid NOT NULL,
  provider_id bigint,
  name text NOT NULL,
  server_type text NOT NULL,
  location text NOT NULL,
  hourly_eur double precision NOT NULL,
  token_sha256 text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  last_job_at timestamptz,
  deleted_at timestamptz,
  delete_reason text,
  CONSTRAINT geo_server_pkey PRIMARY KEY (id),
  CONSTRAINT geo_server_name_key UNIQUE (name),
  CONSTRAINT geo_server_token_key UNIQUE (token_sha256),
  CONSTRAINT geo_server_status_check CHECK (status IN ('STARTING', 'READY', 'DELETED')),
  CONSTRAINT geo_server_hourly_check CHECK (hourly_eur >= 0 AND hourly_eur < 100)
);
CREATE INDEX IF NOT EXISTS geo_server_active_idx ON geo_server (status) WHERE status <> 'DELETED';

CREATE TABLE IF NOT EXISTS geo_server_state (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT geo_server_state_pkey PRIMARY KEY (key),
  CONSTRAINT geo_server_state_value_check CHECK (pg_column_size(value) <= 8192)
);
