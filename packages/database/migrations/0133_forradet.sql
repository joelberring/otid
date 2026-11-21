-- PLAN.md steg M1 (ADR-0229, ägaren 2026-11-21): förrådet för kartinnehåll i objektlagringen och serverns mellanlager.
--
-- map_content får tre kolumner:
--   stored_in      var innehållet ligger: 'DB' (delarna i map_content_part, som förut) eller 'STORE' (bara i förrådet,
--                  objektet map-content/<sha256>; en kopia kan ligga i mellanlagret på serverns disk). Befintliga rader är 'DB'.
--   last_used_at   senast lästa (högst var 10:e minut per innehåll), för utträngningen i M4.
--   regenerable    innehållet går att skapa igen ur ett recept (fylls i M4).
-- user_account.regenerable_quota_mb: kontots gräns för återskapbart innehåll i MB (NULL = förvalet 10 240 MB; används i M4).
-- installation_setting: installationens inställningar som superadmin ändrar på superadminsidan (mellanlagrets tak och
--   kartlagringens totala gräns). En rad per nyckel; ingen rad = förvalet.
-- map_store_fetch_day: hur många hämtningar ur förrådet som gjorts per dygn (superadminsidan visar det senaste dygnet).
-- superadmin_action.target_type får 'INSTALLATION' (installationens gränser; target_id är då noll-uuid).
--
-- Bara tillägg (migrations/README.md): nya kolumner med förval, nya tabeller och ett villkor som lättas.
ALTER TABLE map_content ADD COLUMN IF NOT EXISTS stored_in text NOT NULL DEFAULT 'DB';
ALTER TABLE map_content ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE map_content ADD COLUMN IF NOT EXISTS regenerable boolean NOT NULL DEFAULT false;
ALTER TABLE map_content DROP CONSTRAINT IF EXISTS map_content_stored_in_check;
ALTER TABLE map_content ADD CONSTRAINT map_content_stored_in_check CHECK (stored_in IN ('DB', 'STORE'));

ALTER TABLE user_account ADD COLUMN IF NOT EXISTS regenerable_quota_mb integer;
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_regenerable_quota_mb_check;
ALTER TABLE user_account ADD CONSTRAINT user_account_regenerable_quota_mb_check
  CHECK (regenerable_quota_mb IS NULL OR regenerable_quota_mb BETWEEN 1 AND 1000000);

CREATE TABLE IF NOT EXISTS installation_setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid,
  CONSTRAINT installation_setting_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  CONSTRAINT installation_setting_value_check CHECK (pg_column_size(value) <= 4096)
);

CREATE TABLE IF NOT EXISTS map_store_fetch_day (
  day date PRIMARY KEY,
  fetches integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0
);

ALTER TABLE superadmin_action DROP CONSTRAINT IF EXISTS superadmin_action_target_type_check;
ALTER TABLE superadmin_action ADD CONSTRAINT superadmin_action_target_type_check
  CHECK (target_type IN ('ACCOUNT', 'EVENT', 'RACE', 'INSTALLATION'));
