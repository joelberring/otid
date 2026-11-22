-- PLAN.md steg M5: larmen för förrådet (STORE) och geo-servern (GEO) bokförs som egna sorter i server_notice och server_notice_log.
-- Bara check-villkoren utvidgas (en lättnad, ingen data ändras).
ALTER TABLE server_notice DROP CONSTRAINT IF EXISTS server_notice_kind_check;
ALTER TABLE server_notice ADD CONSTRAINT server_notice_kind_check CHECK (kind IN ('WEEKLY_REPORT', 'DISK', 'MAP_QUOTA', 'BACKUP', 'HEALTH', 'MEMORY', 'STORE', 'GEO'));
ALTER TABLE server_notice_log DROP CONSTRAINT IF EXISTS server_notice_log_kind_check;
ALTER TABLE server_notice_log ADD CONSTRAINT server_notice_log_kind_check CHECK (kind IN ('WEEKLY_REPORT', 'DISK', 'MAP_QUOTA', 'BACKUP', 'HEALTH', 'MEMORY', 'STORE', 'GEO'));
