-- Ägaren 2026-11-12 («två gånger räcker», «superadmin ska kunna bekräfta adressen i appen»). Bara tillägg och ett lättat villkor
-- (migrations/README.md, steg 1 i tvåstegsregeln). Ingen data skrivs om.

-- ADR-0205 tillägg 2026-11-12: bekräftelselänken som öppnas i samma webbläsare som registreringen bekräftar adressen med
-- lösenordet från registreringsformuläret. Registreringen sätter en HttpOnly-kaka med en slumpad hemlighet; länken minns
-- hemlighetens sha256 och registreringens verifierare (salt_hex/verifier_hex, nullbara sedan 0087, används igen). Utan kakan
-- väljer man lösenord som förut. Kolumnerna töms när länken förbrukas.
ALTER TABLE email_verification_token ADD COLUMN IF NOT EXISTS browser_secret_hash text;
ALTER TABLE email_verification_token DROP CONSTRAINT IF EXISTS email_verification_token_browser_secret_check;
ALTER TABLE email_verification_token ADD CONSTRAINT email_verification_token_browser_secret_check
  CHECK (browser_secret_hash IS NULL OR (browser_secret_hash ~ '^[a-f0-9]{64}$' AND salt_hex IS NOT NULL AND verifier_hex IS NOT NULL));

-- ADR-0172 tillägg 2026-11-12: superadmin bekräftar en adress i appen (VERIFY_EMAIL), och serverkommandot loggar också. Listan
-- över åtgärder i CHECK skrevs i 0000 och skulle behöva kopieras för varje ny åtgärd; som spärrens scope i 0087 står listan nu i
-- koden (`superadminActionKindSchema` i contracts, som `logAction` prövar mot), och databasen kräver bara formen. Tabellen är
-- liten (en rad per superadminåtgärd), så villkoret valideras direkt.
ALTER TABLE superadmin_action DROP CONSTRAINT IF EXISTS superadmin_action_action_check;
ALTER TABLE superadmin_action DROP CONSTRAINT IF EXISTS superadmin_action_action_format_check;
ALTER TABLE superadmin_action ADD CONSTRAINT superadmin_action_action_format_check
  CHECK (action ~ '^[A-Z][A-Z0-9_]{0,62}[A-Z0-9]$');
