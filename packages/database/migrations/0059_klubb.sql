-- ADR-0194 beslut 1 och 7: klubben, dess medlemmar, inbjudningarna per e-postadress, importnyckeln och journalen.
-- Bara tillägg: nya tabeller och en nullbar kolumn på training_group.
--
-- Konton som skapat eller ändrat något har med avsikt ingen främmande nyckel (created_by, actor_account_id i journalen):
-- borttagningen (purge.ts) följer nycklarna och skulle annars ta bort hela klubben med arkivet när ett konto tas bort.
-- Medlemskapet och importnyckeln har nyckel till kontot och försvinner med det.
CREATE TABLE IF NOT EXISTS club (
  id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT club_pkey PRIMARY KEY (id),
  CONSTRAINT club_request_key UNIQUE (request_id),
  CONSTRAINT club_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS club_member (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role text NOT NULL,
  added_at timestamp with time zone NOT NULL,
  added_by uuid NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT club_member_pkey PRIMARY KEY (id),
  CONSTRAINT club_member_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_member_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_account (id),
  CONSTRAINT club_member_key UNIQUE (club_id, account_id),
  CONSTRAINT club_member_request_key UNIQUE (request_id),
  CONSTRAINT club_member_role_check CHECK (role IN ('OWNER', 'ADMIN', 'READER'))
);
-- Nya och tomma tabeller: indexen byggs i samma transaktion utan långa lås.
CREATE INDEX IF NOT EXISTS club_member_account_idx ON club_member (account_id);

-- Som race_person_invitation (ADR-0188 beslut 6) och training_group_invitation (ADR-0189 beslut 9).
CREATE TABLE IF NOT EXISTS club_invitation (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  club_id uuid NOT NULL REFERENCES club (id),
  email text NOT NULL,
  role text NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_account_id uuid REFERENCES user_account (id),
  revoked_at timestamptz,
  CONSTRAINT club_invitation_request_uidx UNIQUE (request_id),
  CONSTRAINT club_invitation_email_check CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  CONSTRAINT club_invitation_role_check CHECK (role IN ('OWNER', 'ADMIN', 'READER')),
  CONSTRAINT club_invitation_state_check CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
    AND ((accepted_at IS NULL) = (accepted_account_id IS NULL)))
);
CREATE INDEX IF NOT EXISTS club_invitation_open_email_idx ON club_invitation (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS club_invitation_club_idx ON club_invitation (club_id, created_at);

-- Beslut 7: nyckeln för importen från ägarens dator. Bara hashen sparas; nyckeln visas en gång.
CREATE TABLE IF NOT EXISTS club_import_token (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  account_id uuid NOT NULL,
  token_sha256 text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  last_used_at timestamp with time zone,
  CONSTRAINT club_import_token_pkey PRIMARY KEY (id),
  CONSTRAINT club_import_token_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_import_token_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_account (id),
  CONSTRAINT club_import_token_hash_key UNIQUE (token_sha256),
  CONSTRAINT club_import_token_hash_check CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT club_import_token_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 day')
);
CREATE INDEX IF NOT EXISTS club_import_token_club_idx ON club_import_token (club_id, created_at);

-- Klubbens journal (inbjudningar, roller, importer, kartornas ändringar). audit_event kräver en tävling.
CREATE TABLE IF NOT EXISTS club_journal (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  action text NOT NULL,
  actor_account_id uuid,
  details jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT club_journal_pkey PRIMARY KEY (id),
  CONSTRAINT club_journal_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_journal_details_check CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX IF NOT EXISTS club_journal_club_idx ON club_journal (club_id, created_at);

-- ADR-0182 beslut 8: en klubb kan äga grupper senare utan att grupperna görs om. Sätts inte än. Indexet byggs i 0060
-- (CONCURRENTLY körs före filens transaktion och kolumnen måste finnas då).
ALTER TABLE training_group ADD COLUMN IF NOT EXISTS club_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_group_club_id_fkey') THEN
    ALTER TABLE training_group ADD CONSTRAINT training_group_club_id_fkey FOREIGN KEY (club_id) REFERENCES club (id) NOT VALID;
  END IF;
END $$;
