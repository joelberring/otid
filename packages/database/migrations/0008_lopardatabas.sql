-- Steg 29 (PLAN.md): löpardatabas från Eventor. En databas per Eventor-organisation (klubben som nyckeln tillhör), inte
-- per tävling: alla tävlingar som är kopplade till klubben med en sparad nyckel använder samma. Uppdateras från Eventor
-- (allt ersätts i en transaktion) och kan raderas. Dataminimering: födelseår i stället för födelsedatum, bara
-- SPORTident-brickor, ingen nationalitet eller adress. Externa id:n är aldrig primärnycklar.
CREATE TABLE runner_database (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eventor_organisation_id text NOT NULL,
  organisation_name text NOT NULL,
  -- Klubbar som administratören lagt till utöver den egna, och om hela landets löpare är hämtade.
  extra_organisation_ids text[] NOT NULL DEFAULT '{}',
  whole_country boolean NOT NULL DEFAULT false,
  competitor_count integer NOT NULL,
  card_count integer NOT NULL,
  club_count integer NOT NULL,
  refreshed_at timestamp with time zone NOT NULL,
  CONSTRAINT runner_database_organisation_check CHECK (eventor_organisation_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  CONSTRAINT runner_database_name_check CHECK (char_length(organisation_name) BETWEEN 1 AND 160),
  CONSTRAINT runner_database_extra_check CHECK (cardinality(extra_organisation_ids) <= 49),
  CONSTRAINT runner_database_counts_check CHECK (competitor_count >= 0 AND card_count >= 0 AND club_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX runner_database_organisation_uidx ON runner_database (eventor_organisation_id);
--> statement-breakpoint
CREATE TABLE runner_database_competitor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_database_id uuid NOT NULL REFERENCES runner_database(id) ON DELETE CASCADE,
  eventor_person_id text,
  given_name text NOT NULL,
  family_name text NOT NULL,
  birth_year smallint,
  sex text,
  club_eventor_id text,
  club_name text,
  club_short_name text,
  card_numbers text[] NOT NULL DEFAULT '{}',
  CONSTRAINT runner_database_competitor_person_check CHECK (eventor_person_id IS NULL OR eventor_person_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  CONSTRAINT runner_database_competitor_name_check CHECK (
    char_length(given_name) BETWEEN 1 AND 160 AND char_length(family_name) BETWEEN 1 AND 160),
  CONSTRAINT runner_database_competitor_birth_year_check CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  CONSTRAINT runner_database_competitor_sex_check CHECK (sex IS NULL OR sex IN ('F', 'M')),
  CONSTRAINT runner_database_competitor_club_check CHECK (
    (club_eventor_id IS NULL OR club_eventor_id ~ '^[0-9A-Za-z_-]{1,64}$') AND
    (club_name IS NULL OR char_length(club_name) BETWEEN 1 AND 160) AND
    (club_short_name IS NULL OR char_length(club_short_name) BETWEEN 1 AND 160)),
  CONSTRAINT runner_database_competitor_cards_check CHECK (cardinality(card_numbers) <= 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX runner_database_competitor_person_uidx ON runner_database_competitor (runner_database_id, eventor_person_id);
--> statement-breakpoint
CREATE INDEX runner_database_competitor_cards_idx ON runner_database_competitor USING gin (card_numbers);
--> statement-breakpoint
CREATE INDEX runner_database_competitor_family_idx ON runner_database_competitor (runner_database_id, lower(family_name) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX runner_database_competitor_given_idx ON runner_database_competitor (runner_database_id, lower(given_name) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX runner_database_competitor_club_idx ON runner_database_competitor (runner_database_id, club_eventor_id);
--> statement-breakpoint
-- Organisationerna i Eventor (förbund, distrikt, klubbar) för klubbfältets förslag. Typen är Eventors äldre
-- OrganisationTypeId tolkad av adaptern (inte provad mot riktiga Eventor), därför behålls alla typer.
CREATE TABLE runner_database_club (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_database_id uuid NOT NULL REFERENCES runner_database(id) ON DELETE CASCADE,
  eventor_id text NOT NULL,
  name text NOT NULL,
  short_name text,
  type text NOT NULL,
  CONSTRAINT runner_database_club_id_check CHECK (eventor_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  CONSTRAINT runner_database_club_name_check CHECK (
    char_length(name) BETWEEN 1 AND 160 AND (short_name IS NULL OR char_length(short_name) BETWEEN 1 AND 160)),
  CONSTRAINT runner_database_club_type_check CHECK (type IN ('FEDERATION', 'DISTRICT', 'CLUB', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX runner_database_club_uidx ON runner_database_club (runner_database_id, eventor_id);
--> statement-breakpoint
CREATE INDEX runner_database_club_name_idx ON runner_database_club (runner_database_id, lower(name) text_pattern_ops);
--> statement-breakpoint
-- Avläsningssidan kan koppla en okänd bricka till en anmäld deltagare utan bricka eller utan avläsning (LINKED).
ALTER TABLE readout_registration DROP CONSTRAINT readout_registration_outcome_check;
--> statement-breakpoint
ALTER TABLE readout_registration ADD CONSTRAINT readout_registration_outcome_check CHECK (outcome IN ('CREATED', 'EXISTING', 'LINKED'));
