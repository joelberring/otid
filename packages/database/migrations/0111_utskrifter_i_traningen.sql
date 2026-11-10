-- Ägaren 2026-11-10 (ADR-0221 tillägg): utskrifternas PDF:er sparade i träningen (de ligger kvar, till skillnad från
-- tryckjobben som rensas efter sju dagar). En sparad utskrift från banläggningen eller en egen uppladdad PDF; syns i
-- banläggningen och på veckan i terminsplanen. Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS race_print_file (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  file_name text NOT NULL,
  label text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('UPLOAD', 'PRINT_JOB')),
  pdf bytea NOT NULL,
  byte_length integer NOT NULL,
  sha256 text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS race_print_file_race_idx ON race_print_file (race_id, created_at);
