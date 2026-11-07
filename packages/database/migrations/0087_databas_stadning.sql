-- Städrundan 2026-11-07, paket C5: säkrare schema utan ändring för användaren. Bara borttagna villkor, ett villkor som alla
-- befintliga rader uppfyller och kolumner som blir nullbara (steg 1 i tvåstegsregeln, AGENTS.md). Ingen data skrivs om.

-- Spärrens scope (ADR-0172 beslut 1, ADR-0189): listan i CHECK skrevs om i 0000, 0018, 0040, 0046, 0083 och 0084, varje gång
-- med hela listan kopierad, och en glömd rad gav fel i drift. Vilka scope som finns bestäms nu i koden (`ACCOUNT_REQUEST_THROTTLE_SCOPES` i
-- packages/database/src/schema/accounts.ts; `throttleKeyHash` i application vägrar andra); databasen kräver bara formen. Ett nytt
-- scope behöver alltså ingen migration. Tabellen är liten (rader äldre än två dygn tas bort), så villkoret valideras direkt.
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_check;
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_format_check;
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_format_check
  CHECK (scope ~ '^[A-Z][A-Z0-9_]{0,62}[A-Z0-9]$');

-- K4 (ADR-0189 beslut 9): gruppinbjudans avsändare pekades ut med främmande nyckel, så att borttagningen av ett konto
-- (`purgeRows`, som följer nycklarna) tog bort inbjudningar som kontot skickat till andra. Klubbens inbjudan saknar nyckeln
-- medvetet; nu gör gruppens det också. Inbjudan och medlemskapet den blir (`added_by`, utan nyckel sedan 0035) kan då peka på
-- ett konto som inte finns; id:t jämförs bara med den inloggades och visas inte.
ALTER TABLE training_group_invitation DROP CONSTRAINT IF EXISTS training_group_invitation_actor_account_id_fkey;

-- ADR-0205: bekräftelselänkens kopia av lösenordets verifierare läses inte sedan lösenordet väljs när länken öppnas. Steg 1:
-- kolumnerna blir nullbara och koden slutar skriva dem (en äldre version som fortfarande skriver dem fungerar). Steg 2, DROP
-- COLUMN, i en senare driftsättning (STATUS.md). Formvillkoren står kvar och släpper igenom NULL.
ALTER TABLE email_verification_token ALTER COLUMN salt_hex DROP NOT NULL;
ALTER TABLE email_verification_token ALTER COLUMN verifier_hex DROP NOT NULL;

-- Prövat men inte gjort: främmande nycklar på club_map_merge (target_map_id, created_by, undone_by) och
-- club_map_duplicate_dismissal (created_by) från 0077. Målet kan gå upp i en senare sammanslagning och komma tillbaka när den
-- ångras, och `purgeRows` skulle följa en nyckel till user_account och radera klubbens historik (se schema/clubs.ts).
