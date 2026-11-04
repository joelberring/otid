-- ADR-0209: klubbtillhörighet. Klubblistan från Eventor, kontots klubbar (Mina klubbar), klubbarkivets koppling till
-- klubben i listan, tävlingens arrangörsklubb, tävlingar i klubbarkivet och inbjudningar "Från klubben".
-- Bara tillägg: nya, tomma tabeller (indexen byggs i samma transaktion utan långa lås).
--
-- Som i 0059: vem som bekräftade, lade in eller bjöd in har ingen främmande nyckel (borttagningen i purge.ts följer
-- nycklarna och skulle annars ta bort andras rader när ett konto tas bort). Kontots egna rader har nyckel till kontot och
-- försvinner med det.

-- Klubblistan: Eventors organisationer (förbund, distrikt och klubbar). Eventors id är aldrig primärnyckel.
CREATE TABLE IF NOT EXISTS organisation (
  id uuid PRIMARY KEY,
  eventor_id text NOT NULL,
  name text NOT NULL,
  short_name text,
  type text NOT NULL,
  parent_eventor_id text,
  country text,
  -- Namnet, kortnamnet och initialerna normaliserade (gemener, utan accenter och skiljetecken), åtskilda med mellanslag.
  search_text text NOT NULL,
  -- Finns inte längre i Eventors lista. Raden står kvar eftersom tillhörigheter och tävlingar kan peka på den.
  removed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT organisation_eventor_key UNIQUE (eventor_id),
  CONSTRAINT organisation_type_check CHECK (type IN ('FEDERATION', 'DISTRICT', 'CLUB', 'OTHER')),
  CONSTRAINT organisation_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);

-- Varje uppdatering av listan (Eventor högst en gång per dygn, eller en fil). Inga nycklar eller svar sparas.
CREATE TABLE IF NOT EXISTS organisation_refresh (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  started_at timestamp with time zone NOT NULL,
  finished_at timestamp with time zone NOT NULL,
  organisations integer NOT NULL,
  added integer NOT NULL,
  changed integer NOT NULL,
  removed integer NOT NULL,
  CONSTRAINT organisation_refresh_source_check CHECK (source IN ('EVENTOR', 'FILE'))
);
CREATE INDEX IF NOT EXISTS organisation_refresh_finished_idx ON organisation_refresh (source, finished_at DESC);

-- Kontots klubbar: en klubb ur listan eller fri text ("Annan klubb"). En egen anmälan ger ingenting förrän ett
-- klubbarkiv som är kopplat till klubben (eller som matchat fritexten) har bekräftat den, för hand eller via Eventor.
CREATE TABLE IF NOT EXISTS account_club_membership (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES user_account (id),
  organisation_id uuid REFERENCES organisation (id),
  free_text text,
  -- Klubbarkivet som bekräftade, avböjde eller matchade fritexten.
  club_id uuid REFERENCES club (id),
  status text NOT NULL,
  -- ACCOUNT = kontot anmälde klubben själv, EVENTOR = skapad av medlemslistan från Eventor (tas bort när personen slutar).
  origin text NOT NULL DEFAULT 'ACCOUNT',
  -- MANUAL = en administratör bekräftade, EVENTOR = adressen fanns i klubbens medlemslista i Eventor.
  confirmed_via text,
  created_at timestamp with time zone NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone,
  CONSTRAINT account_club_membership_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'DECLINED')),
  CONSTRAINT account_club_membership_origin_check CHECK (origin IN ('ACCOUNT', 'EVENTOR')),
  CONSTRAINT account_club_membership_via_check CHECK (confirmed_via IS NULL OR confirmed_via IN ('MANUAL', 'EVENTOR')),
  CONSTRAINT account_club_membership_club_check CHECK ((organisation_id IS NULL) <> (free_text IS NULL)),
  CONSTRAINT account_club_membership_text_check CHECK (free_text IS NULL OR char_length(btrim(free_text)) BETWEEN 1 AND 120),
  CONSTRAINT account_club_membership_decided_check CHECK ((status = 'PENDING') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS account_club_membership_organisation_uidx ON account_club_membership (account_id, organisation_id)
  WHERE organisation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_club_membership_text_uidx ON account_club_membership (account_id, lower(btrim(free_text)))
  WHERE free_text IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_club_membership_organisation_idx ON account_club_membership (organisation_id, status);
CREATE INDEX IF NOT EXISTS account_club_membership_club_idx ON account_club_membership (club_id, status);

-- Steget "Vilken klubb tillhör du?" efter registreringen är besvarat eller överhoppat.
CREATE TABLE IF NOT EXISTS account_club_prompt (
  account_id uuid PRIMARY KEY REFERENCES user_account (id),
  answered_at timestamp with time zone NOT NULL
);

-- Klubbarkivets inställningar: kopplingen till klubben i Eventor (bevisad med klubbens egen API-nyckel, som bara en
-- administratör i Eventor kan skapa) och "Vem ser vad". Nyckeln lagras krypterad (AES-256-GCM med OTID_EVENTOR_MASTER_KEY,
-- som tävlingarnas nycklar); bara de sista fyra tecknen visas. En klubb i Eventor kopplas till högst ett klubbarkiv.
CREATE TABLE IF NOT EXISTS club_setting (
  club_id uuid PRIMARY KEY REFERENCES club (id),
  organisation_id uuid REFERENCES organisation (id),
  eventor_key_id text,
  eventor_key_iv text,
  eventor_key_tag text,
  eventor_key_ciphertext text,
  eventor_key_hint text,
  linked_by uuid,
  linked_at timestamp with time zone,
  -- Träningsarkivet (träningar, småbilder, banfiler) syns för: alla medlemmar eller bara ledare och administratörer.
  archive_visibility text NOT NULL DEFAULT 'MEMBERS',
  -- Kartbanken (kartfiler, Använd igen, nedladdning) får användas av: ledare och administratörer eller alla medlemmar.
  map_bank_access text NOT NULL DEFAULT 'LEADERS',
  updated_by uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT club_setting_archive_check CHECK (archive_visibility IN ('MEMBERS', 'LEADERS')),
  CONSTRAINT club_setting_map_bank_check CHECK (map_bank_access IN ('MEMBERS', 'LEADERS')),
  CONSTRAINT club_setting_key_check CHECK ((eventor_key_ciphertext IS NULL) = (organisation_id IS NULL)
    AND (eventor_key_ciphertext IS NULL) = (eventor_key_id IS NULL) AND (eventor_key_ciphertext IS NULL) = (eventor_key_iv IS NULL)
    AND (eventor_key_ciphertext IS NULL) = (eventor_key_tag IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS club_setting_organisation_uidx ON club_setting (organisation_id) WHERE organisation_id IS NOT NULL;
-- Klubbar som fanns före ADR-0209 har bjudit in sina läsare uttryckligen: de behåller kartbanken (som förut). Nya rader.
INSERT INTO club_setting (club_id, archive_visibility, map_bank_access, updated_by, updated_at)
  SELECT id, 'MEMBERS', 'MEMBERS', created_by, now() FROM club ON CONFLICT (club_id) DO NOTHING;

-- Ledare: ny roll i klubbarkivet mellan läsare (medlem) och administratör. Vidgade villkor.
ALTER TABLE club_member DROP CONSTRAINT IF EXISTS club_member_role_check;
ALTER TABLE club_member ADD CONSTRAINT club_member_role_check CHECK (role IN ('OWNER', 'ADMIN', 'LEADER', 'READER'));
ALTER TABLE club_invitation DROP CONSTRAINT IF EXISTS club_invitation_role_check;
ALTER TABLE club_invitation ADD CONSTRAINT club_invitation_role_check CHECK (role IN ('OWNER', 'ADMIN', 'LEADER', 'READER'));

-- Klubbens medlemslista i Eventor: bara Eventors person-id och en nyckelad hash (HMAC-SHA256) av den normaliserade
-- e-postadressen. Inga namn, födelsedatum, adresser eller telefonnummer. Ersätts helt vid varje hämtning.
CREATE TABLE IF NOT EXISTS club_eventor_member (
  club_id uuid NOT NULL REFERENCES club (id),
  email_hmac text NOT NULL,
  eventor_person_id text NOT NULL,
  key_id text NOT NULL,
  CONSTRAINT club_eventor_member_pkey PRIMARY KEY (club_id, email_hmac),
  CONSTRAINT club_eventor_member_hmac_check CHECK (email_hmac ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS club_eventor_member_hmac_idx ON club_eventor_member (email_hmac);

-- Senaste hämtningen av medlemslistan (högst en gång per dygn automatiskt, och "Hämta medlemmar nu").
CREATE TABLE IF NOT EXISTS club_eventor_sync (
  club_id uuid PRIMARY KEY REFERENCES club (id),
  attempted_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone,
  members integer NOT NULL DEFAULT 0,
  problem text
);

-- Tävlingens arrangörsklubb (en klubb i listan). Tas bort med tävlingen.
CREATE TABLE IF NOT EXISTS race_organiser (
  race_id uuid PRIMARY KEY REFERENCES race (id),
  organisation_id uuid NOT NULL REFERENCES organisation (id),
  set_by uuid NOT NULL,
  set_at timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS race_organiser_organisation_idx ON race_organiser (organisation_id);

-- En tävling i klubbarkivet ("Lägg i klubbarkivet"). Ingen nyckel till tävlingen eller träningen: arkivets träning står kvar
-- när tävlingen tas bort, och raden räknas bara när träningen finns.
CREATE TABLE IF NOT EXISTS race_club_archive (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL,
  club_id uuid NOT NULL REFERENCES club (id),
  entry_id uuid NOT NULL,
  -- Kartan och versionen som skapades vid inlyftet (tas bort vid "Ta ur klubbarkivet" om inget annat använder dem).
  created_map_id uuid,
  created_version_id uuid,
  race_name text NOT NULL,
  race_date date NOT NULL,
  lifted_by uuid NOT NULL,
  lifted_at timestamp with time zone NOT NULL,
  CONSTRAINT race_club_archive_key UNIQUE (race_id, club_id)
);
CREATE INDEX IF NOT EXISTS race_club_archive_entry_idx ON race_club_archive (entry_id);

-- "Från klubben": inbjudningar som skapats från klubbens medlemmar. Listorna visar namnet, aldrig adressen.
CREATE TABLE IF NOT EXISTS invitation_club_source (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  invitation_id uuid NOT NULL,
  context_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES user_account (id),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT invitation_club_source_kind_check CHECK (kind IN ('RACE_PERSON', 'CLUB', 'TRAINING_GROUP')),
  CONSTRAINT invitation_club_source_key UNIQUE (kind, invitation_id)
);
CREATE INDEX IF NOT EXISTS invitation_club_source_context_idx ON invitation_club_source (kind, context_id, account_id);
