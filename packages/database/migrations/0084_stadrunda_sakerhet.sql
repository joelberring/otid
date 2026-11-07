-- Städrundan 2026-11-07 (ADR-0206 ändrad): mejlspärren för inbjudningar räknas i account_request_throttle (nyckeln som HMAC),
-- inte i invitation_link, vars rader tas bort med tävlingen, klubben, gruppen eller kontot. Per mottagare och per avsändare,
-- timme och dygn. Hela listan från 0083 och de nya värdena.
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_check;
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_check CHECK (scope IN ('REGISTER_IP', 'RESET_IP',
  'RESET_EMAIL', 'SELF_REGISTRATION_IP', 'SELF_REGISTRATION_RACE', 'VERIFY_EMAIL', 'GROUP_CODE_IP', 'MAP_LINK_IP', 'MAP_LINK_TOKEN',
  'INVITATION_RECIPIENT_HOUR', 'INVITATION_RECIPIENT_DAY', 'INVITATION_ISSUER_HOUR', 'INVITATION_ISSUER_DAY'));

-- Städrundan 2026-11-07: en ny registrering av en obekräftad adress skriver över kontots visningsnamn, och länken minns namnet
-- från sin registrering; den som öppnar länken får det namnet (inte namnet från någon annans registrering). Tom = kontots namn.
ALTER TABLE email_verification_token ADD COLUMN IF NOT EXISTS display_name text;
