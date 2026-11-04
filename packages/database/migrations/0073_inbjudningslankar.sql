-- ADR-0206: inbjudningar med e-post. En länk till en sparad inbjudan (klubb, tävling eller träningsgrupp). Bara hashen av
-- nyckeln sparas (som återställnings- och bekräftelselänkarna). En rad per utfärdad länk: mejlad (MAIL) eller kopierad av
-- administratören (LINK). "Skicka igen" ersätter de tidigare (replaced_at). Raderna räknas också för spärrarna per avsändare
-- och mottagare; mottagaren lagras bara som HMAC (recipient_key), adressen finns redan i inbjudan.
--
-- Bara tillägg: en ny tabell. Nycklarna till inbjudningarna och till kontot gör att raderna tas bort med dem (purge.ts).
CREATE TABLE IF NOT EXISTS invitation_link (
  id uuid NOT NULL,
  club_invitation_id uuid REFERENCES club_invitation (id),
  race_invitation_id uuid REFERENCES race_person_invitation (id),
  group_invitation_id uuid REFERENCES training_group_invitation (id),
  token_hash text NOT NULL,
  recipient_key text NOT NULL,
  issued_by uuid NOT NULL REFERENCES user_account (id),
  delivery text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  replaced_at timestamp with time zone,
  CONSTRAINT invitation_link_pkey PRIMARY KEY (id),
  CONSTRAINT invitation_link_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invitation_link_one_invitation_check CHECK (num_nonnulls(club_invitation_id, race_invitation_id, group_invitation_id) = 1),
  CONSTRAINT invitation_link_delivery_check CHECK (delivery IN ('MAIL', 'LINK')),
  CONSTRAINT invitation_link_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT invitation_link_recipient_key_check CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT invitation_link_expiry_check CHECK (expires_at > created_at)
);
-- Ny och tom tabell: indexen byggs i samma transaktion utan långa lås.
CREATE INDEX IF NOT EXISTS invitation_link_club_idx ON invitation_link (club_invitation_id) WHERE club_invitation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invitation_link_race_idx ON invitation_link (race_invitation_id) WHERE race_invitation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invitation_link_group_idx ON invitation_link (group_invitation_id) WHERE group_invitation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invitation_link_issuer_idx ON invitation_link (issued_by, created_at);
CREATE INDEX IF NOT EXISTS invitation_link_recipient_idx ON invitation_link (recipient_key, created_at);
