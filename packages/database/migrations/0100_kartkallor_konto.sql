-- ADR-0219 (K4c, tillägget om hämtningen): kontots egna uppgifter till en kartkälla (Lantmäteriet). Ägaren 2026-11-08: varje
-- användare använder sitt eget konto; O-Tid har inget eget. Uppgifterna lagras bara krypterade (AES-256-GCM med driftens
-- masternyckel, som Eventor-nycklarna); kontots id och källan autentiseras med chiffret. `hint` är de fyra sista tecknen i
-- användarnamnet eller nyckelns id, för att visa vilket konto som är sparat. Tas bort med kontot.
--
-- Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS map_source_credential (
  account_id uuid NOT NULL,
  provider text NOT NULL,
  method text NOT NULL,
  key_id text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  ciphertext text NOT NULL,
  hint text NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT map_source_credential_pkey PRIMARY KEY (account_id, provider),
  CONSTRAINT map_source_credential_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id),
  CONSTRAINT map_source_credential_provider_check CHECK (provider IN ('LANTMATERIET')),
  CONSTRAINT map_source_credential_method_check CHECK (method IN ('BASIC', 'OAUTH2')),
  CONSTRAINT map_source_credential_hint_check CHECK (char_length(hint) <= 8)
);
