-- ADR-0210: dubbletter och versioner av klubbarkivets kartor. Bara tillägg: nya kolumner (nullbara) och nya tabeller.
-- Kartornas innehåll (map_content) och versionernas filer rörs aldrig; en sammanslagning är bara metadata.

-- Kartans beskrivning och kartritare (sätts en gång på kartan och kan kopieras till versionerna).
ALTER TABLE club_map ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE club_map ADD COLUMN IF NOT EXISTS maker text;
ALTER TABLE club_map DROP CONSTRAINT IF EXISTS club_map_texts_0077_check;
ALTER TABLE club_map ADD CONSTRAINT club_map_texts_0077_check CHECK ((description IS NULL OR char_length(description) BETWEEN 1 AND 2000)
  AND (maker IS NULL OR char_length(maker) BETWEEN 1 AND 200));

-- Versionens år när någon har skrivit in det (annars gissas det när arkivet visas) och versionens kartritare.
ALTER TABLE club_map_version ADD COLUMN IF NOT EXISTS version_year integer;
ALTER TABLE club_map_version ADD COLUMN IF NOT EXISTS maker text;
ALTER TABLE club_map_version DROP CONSTRAINT IF EXISTS club_map_version_0077_check;
ALTER TABLE club_map_version ADD CONSTRAINT club_map_version_0077_check CHECK ((version_year IS NULL OR version_year BETWEEN 1950 AND 2100)
  AND (maker IS NULL OR char_length(maker) BETWEEN 1 AND 200));

-- Kartversionens fingeravtryck, räknat i webbläsaren vid kontrollen (ytan, skalan, symbolerna, antalet objekt).
ALTER TABLE club_map_version_check ADD COLUMN IF NOT EXISTS fingerprint jsonb;
ALTER TABLE club_map_version_check DROP CONSTRAINT IF EXISTS club_map_version_check_fingerprint_check;
ALTER TABLE club_map_version_check ADD CONSTRAINT club_map_version_check_fingerprint_check CHECK (fingerprint IS NULL
  OR (jsonb_typeof(fingerprint) = 'object' AND octet_length(fingerprint::text) <= 32768));

-- "Inte samma karta": paret föreslås aldrig igen. Kartorna pekas inte ut med främmande nycklar, så att en sammanslagning
-- (som tar bort de uppgående kartorna) och dess ångring inte hindras; paren till en karta som inte finns räknas inte.
CREATE TABLE IF NOT EXISTS club_map_duplicate_dismissal (
  club_id uuid NOT NULL,
  map_a uuid NOT NULL,
  map_b uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  CONSTRAINT club_map_duplicate_dismissal_pkey PRIMARY KEY (club_id, map_a, map_b),
  CONSTRAINT club_map_duplicate_dismissal_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_map_duplicate_dismissal_order_check CHECK (map_a < map_b)
);

-- En sammanslagning med det som behövs för "Ångra sammanslagning": de uppgående kartornas rader, vilka versioner och
-- gruppbibliotekets kartor som flyttades, och målets versioner och ändringstid direkt efteråt (ändras något av dem går
-- sammanslagningen inte längre att ångra).
CREATE TABLE IF NOT EXISTS club_map_merge (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  target_map_id uuid NOT NULL,
  absorbed jsonb NOT NULL,
  target_version_ids jsonb NOT NULL,
  target_updated_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  undone_at timestamp with time zone,
  undone_by uuid,
  CONSTRAINT club_map_merge_pkey PRIMARY KEY (id),
  CONSTRAINT club_map_merge_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_map_merge_json_check CHECK (jsonb_typeof(absorbed) = 'array' AND jsonb_typeof(target_version_ids) = 'array'),
  CONSTRAINT club_map_merge_undone_check CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);
CREATE INDEX IF NOT EXISTS club_map_merge_target_idx ON club_map_merge (club_id, target_map_id, created_at DESC);
