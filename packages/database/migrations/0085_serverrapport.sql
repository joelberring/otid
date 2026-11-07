-- B4 (ADR-0216): serverns veckorapport och larm till superadmin. Bara nya tabeller, inga personuppgifter.
-- server_sample: en mätning per kvart (disk, databas, kartor, säkerhetskopior, belastning, minne) för trenden och prognosen.
CREATE TABLE IF NOT EXISTS server_sample (
  sampled_at timestamp with time zone NOT NULL,
  disk_total_bytes bigint,
  disk_free_bytes bigint,
  database_bytes bigint NOT NULL,
  map_bytes bigint NOT NULL,
  backup_bytes bigint,
  load_max real,
  load_max_at timestamp with time zone,
  memory_total_bytes bigint,
  memory_available_min_bytes bigint,
  CONSTRAINT server_sample_pkey PRIMARY KEY (sampled_at),
  CONSTRAINT server_sample_bytes_check CHECK (database_bytes >= 0 AND map_bytes >= 0
    AND (disk_total_bytes IS NULL OR disk_total_bytes >= 0) AND (disk_free_bytes IS NULL OR disk_free_bytes >= 0)
    AND (backup_bytes IS NULL OR backup_bytes >= 0) AND (memory_total_bytes IS NULL OR memory_total_bytes >= 0)
    AND (memory_available_min_bytes IS NULL OR memory_available_min_bytes >= 0) AND (load_max IS NULL OR load_max >= 0))
);

-- server_notice: läget per sorts larm (och när veckorapporten senast skickades), så att inget skickas två gånger efter en omstart.
CREATE TABLE IF NOT EXISTS server_notice (
  kind text NOT NULL,
  active_since timestamp with time zone,
  alerted boolean NOT NULL DEFAULT false,
  last_sent_at timestamp with time zone,
  detail text,
  CONSTRAINT server_notice_pkey PRIMARY KEY (kind),
  CONSTRAINT server_notice_kind_check CHECK (kind IN ('WEEKLY_REPORT', 'DISK', 'MAP_QUOTA', 'BACKUP', 'HEALTH', 'MEMORY')),
  CONSTRAINT server_notice_detail_check CHECK (detail IS NULL OR char_length(detail) <= 500)
);

-- server_notice_log: vad som skickats (larm, löst, veckorapport) till hur många, för veckorapportens "larm senaste veckan".
CREATE TABLE IF NOT EXISTS server_notice_log (
  id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  detail text,
  recipients integer NOT NULL,
  sent_at timestamp with time zone NOT NULL,
  CONSTRAINT server_notice_log_pkey PRIMARY KEY (id),
  CONSTRAINT server_notice_log_kind_check CHECK (kind IN ('WEEKLY_REPORT', 'DISK', 'MAP_QUOTA', 'BACKUP', 'HEALTH', 'MEMORY')),
  CONSTRAINT server_notice_log_status_check CHECK (status IN ('ALERT', 'RESOLVED', 'REPORT')),
  CONSTRAINT server_notice_log_detail_check CHECK (detail IS NULL OR char_length(detail) <= 500),
  CONSTRAINT server_notice_log_recipients_check CHECK (recipients >= 0)
);
CREATE INDEX IF NOT EXISTS server_notice_log_sent_idx ON server_notice_log (sent_at);
