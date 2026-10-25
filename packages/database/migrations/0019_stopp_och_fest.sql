-- Steg 44 (rättelser efter genomlysningen). Övningsstationens avläsningar märks, så att festens köp och summering inte
-- räknar dem: kolumnen fylls i ur råmeddelandet för befintliga rader. Tävlingarnas bedömning är oförändrad.
ALTER TABLE card_readout ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE card_readout r SET simulated = true FROM raw_device_message m
  WHERE m.id = r.raw_message_id AND m.race_id = r.race_id AND (m.raw_payload->>'simulated') = 'true' AND NOT r.simulated;
--> statement-breakpoint
-- "Ta bort incheckning" och "Ta bort utcheckning" i fest-arbetsytan: en ny rad (inget skrivs över). In- eller
-- utcheckningar för brickan till och med `voided_at` räknas inte; en senare (t.ex. en ny målstämpling) räknas igen.
CREATE TABLE party_presence_void (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES race(id),
  request_id uuid NOT NULL,
  card_number text NOT NULL,
  kind text NOT NULL,
  voided_at timestamp with time zone NOT NULL,
  actor_account_id uuid NOT NULL,
  CONSTRAINT party_presence_void_kind_check CHECK (kind IN ('CHECK_IN', 'CHECK_OUT')),
  CONSTRAINT party_presence_void_card_check CHECK (card_number ~ '^[1-9][0-9]{0,8}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX party_presence_void_request_uidx ON party_presence_void (request_id);
--> statement-breakpoint
CREATE INDEX party_presence_void_race_idx ON party_presence_void (race_id, card_number);
