-- ADR-0194 beslut 2–3: klubbarkivets kartor (logiska, med versioner), träningarna och banfilerna. Bara tillägg.

-- Indexet till kolumnen från 0059 (training_group är liten, men regeln gäller befintliga tabeller).
CREATE INDEX CONCURRENTLY IF NOT EXISTS training_group_club_idx ON training_group (club_id) WHERE club_id IS NOT NULL;

-- Beslut 2: kartan som område med rättigheterna (samma fält som training_group_map, ADR-0182 beslut 4).
CREATE TABLE IF NOT EXISTS club_map (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  name text NOT NULL,
  ownership text NOT NULL DEFAULT 'CLUB',
  owner_kind text,
  owner_name text,
  agreement text,
  valid_until date,
  contact text,
  training_only boolean NOT NULL DEFAULT false,
  fee_per_print boolean NOT NULL DEFAULT false,
  no_public_display boolean NOT NULL DEFAULT false,
  -- Importens gruppering (namnet utan datum och version), så att en ny körning hittar samma karta.
  import_key text,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT club_map_pkey PRIMARY KEY (id),
  CONSTRAINT club_map_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_map_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT club_map_ownership_check CHECK (ownership IN ('CLUB', 'EXTERNAL')),
  CONSTRAINT club_map_owner_kind_check CHECK (owner_kind IS NULL OR owner_kind IN ('CLUB', 'MUNICIPALITY', 'MAPPER', 'OTHER')),
  CONSTRAINT club_map_texts_check CHECK ((owner_name IS NULL OR char_length(owner_name) BETWEEN 1 AND 200)
    AND (agreement IS NULL OR char_length(agreement) BETWEEN 1 AND 2000) AND (contact IS NULL OR char_length(contact) BETWEEN 1 AND 200)),
  CONSTRAINT club_map_import_key_check CHECK (import_key IS NULL OR char_length(import_key) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS club_map_club_idx ON club_map (club_id, name);
CREATE INDEX IF NOT EXISTS club_map_import_key_idx ON club_map (club_id, import_key) WHERE import_key IS NOT NULL;

-- En version är en fil i kartinnehållet (ADR-0189). Samma innehåll är en version en gång per klubb (club_id finns här för
-- det villkoret; versionen kan flyttas mellan klubbens kartor).
CREATE TABLE IF NOT EXISTS club_map_version (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  map_id uuid NOT NULL,
  content_sha256 text NOT NULL,
  file_name text NOT NULL,
  format text NOT NULL,
  byte_length integer NOT NULL,
  version_date date,
  note text,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamp with time zone NOT NULL,
  source_path text,
  CONSTRAINT club_map_version_pkey PRIMARY KEY (id),
  CONSTRAINT club_map_version_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_map_version_map_id_fkey FOREIGN KEY (map_id) REFERENCES club_map (id),
  CONSTRAINT club_map_version_content_fkey FOREIGN KEY (content_sha256) REFERENCES map_content (sha256),
  CONSTRAINT club_map_version_content_key UNIQUE (club_id, content_sha256),
  CONSTRAINT club_map_version_format_check CHECK (format IN ('OCD', 'OMAP')),
  CONSTRAINT club_map_version_name_check CHECK (char_length(file_name) BETWEEN 1 AND 200),
  CONSTRAINT club_map_version_size_check CHECK (byte_length BETWEEN 1 AND 104857600),
  CONSTRAINT club_map_version_note_check CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  CONSTRAINT club_map_version_path_check CHECK (source_path IS NULL OR char_length(source_path) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS club_map_version_map_idx ON club_map_version (map_id, version_date);
CREATE INDEX IF NOT EXISTS club_map_version_content_idx ON club_map_version (content_sha256);

-- Beslut 3: träningen i arkivet. import_key är källans sökväg (normaliserad), så att en ny körning inte gör dubbletter.
CREATE TABLE IF NOT EXISTS club_archive_entry (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  training_date date,
  year integer,
  place text NOT NULL,
  title text NOT NULL,
  leader text,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  source_path text,
  import_key text,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT club_archive_entry_pkey PRIMARY KEY (id),
  CONSTRAINT club_archive_entry_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_archive_entry_import_key UNIQUE (club_id, import_key),
  CONSTRAINT club_archive_entry_year_check CHECK (year IS NULL OR year BETWEEN 1950 AND 2200),
  CONSTRAINT club_archive_entry_texts_check CHECK (char_length(place) BETWEEN 0 AND 200 AND char_length(btrim(title)) BETWEEN 1 AND 200
    AND (leader IS NULL OR char_length(leader) BETWEEN 1 AND 200) AND (notes IS NULL OR char_length(notes) BETWEEN 1 AND 4000)
    AND (source_path IS NULL OR char_length(source_path) BETWEEN 1 AND 500) AND (import_key IS NULL OR char_length(import_key) BETWEEN 1 AND 500)),
  CONSTRAINT club_archive_entry_tags_check CHECK (cardinality(tags) <= 30)
);
CREATE INDEX IF NOT EXISTS club_archive_entry_club_idx ON club_archive_entry (club_id, training_date DESC);

-- Kartversionerna som låg i träningens mapp (eller som banfilen pekade på).
CREATE TABLE IF NOT EXISTS club_archive_entry_map (
  entry_id uuid NOT NULL,
  version_id uuid NOT NULL,
  CONSTRAINT club_archive_entry_map_pkey PRIMARY KEY (entry_id, version_id),
  CONSTRAINT club_archive_entry_map_entry_fkey FOREIGN KEY (entry_id) REFERENCES club_archive_entry (id),
  CONSTRAINT club_archive_entry_map_version_fkey FOREIGN KEY (version_id) REFERENCES club_map_version (id)
);
CREATE INDEX IF NOT EXISTS club_archive_entry_map_version_idx ON club_archive_entry_map (version_id);

-- Banfilen orörd (.ppen eller IOF CourseData) med sammanfattningen av banorna och den kartversion den gjordes med.
-- map_resolution: FOLDER (kartan i samma mapp), NAME (på filnamnet i en annan mapp), MANUAL (vald i arkivet), MISSING
-- (filen pekar på en karta som inte finns i arkivet), NONE (filen säger ingen karta, t.ex. CourseData).
CREATE TABLE IF NOT EXISTS club_archive_course_file (
  id uuid NOT NULL,
  entry_id uuid NOT NULL,
  club_id uuid NOT NULL,
  kind text NOT NULL,
  file_name text NOT NULL,
  content bytea NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  summary jsonb NOT NULL,
  map_version_id uuid,
  map_reference text,
  map_resolution text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT club_archive_course_file_pkey PRIMARY KEY (id),
  CONSTRAINT club_archive_course_file_entry_fkey FOREIGN KEY (entry_id) REFERENCES club_archive_entry (id),
  CONSTRAINT club_archive_course_file_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_archive_course_file_version_fkey FOREIGN KEY (map_version_id) REFERENCES club_map_version (id),
  CONSTRAINT club_archive_course_file_key UNIQUE (entry_id, sha256),
  CONSTRAINT club_archive_course_file_kind_check CHECK (kind IN ('PPEN', 'COURSE_DATA')),
  CONSTRAINT club_archive_course_file_name_check CHECK (char_length(file_name) BETWEEN 1 AND 200),
  CONSTRAINT club_archive_course_file_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT club_archive_course_file_size_check CHECK (byte_length BETWEEN 1 AND 5242880 AND byte_length = octet_length(content)),
  CONSTRAINT club_archive_course_file_summary_check CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT club_archive_course_file_reference_check CHECK (map_reference IS NULL OR char_length(map_reference) BETWEEN 1 AND 500),
  CONSTRAINT club_archive_course_file_resolution_check CHECK (map_resolution IN ('FOLDER', 'NAME', 'MANUAL', 'MISSING', 'NONE')
    AND ((map_version_id IS NOT NULL) = (map_resolution IN ('FOLDER', 'NAME', 'MANUAL'))))
);
CREATE INDEX IF NOT EXISTS club_archive_course_file_entry_idx ON club_archive_course_file (entry_id);
CREATE INDEX IF NOT EXISTS club_archive_course_file_version_idx ON club_archive_course_file (map_version_id) WHERE map_version_id IS NOT NULL;

-- Beslut 5: en karta i gruppens bibliotek kan komma från klubbens karta (och följa dess senaste version och rättigheter).
-- Indexet byggs i 0061.
ALTER TABLE training_group_map ADD COLUMN IF NOT EXISTS club_map_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_group_map_club_map_id_fkey') THEN
    ALTER TABLE training_group_map ADD CONSTRAINT training_group_map_club_map_id_fkey FOREIGN KEY (club_map_id) REFERENCES club_map (id) NOT VALID;
  END IF;
END $$;
