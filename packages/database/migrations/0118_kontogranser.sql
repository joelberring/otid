-- Ägaren 2026-11-13: superadmin ska kunna höja enskilda kontons gränser i stället för att alla får stora konton.
-- Två egna gränser per konto; NULL = installationens förval (OTID_MAP_QUOTA_ACCOUNT_MB och OTID_GEO_TILES_PER_MONTH).
--   map_quota_mb         kontots lagring för kartfiler i MB
--   geo_tiles_per_month  kontots laserrutor per kalendermånad
-- Sätts bara av superadmin (åtgärden SET_ACCOUNT_LIMITS, som loggas i superadmin_action).
--
-- Bara tillägg (migrations/README.md): två kolumner som får vara tomma. Befintliga konton har förvalen som förut.
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS map_quota_mb integer;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS geo_tiles_per_month integer;
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_map_quota_mb_check;
ALTER TABLE user_account ADD CONSTRAINT user_account_map_quota_mb_check CHECK (map_quota_mb IS NULL OR map_quota_mb BETWEEN 1 AND 1000000);
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_geo_tiles_per_month_check;
ALTER TABLE user_account ADD CONSTRAINT user_account_geo_tiles_per_month_check CHECK (geo_tiles_per_month IS NULL OR geo_tiles_per_month BETWEEN 0 AND 100000);
