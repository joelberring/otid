-- PLAN.md M6 (ägaren 2026-11-22): «Spara även rå laserdata åt mig». En rad per zip-fil med rå laserdata i förrådets
-- objektlagring (`raw-laser/<id>/…`). Raden skrivs innan geo-arbetaren får sin uppladdningslänk, så att städningen alltid
-- hittar objektet; den står kvar (SET NULL) när jobbet, projektet eller kontot tas bort, tills objektet raderats efter 7 dygn.
-- Bara tillägg (migrations/README.md). Ny tabell, inga stora tabeller berörs.
CREATE TABLE IF NOT EXISTS map_project_raw_laser (
  id uuid PRIMARY KEY,
  job_id uuid UNIQUE REFERENCES map_project_geo_job(id) ON DELETE SET NULL,
  run_key uuid NOT NULL,
  project_id uuid REFERENCES map_project(id) ON DELETE SET NULL,
  account_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'READY', 'FAILED', 'REMOVED')),
  byte_size bigint,
  files integer,
  error text,
  created_at timestamptz NOT NULL,
  ready_at timestamptz,
  expires_at timestamptz NOT NULL,
  mailed_at timestamptz,
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS map_project_raw_laser_run_idx ON map_project_raw_laser (run_key);
CREATE INDEX IF NOT EXISTS map_project_raw_laser_expiry_idx ON map_project_raw_laser (status, expires_at);
