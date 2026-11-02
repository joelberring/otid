-- ADR-0185 (säkerhets- och driftöversynen 2026-11-02).
--
-- 1. Publikt före start. Variantens bokstav i de publika listorna och kartbilden visas publikt först när löparen har
--    startat (kartan: när tävlingen har startat) eller banorna blir publika enligt banhemligheten (ADR-0176). Arrangören
--    kan välja "direkt" under Publicera. Gäller också befintliga tävlingar: det är strängare än förut och tar inte bort något.
ALTER TABLE race ADD COLUMN IF NOT EXISTS public_variant_timing text NOT NULL DEFAULT 'AFTER_START';
ALTER TABLE race ADD COLUMN IF NOT EXISTS public_map_timing text NOT NULL DEFAULT 'AFTER_START';
ALTER TABLE race DROP CONSTRAINT IF EXISTS race_public_variant_timing_check;
ALTER TABLE race ADD CONSTRAINT race_public_variant_timing_check CHECK (public_variant_timing IN ('AFTER_START', 'ALWAYS'));
ALTER TABLE race DROP CONSTRAINT IF EXISTS race_public_map_timing_check;
ALTER TABLE race ADD CONSTRAINT race_public_map_timing_check CHECK (public_map_timing IN ('AFTER_START', 'ON_PUBLISH'));

-- 2. Bricknummer i den publika startlistan är av för nya tävlingar. Befintliga tävlingar behåller sitt val (ändras inte här).
ALTER TABLE race ALTER COLUMN public_start_list_card_numbers SET DEFAULT false;

-- 3. Bekräftad e-post. Behörigheter som andra delar ut med e-postadressen (administratör, funktionär, banläggning,
--    gruppledare och gruppmedlem) gäller först när kontots adress är bekräftad. Befintliga konton räknas som bekräftade.
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_verified_at timestamp with time zone;
UPDATE user_account SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Bekräftelselänken: bara hashen av engångsnyckeln sparas, och lösenordet som valdes vid registreringen (som en
-- scrypt-verifierare) så att den som öppnar länken måste kunna det. Gäller ett dygn och en gång.
CREATE TABLE IF NOT EXISTS email_verification_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id),
  token_hash text NOT NULL,
  salt_hex text NOT NULL,
  verifier_hex text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  CONSTRAINT email_verification_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT email_verification_token_salt_check CHECK (salt_hex ~ '^[a-f0-9]{32}$'),
  CONSTRAINT email_verification_token_verifier_check CHECK (verifier_hex ~ '^[a-f0-9]{64}$'),
  CONSTRAINT email_verification_token_lifetime_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 day')
);
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_token_hash_uidx ON email_verification_token (token_hash);
CREATE INDEX IF NOT EXISTS email_verification_token_account_idx ON email_verification_token (account_id, created_at);

-- Spärren räknar också bekräftelsemejl per e-postadress.
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_check;
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_check CHECK (scope IN ('REGISTER_IP', 'RESET_IP',
  'RESET_EMAIL', 'SELF_REGISTRATION_IP', 'SELF_REGISTRATION_RACE', 'VERIFY_EMAIL'));
