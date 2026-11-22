-- PLAN.md steg M7 (ägaren 2026-11-22): klubbarkivet räknas mot klubben, inte mot den som laddade upp. Klubben får en egen
-- gräns för eget material i MB; NULL = installationens förval (2 048 MB). Sätts bara av superadmin (åtgärden
-- SET_CLUB_LIMITS, som loggas i superadmin_action med målet CLUB).
--
-- Vilket innehåll som räknas mot klubben avgörs av registret, inte av en ny kolumn: innehåll (`map_content`) som en
-- kartversion i klubbens arkiv pekar på (`club_map_version.content_sha256`) räknas mot klubben och inte mot kontot i
-- `uploaded_by`. Befintligt klubbarkiv byter alltså till klubbens kvot utan att någon rad eller fil ändras.
--
-- Bara tillägg och ett lättat villkor (migrations/README.md): en kolumn som får vara tom och ett värde till i målets villkor.
ALTER TABLE club ADD COLUMN IF NOT EXISTS map_quota_mb integer;
ALTER TABLE club DROP CONSTRAINT IF EXISTS club_map_quota_mb_check;
ALTER TABLE club ADD CONSTRAINT club_map_quota_mb_check CHECK (map_quota_mb IS NULL OR map_quota_mb BETWEEN 1 AND 1000000);

ALTER TABLE superadmin_action DROP CONSTRAINT IF EXISTS superadmin_action_target_type_check;
ALTER TABLE superadmin_action ADD CONSTRAINT superadmin_action_target_type_check
  CHECK (target_type IN ('ACCOUNT', 'EVENT', 'RACE', 'INSTALLATION', 'CLUB'));
