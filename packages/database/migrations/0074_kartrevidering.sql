-- ADR-0208: kartrevideringen. Flera kartritare reviderar samma kartversion i klubbarkivet (exakt grundfilens sha256), med
-- ändringar per objekt som synkas genom servern. Bara tillägg: nya tabeller, och klubbens roller får rollen Kartrevidering
-- (MAP_REVISER) som bjuds in som de andra rollerna. Villkoren på rollen vidgas (inga rader ändras).
--
-- Konton har med avsikt ingen främmande nyckel (som klubbens tabeller, 0059): borttagningen av ett konto ska inte ta bort
-- revideringen. Namnen visas bara för revideringens deltagare (tjänsten slår upp dem).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_member_role_check' AND pg_get_constraintdef(oid) LIKE '%MAP_REVISER%') THEN
    ALTER TABLE club_member DROP CONSTRAINT IF EXISTS club_member_role_check;
    ALTER TABLE club_member ADD CONSTRAINT club_member_role_check CHECK (role IN ('OWNER', 'ADMIN', 'READER', 'MAP_REVISER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_invitation_role_check' AND pg_get_constraintdef(oid) LIKE '%MAP_REVISER%') THEN
    ALTER TABLE club_invitation DROP CONSTRAINT IF EXISTS club_invitation_role_check;
    ALTER TABLE club_invitation ADD CONSTRAINT club_invitation_role_check CHECK (role IN ('OWNER', 'ADMIN', 'READER', 'MAP_REVISER'));
  END IF;
END $$;

-- Revideringen: grundversionen (kartan är versionens, så att versioner kan flyttas och kartor slås ihop) och dess innehåll, öppen eller avslutad, och den nya versionen när den skapats.
-- `seq` räknas upp för varje gjord ändring (hämtningen "sedan" i synken).
CREATE TABLE IF NOT EXISTS map_revision (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  base_version_id uuid NOT NULL,
  base_sha256 text NOT NULL,
  base_format text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  seq bigint NOT NULL DEFAULT 0,
  reader_version integer NOT NULL,
  -- Startad från en tävlings karta (valfritt, ingen nyckel: tävlingen kan tas bort).
  source_race_id uuid,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  closed_by uuid,
  closed_at timestamp with time zone,
  result_version_id uuid,
  request_id uuid NOT NULL,
  CONSTRAINT map_revision_pkey PRIMARY KEY (id),
  CONSTRAINT map_revision_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT map_revision_base_fkey FOREIGN KEY (base_version_id) REFERENCES club_map_version (id),
  CONSTRAINT map_revision_content_fkey FOREIGN KEY (base_sha256) REFERENCES map_content (sha256),
  CONSTRAINT map_revision_result_fkey FOREIGN KEY (result_version_id) REFERENCES club_map_version (id),
  CONSTRAINT map_revision_request_key UNIQUE (request_id),
  CONSTRAINT map_revision_format_check CHECK (base_format IN ('OCD', 'OMAP')),
  CONSTRAINT map_revision_status_check CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT map_revision_closed_check CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT map_revision_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT map_revision_hash_check CHECK (base_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_revision_seq_check CHECK (seq >= 0),
  CONSTRAINT map_revision_reader_check CHECK (reader_version BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS map_revision_club_idx ON map_revision (club_id, created_at);
CREATE INDEX IF NOT EXISTS map_revision_base_idx ON map_revision (base_version_id);
CREATE INDEX IF NOT EXISTS map_revision_result_idx ON map_revision (result_version_id) WHERE result_version_id IS NOT NULL;

-- Objektens läge (bara ändrade och nya objekt): nyckeln (b:<referens> eller n:<uuid>), grundfilens referens, läget och
-- ändringen som gav det. `seq` är revideringens löpnummer när objektet senast ändrades.
CREATE TABLE IF NOT EXISTS map_revision_object (
  revision_id uuid NOT NULL,
  object_key text NOT NULL,
  ref jsonb,
  state jsonb NOT NULL,
  last_edit_id uuid NOT NULL,
  version integer NOT NULL,
  seq bigint NOT NULL,
  author_account_id uuid NOT NULL,
  edited_at timestamp with time zone NOT NULL,
  received_at timestamp with time zone NOT NULL,
  CONSTRAINT map_revision_object_pkey PRIMARY KEY (revision_id, object_key),
  CONSTRAINT map_revision_object_revision_fkey FOREIGN KEY (revision_id) REFERENCES map_revision (id),
  CONSTRAINT map_revision_object_key_check CHECK (char_length(object_key) BETWEEN 3 AND 200 AND (object_key LIKE 'b:%' OR object_key LIKE 'n:%')),
  CONSTRAINT map_revision_object_ref_check CHECK ((object_key LIKE 'n:%') = (ref IS NULL)),
  CONSTRAINT map_revision_object_state_check CHECK (jsonb_typeof(state) = 'object' AND state->>'kind' IN ('UNCHANGED', 'OBJECT', 'DELETED')
    AND pg_column_size(state) <= 1048576),
  CONSTRAINT map_revision_object_version_check CHECK (version >= 1 AND seq >= 1)
);
CREATE INDEX IF NOT EXISTS map_revision_object_seq_idx ON map_revision_object (revision_id, seq);

-- Loggen: varje ändring som kom fram, gjord eller krockad (en krock ändrar inget men syns i granskningen). Ändringens id
-- kommer från klienten och är därför ingen primärnyckel; samma id två gånger i samma revidering är samma ändring.
CREATE TABLE IF NOT EXISTS map_revision_edit (
  id uuid NOT NULL,
  revision_id uuid NOT NULL,
  edit_id uuid NOT NULL,
  object_key text NOT NULL,
  base_edit_id uuid,
  kind text NOT NULL,
  status text NOT NULL,
  state jsonb NOT NULL,
  seq bigint,
  author_account_id uuid NOT NULL,
  client_id text NOT NULL,
  edited_at timestamp with time zone NOT NULL,
  received_at timestamp with time zone NOT NULL,
  CONSTRAINT map_revision_edit_pkey PRIMARY KEY (id),
  CONSTRAINT map_revision_edit_revision_fkey FOREIGN KEY (revision_id) REFERENCES map_revision (id),
  CONSTRAINT map_revision_edit_key UNIQUE (revision_id, edit_id),
  CONSTRAINT map_revision_edit_kind_check CHECK (kind IN ('MOVE', 'RESHAPE', 'ADD', 'DELETE', 'SYMBOL', 'TEXT', 'UNDO', 'REDO', 'RESOLVE')),
  CONSTRAINT map_revision_edit_status_check CHECK (status IN ('APPLIED', 'CONFLICT')),
  CONSTRAINT map_revision_edit_seq_check CHECK ((status = 'APPLIED') = (seq IS NOT NULL)),
  CONSTRAINT map_revision_edit_client_check CHECK (char_length(client_id) BETWEEN 1 AND 64),
  CONSTRAINT map_revision_edit_state_check CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 1048576)
);
CREATE INDEX IF NOT EXISTS map_revision_edit_revision_idx ON map_revision_edit (revision_id, received_at);

-- Deltagarna: vem som har haft revideringen öppen och när senast (listan i arbetsytan).
CREATE TABLE IF NOT EXISTS map_revision_participant (
  revision_id uuid NOT NULL,
  account_id uuid NOT NULL,
  first_seen_at timestamp with time zone NOT NULL,
  last_seen_at timestamp with time zone NOT NULL,
  CONSTRAINT map_revision_participant_pkey PRIMARY KEY (revision_id, account_id),
  CONSTRAINT map_revision_participant_revision_fkey FOREIGN KEY (revision_id) REFERENCES map_revision (id)
);
