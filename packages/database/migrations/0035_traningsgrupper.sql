-- Steg 68 (ADR-0182): träningsgrupper.
--
-- training_group: gruppen med namn, fast kod i länken (/g/<kod>) och synlighetsinställningarna (beslut 7) med försiktiga
-- standardvärden: gruppsidan för alla med länken, förnamn, närvaro och statistik bara för ledarna, ingen poängserie.
-- template_race_id (mallen) och de andra id:na till tävlingar och konton saknar främmande nyckel med avsikt: borttagningen
-- (purge.ts) följer nycklarna och skulle annars ta bort hela gruppen när en mall eller ett konto tas bort.
-- Beslut 8: en klubb med flera grupper läggs senare till som en egen tabell och en nullbar kolumn här; koden är unik i
-- hela O-Tid och inget här förutsätter en grupp per klubb.
CREATE TABLE IF NOT EXISTS training_group (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL,
    page_visibility text NOT NULL DEFAULT 'LINK',
    name_display text NOT NULL DEFAULT 'FIRST',
    stats_visibility text NOT NULL DEFAULT 'LEADERS',
    points_mode text NOT NULL DEFAULT 'NONE',
    template_race_id uuid,
    settings_version integer NOT NULL DEFAULT 1,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT training_group_pkey PRIMARY KEY (id),
    CONSTRAINT training_group_code_key UNIQUE (code),
    CONSTRAINT training_group_request_key UNIQUE (request_id),
    CONSTRAINT training_group_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT training_group_code_check CHECK (code ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$'),
    CONSTRAINT training_group_page_visibility_check CHECK (page_visibility IN ('LINK', 'MEMBERS')),
    CONSTRAINT training_group_name_display_check CHECK (name_display IN ('FIRST', 'FULL', 'NONE')),
    CONSTRAINT training_group_stats_visibility_check CHECK (stats_visibility IN ('LEADERS', 'MEMBERS')),
    CONSTRAINT training_group_points_mode_check CHECK (points_mode IN ('NONE', 'ATTENDANCE', 'PLACEMENT')),
    CONSTRAINT training_group_settings_version_check CHECK (settings_version > 0)
);

-- Ledare (ADMIN på gruppens tävlingar, beslut 1) och medlemmar (ser gruppsidan när den bara är för inloggade, och närvaron
-- när den är för medlemmarna). Ett befintligt konto läggs till med e-post som andra roller; en borttagning tar bort raden.
CREATE TABLE IF NOT EXISTS training_group_member (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    account_id uuid NOT NULL,
    role text NOT NULL,
    added_at timestamp with time zone NOT NULL,
    added_by uuid NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT training_group_member_pkey PRIMARY KEY (id),
    CONSTRAINT training_group_member_group_id_fkey FOREIGN KEY (group_id) REFERENCES training_group(id),
    CONSTRAINT training_group_member_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_account(id),
    CONSTRAINT training_group_member_key UNIQUE (group_id, account_id),
    CONSTRAINT training_group_member_request_key UNIQUE (request_id),
    CONSTRAINT training_group_member_role_check CHECK (role IN ('LEADER', 'MEMBER'))
);
CREATE INDEX IF NOT EXISTS training_group_member_account_idx ON training_group_member (account_id);

-- Upprepning (beslut 3): t.ex. varje tisdag 18:00 en termin. Tillfällena skapas i förväg och pekar hit; "Ångra" tar bort de
-- framtida som ingen anmält sig till eller läst ut på.
CREATE TABLE IF NOT EXISTS training_group_series (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    source_race_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time text NOT NULL,
    first_date date NOT NULL,
    last_date date NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    request_id uuid NOT NULL,
    undone_at timestamp with time zone,
    undone_by uuid,
    CONSTRAINT training_group_series_pkey PRIMARY KEY (id),
    CONSTRAINT training_group_series_group_id_fkey FOREIGN KEY (group_id) REFERENCES training_group(id),
    CONSTRAINT training_group_series_request_key UNIQUE (request_id),
    CONSTRAINT training_group_series_weekday_check CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT training_group_series_time_check CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT training_group_series_dates_check CHECK (last_date >= first_date AND last_date <= first_date + 400),
    CONSTRAINT training_group_series_undone_check CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);

-- Nya tillfällen (en träning eller en hel upprepning): svaret per requestId, så att samma begäran ger samma tillfällen.
CREATE TABLE IF NOT EXISTS training_group_request (
    request_id uuid NOT NULL,
    group_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    kind text NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT training_group_request_pkey PRIMARY KEY (request_id),
    CONSTRAINT training_group_request_group_id_fkey FOREIGN KEY (group_id) REFERENCES training_group(id),
    CONSTRAINT training_group_request_kind_check CHECK (kind IN ('SESSIONS'))
);

ALTER TABLE event ADD COLUMN IF NOT EXISTS training_group_id uuid REFERENCES training_group(id);
ALTER TABLE event ADD COLUMN IF NOT EXISTS training_group_series_id uuid REFERENCES training_group_series(id);
CREATE INDEX IF NOT EXISTS event_training_group_idx ON event (training_group_id);

-- Kartbiblioteket (beslut 4): kartbilden med georeferens (som race_map), kartfilen (som race_map_source) och banläggningen
-- (som course_setting) KOPIERAS in i gruppen och därifrån till en ny träning, i stället för att refereras. Då kan varken en
-- borttagen träning, en superadmin som tar bort ett evenemang eller en ändrad karta i biblioteket ändra eller ta bort det
-- som andra tillfällen redan använder (vägvalens publicerade bästa vägar är bundna till kartfilens sha256).
-- Rättigheterna: klubbens egen eller extern, ägare, avtalet som fri text och de valfria fälten.
CREATE TABLE IF NOT EXISTS training_group_map (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    name text NOT NULL,
    ownership text NOT NULL,
    owner_kind text,
    owner_name text,
    agreement text,
    valid_until date,
    contact text,
    training_only boolean NOT NULL DEFAULT false,
    fee_per_print boolean NOT NULL DEFAULT false,
    no_public_display boolean NOT NULL DEFAULT false,
    file_name text NOT NULL,
    media_type text NOT NULL,
    image bytea NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    tie_points jsonb,
    transform jsonb,
    source_race_id uuid,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT training_group_map_pkey PRIMARY KEY (id),
    CONSTRAINT training_group_map_group_id_fkey FOREIGN KEY (group_id) REFERENCES training_group(id),
    CONSTRAINT training_group_map_request_key UNIQUE (request_id),
    CONSTRAINT training_group_map_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT training_group_map_ownership_check CHECK (ownership IN ('CLUB', 'EXTERNAL')),
    CONSTRAINT training_group_map_owner_kind_check CHECK (owner_kind IS NULL OR owner_kind IN ('CLUB', 'MUNICIPALITY', 'MAPPER', 'OTHER')),
    CONSTRAINT training_group_map_texts_check CHECK ((owner_name IS NULL OR char_length(owner_name) BETWEEN 1 AND 200)
      AND (agreement IS NULL OR char_length(agreement) BETWEEN 1 AND 2000) AND (contact IS NULL OR char_length(contact) BETWEEN 1 AND 200)),
    CONSTRAINT training_group_map_media_type_check CHECK (media_type IN ('image/png', 'image/jpeg')),
    CONSTRAINT training_group_map_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT training_group_map_size_check CHECK (byte_length BETWEEN 1 AND 31457280 AND byte_length = octet_length(image)),
    CONSTRAINT training_group_map_georeference_check CHECK ((tie_points IS NULL) = (transform IS NULL))
);
CREATE INDEX IF NOT EXISTS training_group_map_group_idx ON training_group_map (group_id);

CREATE TABLE IF NOT EXISTS training_group_map_source (
    map_id uuid NOT NULL,
    file_name text NOT NULL,
    format text NOT NULL,
    version text NOT NULL,
    file bytea NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    scale integer NOT NULL,
    bounds jsonb NOT NULL,
    georeference jsonb,
    render jsonb NOT NULL,
    summary jsonb NOT NULL,
    CONSTRAINT training_group_map_source_pkey PRIMARY KEY (map_id),
    CONSTRAINT training_group_map_source_map_id_fkey FOREIGN KEY (map_id) REFERENCES training_group_map(id),
    CONSTRAINT training_group_map_source_size_check CHECK (byte_length BETWEEN 1 AND 62914560 AND byte_length = octet_length(file))
);

CREATE TABLE IF NOT EXISTS training_group_map_course_setting (
    map_id uuid NOT NULL,
    document jsonb NOT NULL,
    original_ppen text,
    original_file_name text,
    CONSTRAINT training_group_map_course_setting_pkey PRIMARY KEY (map_id),
    CONSTRAINT training_group_map_course_setting_map_id_fkey FOREIGN KEY (map_id) REFERENCES training_group_map(id),
    CONSTRAINT training_group_map_course_setting_document_check CHECK (jsonb_typeof(document) = 'object' AND document->>'version' = '1'),
    CONSTRAINT training_group_map_course_setting_original_check CHECK ((original_ppen IS NULL) = (original_file_name IS NULL))
);

-- Kartans avtal på tävlingen: en kopia av bibliotekets uppgifter när kartan valdes (eller när tävlingens karta sparades i
-- biblioteket). Ändras avtalet i biblioteket följer tävlingarna som använder kartan med (source_map_id, ingen nyckel så att
-- en borttagen biblioteksrad inte tar avtalet med sig). public_use_acknowledged_*: admin har medvetet valt att ändå visa
-- kartan publikt (vägvalskartan, GPS-rutterna, kartbilden) trots att avtalet gått ut eller inte tillåter det.
CREATE TABLE IF NOT EXISTS race_map_agreement (
    race_id uuid NOT NULL,
    source_map_id uuid,
    map_name text NOT NULL,
    ownership text NOT NULL,
    owner_kind text,
    owner_name text,
    agreement text,
    valid_until date,
    contact text,
    training_only boolean NOT NULL,
    fee_per_print boolean NOT NULL,
    no_public_display boolean NOT NULL,
    public_use_acknowledged_at timestamp with time zone,
    public_use_acknowledged_by uuid,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT race_map_agreement_pkey PRIMARY KEY (race_id),
    CONSTRAINT race_map_agreement_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT race_map_agreement_ownership_check CHECK (ownership IN ('CLUB', 'EXTERNAL')),
    CONSTRAINT race_map_agreement_acknowledged_check CHECK ((public_use_acknowledged_at IS NULL) = (public_use_acknowledged_by IS NULL))
);
CREATE INDEX IF NOT EXISTS race_map_agreement_source_idx ON race_map_agreement (source_map_id);
