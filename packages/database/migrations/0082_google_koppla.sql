-- ADR-0205 tillägg (Koppla Google-konto): Googles adress för kopplingen, så att Mitt konto kan visa vilket Google-konto som
-- är kopplat och superadmin kan hitta kopplingen på adressen (`superadmin.mjs google move`). Kontots egen adress ändras inte;
-- Googles adress kan vara en annan. Bara tillägg (en kolumn som får vara tom); befintliga rader får adressen vid nästa
-- inloggning med Google.
ALTER TABLE user_account_google_identity ADD COLUMN IF NOT EXISTS google_email text;
DO $$ BEGIN
  ALTER TABLE user_account_google_identity ADD CONSTRAINT user_account_google_identity_email_check
    CHECK (google_email IS NULL OR (google_email = lower(btrim(google_email)) AND length(google_email) BETWEEN 3 AND 254
      AND google_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
