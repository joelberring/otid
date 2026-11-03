-- ADR-0196: klubbarkivets kontroll av kartversionerna (fungerar eller varför inte) och små bilder av kartorna och träningarna.
-- Bara nya tabeller. Bilderna ritas i webbläsaren (som kartbilden vid uppladdning, ADR-0179 beslut 2) och sparas här en gång;
-- de är små (högst 512 kB), unika per version eller träning och går alltid att rita om, så de ligger inte i kartinnehållet
-- (ADR-0189) och räknas inte i kvoten. `reader_version` är kartläsarens version när bilden ritades: en bättre läsare ritar om.

CREATE TABLE IF NOT EXISTS club_map_version_check (
  version_id uuid NOT NULL,
  club_id uuid NOT NULL,
  reader_version integer NOT NULL,
  status text NOT NULL,
  detail text,
  file_version text,
  thumbnail bytea,
  thumbnail_width integer,
  thumbnail_height integer,
  checked_at timestamp with time zone NOT NULL,
  CONSTRAINT club_map_version_check_pkey PRIMARY KEY (version_id),
  CONSTRAINT club_map_version_check_version_fkey FOREIGN KEY (version_id) REFERENCES club_map_version (id),
  CONSTRAINT club_map_version_check_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_map_version_check_reader_check CHECK (reader_version BETWEEN 1 AND 10000),
  CONSTRAINT club_map_version_check_status_check CHECK (status IN ('OK', 'UNSUPPORTED_VERSION', 'NOT_A_MAP_FILE', 'TRUNCATED', 'INVALID',
    'EMPTY', 'TOO_LARGE', 'FAILED')),
  CONSTRAINT club_map_version_check_texts_check CHECK ((detail IS NULL OR char_length(detail) BETWEEN 1 AND 300)
    AND (file_version IS NULL OR char_length(file_version) BETWEEN 1 AND 60)),
  CONSTRAINT club_map_version_check_thumbnail_check CHECK ((thumbnail IS NULL AND thumbnail_width IS NULL AND thumbnail_height IS NULL)
    OR (octet_length(thumbnail) BETWEEN 1 AND 524288 AND thumbnail_width BETWEEN 1 AND 2000 AND thumbnail_height BETWEEN 1 AND 2000))
);
CREATE INDEX IF NOT EXISTS club_map_version_check_club_idx ON club_map_version_check (club_id);

-- Träningens bild: den längsta banan på kartversionen den gjordes med (eller kartan när träningen saknar banor).
-- `map_version_id` är versionen bilden ritades på; byts banfilens karta tas bilden bort och ritas om.
CREATE TABLE IF NOT EXISTS club_archive_entry_thumbnail (
  entry_id uuid NOT NULL,
  club_id uuid NOT NULL,
  reader_version integer NOT NULL,
  status text NOT NULL,
  detail text,
  map_version_id uuid,
  course_name text,
  image bytea,
  width integer,
  height integer,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT club_archive_entry_thumbnail_pkey PRIMARY KEY (entry_id),
  CONSTRAINT club_archive_entry_thumbnail_entry_fkey FOREIGN KEY (entry_id) REFERENCES club_archive_entry (id),
  CONSTRAINT club_archive_entry_thumbnail_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_archive_entry_thumbnail_version_fkey FOREIGN KEY (map_version_id) REFERENCES club_map_version (id),
  CONSTRAINT club_archive_entry_thumbnail_reader_check CHECK (reader_version BETWEEN 1 AND 10000),
  CONSTRAINT club_archive_entry_thumbnail_status_check CHECK (status IN ('OK', 'MAP_FAILED')),
  CONSTRAINT club_archive_entry_thumbnail_texts_check CHECK ((detail IS NULL OR char_length(detail) BETWEEN 1 AND 300)
    AND (course_name IS NULL OR char_length(course_name) BETWEEN 1 AND 120)),
  CONSTRAINT club_archive_entry_thumbnail_image_check CHECK ((status = 'OK') = (image IS NOT NULL)
    AND ((image IS NULL AND width IS NULL AND height IS NULL)
      OR (octet_length(image) BETWEEN 1 AND 524288 AND width BETWEEN 1 AND 2000 AND height BETWEEN 1 AND 2000)))
);
CREATE INDEX IF NOT EXISTS club_archive_entry_thumbnail_club_idx ON club_archive_entry_thumbnail (club_id);
CREATE INDEX IF NOT EXISTS club_archive_entry_thumbnail_version_idx ON club_archive_entry_thumbnail (map_version_id) WHERE map_version_id IS NOT NULL;
