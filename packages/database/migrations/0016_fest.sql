-- Steg 40 (fest med bardisk): tävlingstypen PARTY. Gästen stämplar själv på kontrollenheten med varans kod och läser ut
-- brickan vid bardisken med den vanliga avläsningen. Köpen räknas fram ur avläsningarnas stämplingar (card_readout):
-- kod som är en vara, tid efter festens start, unikt per bricka + kod + stämplingstid. Här finns bara det som inte
-- står på brickan: festens start, varorna med prishistorik (priset vid köptillfället), gästernas namn,
-- in- och utcheckningar i bardisken och ångrade köp. Belopp i öre. Ångra och utcheckning är nya rader, inget skrivs över.
ALTER TABLE race DROP CONSTRAINT race_type_check;
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_type_check CHECK (race_type IN ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING', 'PARTY'));
--> statement-breakpoint
ALTER TABLE user_account_event_creation_request DROP CONSTRAINT user_account_event_creation_race_type_check;
--> statement-breakpoint
ALTER TABLE user_account_event_creation_request ADD CONSTRAINT user_account_event_creation_race_type_check
  CHECK (race_type IN ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING', 'PARTY'));
--> statement-breakpoint
CREATE TABLE party_setting (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  starts_at timestamp with time zone NOT NULL,
  -- "Visa namn på den publika sidan": på som standard (ägarens val). Belopp och bricka visas aldrig publikt.
  show_public_names boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE party_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES race(id),
  control_code integer NOT NULL,
  name text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT party_item_code_check CHECK (control_code BETWEEN 1 AND 999),
  CONSTRAINT party_item_name_check CHECK (char_length(name) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX party_item_code_uidx ON party_item (race_id, control_code);
--> statement-breakpoint
-- Priset från och med en tidpunkt. Ett köp kostar priset som gällde när gästen stämplade, så en prisändring ändrar
-- inte gamla köp. Append-only.
CREATE TABLE party_item_price (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES race(id),
  item_id uuid NOT NULL REFERENCES party_item(id),
  price_ore integer NOT NULL,
  valid_from timestamp with time zone NOT NULL,
  CONSTRAINT party_item_price_check CHECK (price_ore BETWEEN 0 AND 10000000)
);
--> statement-breakpoint
CREATE INDEX party_item_price_item_idx ON party_item_price (item_id, valid_from);
--> statement-breakpoint
CREATE TABLE party_guest (
  race_id uuid NOT NULL REFERENCES race(id),
  card_number text NOT NULL,
  name text NOT NULL,
  club text,
  updated_at timestamp with time zone NOT NULL,
  PRIMARY KEY (race_id, card_number),
  CONSTRAINT party_guest_card_check CHECK (card_number ~ '^[1-9][0-9]{0,8}$'),
  CONSTRAINT party_guest_name_check CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT party_guest_club_check CHECK (club IS NULL OR char_length(club) BETWEEN 1 AND 160)
);
--> statement-breakpoint
-- Incheckning och utcheckning i bardisken (lägena "Checka in" och "Checka ut"). Idempotent på enhet + löpnummer
-- (avläsningen det gjordes vid). Startstämpling (incheckning) och målstämpling (utcheckning) efter festens start räknas
-- fram ur avläsningen och har ingen rad här.
CREATE TABLE party_desk_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES race(id),
  card_number text NOT NULL,
  kind text NOT NULL,
  happened_at timestamp with time zone NOT NULL,
  device_id uuid NOT NULL,
  local_sequence integer NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT party_desk_event_kind_check CHECK (kind IN ('CHECK_IN', 'CHECK_OUT')),
  CONSTRAINT party_desk_event_card_check CHECK (card_number ~ '^[1-9][0-9]{0,8}$'),
  CONSTRAINT party_desk_event_sequence_check CHECK (local_sequence > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX party_desk_event_device_uidx ON party_desk_event (race_id, device_id, local_sequence, kind);
--> statement-breakpoint
CREATE TABLE party_purchase_void (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES race(id),
  card_number text NOT NULL,
  control_code integer NOT NULL,
  punched_at timestamp with time zone NOT NULL,
  reason text NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT party_purchase_void_reason_check CHECK (char_length(reason) BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX party_purchase_void_uidx ON party_purchase_void (race_id, card_number, control_code, punched_at);
