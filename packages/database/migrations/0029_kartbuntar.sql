-- Steg 61: kartor till starten. Senaste utskriften per tävling och lista (kartbuntslistan eller baksidorna) med läget då,
-- så att "N ändringar sedan listan skrevs ut HH:MM" kan visas. Skrivs över vid nästa utskrift. Reserven för tryckantalet
-- (procent eller antal per variant) sparas på tävlingen; NULL = standard (10 %).
CREATE TABLE IF NOT EXISTS map_print (
    race_id uuid NOT NULL,
    list text NOT NULL,
    printed_at timestamp with time zone NOT NULL,
    state jsonb NOT NULL,
    CONSTRAINT map_print_pkey PRIMARY KEY (race_id, list),
    CONSTRAINT map_print_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT map_print_list_check CHECK (list IN ('BUNDLE', 'BACKS')),
    CONSTRAINT map_print_state_check CHECK (jsonb_typeof(state) = 'object')
);

ALTER TABLE race ADD COLUMN IF NOT EXISTS map_reserve jsonb;
ALTER TABLE race DROP CONSTRAINT IF EXISTS race_map_reserve_check;
ALTER TABLE race ADD CONSTRAINT race_map_reserve_check CHECK (map_reserve IS NULL OR (
  jsonb_typeof(map_reserve) = 'object' AND map_reserve->>'kind' IN ('PERCENT', 'COUNT') AND jsonb_typeof(map_reserve->'value') = 'number'
  AND (map_reserve->>'value')::numeric BETWEEN 0 AND 1000));
