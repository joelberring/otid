-- Steg 41 (självregistrering på tävlingsdagen): "Tillåt självregistrering på tävlingsdagen" per tävling, av som standard.
-- Självregistrerade deltagare och festgäster märks med tiden, så att admin ser "Självregistrerad" och kan ändra dem.
-- Festgästen får ett visningsnamn (smeknamn) som är det enda som visas publikt; fullt namn behålls för fakturering.
-- Spärren mot upprepade försök får två nya slag: per IP (hashad) och per tävling.
ALTER TABLE race ADD COLUMN IF NOT EXISTS self_registration boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE entry ADD COLUMN IF NOT EXISTS self_registered_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE party_guest ADD COLUMN self_registered_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE party_guest ADD COLUMN display_name text;
--> statement-breakpoint
ALTER TABLE party_guest ADD CONSTRAINT party_guest_display_name_check CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40);
--> statement-breakpoint
ALTER TABLE account_request_throttle DROP CONSTRAINT account_request_throttle_scope_check;
--> statement-breakpoint
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_check
  CHECK (scope IN ('REGISTER_IP', 'RESET_IP', 'RESET_EMAIL', 'SELF_REGISTRATION_IP', 'SELF_REGISTRATION_RACE'));
