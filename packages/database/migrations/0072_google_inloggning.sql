-- ADR-0205: inloggning med Google (OpenID Connect). Kontot kopplas till Googles `sub` (kontots stabila id hos Google).
--
-- En koppling per konto och en per Google-konto. `account_id` är primärnyckel (externa id:n är aldrig primärnycklar,
-- AGENTS.md); `google_sub` är unik. Raden tas bort med kontot (purgeRows följer främmande nycklar). Bara tillägg (ny
-- tabell); inget befintligt ändras.
CREATE TABLE IF NOT EXISTS user_account_google_identity (
  account_id uuid PRIMARY KEY REFERENCES user_account (id),
  google_sub text NOT NULL,
  linked_at timestamptz NOT NULL,
  last_login_at timestamptz,
  CONSTRAINT user_account_google_identity_sub_uidx UNIQUE (google_sub),
  CONSTRAINT user_account_google_identity_sub_check CHECK (length(google_sub) BETWEEN 1 AND 255 AND google_sub ~ '^[A-Za-z0-9_-]+$')
);
