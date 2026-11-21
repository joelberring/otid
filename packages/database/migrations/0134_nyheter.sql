-- Nyhetsflödet «Nytt i O-Tid» (ADR-0230). Bara en ny tabell.
--
-- news_item: en nyhet. `club_id` NULL = allmän (skriven av superadmin, syns för alla på startsidan); annars klubbens nyhet
-- (skriven av klubbens ledare, administratörer eller ägare, syns bara för klubbens inloggade medlemmar). `link`: en intern
-- sökväg eller en http(s)-adress (koden normaliserar; villkoret är ett skydd till). Bilden (valfri, liten, visas 16:9) ligger i
-- raden som klubbarkivets småbilder. `hidden_at`: dold (syns inte för läsarna, finns kvar för den som skriver). `created_by` och
-- `updated_by` utan främmande nyckel (som inbjudningarna): ett borttaget konto tar inte med sig nyheten.
CREATE TABLE IF NOT EXISTS news_item (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  club_id uuid REFERENCES club(id),
  title text NOT NULL,
  body text NOT NULL,
  link text,
  image bytea,
  image_media_type text,
  image_width integer,
  image_height integer,
  image_sha256 text,
  published_at timestamptz NOT NULL,
  hidden_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT news_item_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT news_item_body_check CHECK (char_length(body) <= 400),
  CONSTRAINT news_item_link_check CHECK (link IS NULL OR (char_length(link) <= 500 AND (link ~ '^/([^/\\]|$)' OR link ~ '^https?://'))),
  CONSTRAINT news_item_image_check CHECK ((image IS NULL) = (image_media_type IS NULL) AND (image IS NULL) = (image_width IS NULL)
    AND (image IS NULL) = (image_height IS NULL) AND (image IS NULL) = (image_sha256 IS NULL)
    AND (image IS NULL OR (octet_length(image) <= 307200 AND image_media_type IN ('image/webp', 'image/jpeg', 'image/png')
      AND image_width BETWEEN 1 AND 2000 AND image_height BETWEEN 1 AND 2000)))
);

CREATE UNIQUE INDEX IF NOT EXISTS news_item_request_uidx ON news_item (request_id);
CREATE INDEX IF NOT EXISTS news_item_published_idx ON news_item (published_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS news_item_club_idx ON news_item (club_id, published_at DESC) WHERE club_id IS NOT NULL;
