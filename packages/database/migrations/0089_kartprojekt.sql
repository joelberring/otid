-- ADR-0219 (steg K0): kartprojekt. Ett projekt utgår från en kartversion i klubbarkivet (exakt grundfilens sha256) och har
-- egna medlemmar. Ändringarna lagras per objekt och synkas genom servern. En ny kartversion skrivs ur ändringarna på begäran.
-- Bara tillägg: nya tabeller och en ny nullbar kolumn i invitation_link (dess villkor vidgas).
--
-- Roller och lägen bestäms i koden (`MAP_PROJECT_ROLES` m.fl. i schema/map-projects.ts); databasen kräver bara formen, så att
-- ett nytt värde (som Förslag i K1) inte behöver en migration (som spärrtyperna i 0087).
--
-- Konton har ingen främmande nyckel där raden ska överleva kontot (författare, avsändare, den som skapade). Medlemskap och
-- tagna inbjudningar har nyckeln och försvinner med kontot (`purgeRows`). Kartversionen och innehållet har nycklar, så att
-- grundfilen inte kan tas bort under ett projekt (`dropUnusedCreated` och `sweepMapContent` frågar också projekten).

CREATE TABLE IF NOT EXISTS map_project (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  name text NOT NULL,
  base_version_id uuid NOT NULL,
  base_sha256 text NOT NULL,
  base_format text NOT NULL,
  reader_version integer NOT NULL,
  status text NOT NULL,
  -- Räknas upp för varje gjord ändring (hämtningen "sedan" i synken).
  seq bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  closed_by uuid,
  closed_at timestamp with time zone,
  request_id uuid NOT NULL,
  CONSTRAINT map_project_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT map_project_base_fkey FOREIGN KEY (base_version_id) REFERENCES club_map_version (id),
  CONSTRAINT map_project_content_fkey FOREIGN KEY (base_sha256) REFERENCES map_content (sha256),
  CONSTRAINT map_project_request_key UNIQUE (request_id),
  CONSTRAINT map_project_format_check CHECK (base_format IN ('OCD', 'OMAP')),
  CONSTRAINT map_project_status_check CHECK (status ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_closed_check CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT map_project_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT map_project_hash_check CHECK (base_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_project_seq_check CHECK (seq >= 0),
  CONSTRAINT map_project_reader_check CHECK (reader_version BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS map_project_club_idx ON map_project (club_id, created_at);
CREATE INDEX IF NOT EXISTS map_project_base_idx ON map_project (base_version_id);
CREATE INDEX IF NOT EXISTS map_project_content_idx ON map_project (base_sha256);

CREATE TABLE IF NOT EXISTS map_project_member (
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role text NOT NULL,
  added_by uuid NOT NULL,
  added_at timestamp with time zone NOT NULL,
  -- Senast projektet öppnades eller synkades av kontot (listan i arbetsytan).
  last_seen_at timestamp with time zone,
  CONSTRAINT map_project_member_pkey PRIMARY KEY (project_id, account_id),
  CONSTRAINT map_project_member_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_member_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id),
  CONSTRAINT map_project_member_role_check CHECK (role ~ '^[A-Z][A-Z_]{1,30}$')
);
CREATE INDEX IF NOT EXISTS map_project_member_account_idx ON map_project_member (account_id);

-- Som club_invitation (0059) och training_group_invitation.
CREATE TABLE IF NOT EXISTS map_project_invitation (
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  project_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone,
  accepted_account_id uuid,
  revoked_at timestamp with time zone,
  CONSTRAINT map_project_invitation_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_invitation_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_invitation_account_fkey FOREIGN KEY (accepted_account_id) REFERENCES user_account (id),
  CONSTRAINT map_project_invitation_request_key UNIQUE (request_id),
  CONSTRAINT map_project_invitation_email_check CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  CONSTRAINT map_project_invitation_role_check CHECK (role ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_invitation_state_check CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
    AND ((accepted_at IS NULL) = (accepted_account_id IS NULL)))
);
CREATE INDEX IF NOT EXISTS map_project_invitation_open_email_idx ON map_project_invitation (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS map_project_invitation_project_idx ON map_project_invitation (project_id, created_at);

-- Länken till en inbjudan (ADR-0206) kan nu också gälla ett kartprojekt. Kolumnen läggs till nullbar och villkoret vidgas.
ALTER TABLE invitation_link ADD COLUMN IF NOT EXISTS map_project_invitation_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_link_map_project_invitation_fkey') THEN
    ALTER TABLE invitation_link ADD CONSTRAINT invitation_link_map_project_invitation_fkey
      FOREIGN KEY (map_project_invitation_id) REFERENCES map_project_invitation (id);
  END IF;
END $$;
ALTER TABLE invitation_link DROP CONSTRAINT IF EXISTS invitation_link_one_invitation_check;
ALTER TABLE invitation_link ADD CONSTRAINT invitation_link_one_invitation_check
  CHECK (num_nonnulls(club_invitation_id, race_invitation_id, group_invitation_id, map_project_invitation_id) = 1);
CREATE INDEX IF NOT EXISTS invitation_link_map_project_invitation_idx ON invitation_link (map_project_invitation_id)
  WHERE map_project_invitation_id IS NOT NULL;

-- Objektens läge (bara ändrade och nya objekt): nyckeln (b:<plats> eller n:<uuid>), grundfilens referens, läget och
-- ändringen som gav det. `seq` är projektets löpnummer när objektet senast ändrades.
CREATE TABLE IF NOT EXISTS map_project_object (
  project_id uuid NOT NULL,
  object_key text NOT NULL,
  ref jsonb,
  state jsonb NOT NULL,
  last_edit_id uuid NOT NULL,
  version integer NOT NULL,
  seq bigint NOT NULL,
  author_account_id uuid NOT NULL,
  edited_at timestamp with time zone NOT NULL,
  received_at timestamp with time zone NOT NULL,
  CONSTRAINT map_project_object_pkey PRIMARY KEY (project_id, object_key),
  CONSTRAINT map_project_object_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_object_key_check CHECK (char_length(object_key) BETWEEN 3 AND 200 AND (object_key LIKE 'b:%' OR object_key LIKE 'n:%')),
  CONSTRAINT map_project_object_ref_check CHECK ((object_key LIKE 'n:%') = (ref IS NULL)),
  CONSTRAINT map_project_object_state_check CHECK (jsonb_typeof(state) = 'object' AND state->>'kind' IN ('UNCHANGED', 'OBJECT', 'DELETED')
    AND pg_column_size(state) <= 1048576),
  CONSTRAINT map_project_object_version_check CHECK (version >= 1 AND seq >= 1)
);
CREATE INDEX IF NOT EXISTS map_project_object_seq_idx ON map_project_object (project_id, seq);

-- Loggen: varje ändring som kom fram, gjord eller krockad (en krock ändrar inget men syns i granskningen). Ändringens id
-- kommer från klienten och är därför ingen primärnyckel; samma id två gånger i samma projekt är samma ändring.
CREATE TABLE IF NOT EXISTS map_project_edit (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
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
  CONSTRAINT map_project_edit_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_edit_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_edit_key UNIQUE (project_id, edit_id),
  CONSTRAINT map_project_edit_kind_check CHECK (kind ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_edit_status_check CHECK (status IN ('APPLIED', 'CONFLICT')),
  CONSTRAINT map_project_edit_seq_check CHECK ((status = 'APPLIED') = (seq IS NOT NULL)),
  CONSTRAINT map_project_edit_client_check CHECK (char_length(client_id) BETWEEN 1 AND 64),
  CONSTRAINT map_project_edit_state_check CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 1048576)
);
CREATE INDEX IF NOT EXISTS map_project_edit_project_idx ON map_project_edit (project_id, received_at);

-- Kartversionerna som skrivits ur projektet: vilken version, vid vilket löpnummer och av vem.
CREATE TABLE IF NOT EXISTS map_project_output (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  version_id uuid NOT NULL,
  seq bigint NOT NULL,
  changes integer NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT map_project_output_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_output_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_output_version_fkey FOREIGN KEY (version_id) REFERENCES club_map_version (id),
  CONSTRAINT map_project_output_request_key UNIQUE (request_id),
  CONSTRAINT map_project_output_seq_check CHECK (seq >= 0 AND changes >= 0)
);
CREATE INDEX IF NOT EXISTS map_project_output_project_idx ON map_project_output (project_id, created_at);
CREATE INDEX IF NOT EXISTS map_project_output_version_idx ON map_project_output (version_id);
