-- ADR-0169 beslut 3 / PLAN.md steg 11: stafett. En stafettklass är en vanlig klass
-- med sträckor (relay_leg): antal sträckor och startsätt per sträcka. Ett lag (team)
-- har nummer, namn och klubb. Varje sträcklöpare är en vanlig deltagare (entry) med
-- lag och sträcka, så att bricka, avläsning, resultatrevisioner, underlag och variant
-- fungerar som för individuella löpare. Sträckans starttid räknas av appen ur
-- föregående sträckas måltid och sparas som deltagarens fasta starttid.

-- Startsätt per sträcka: MASS_START (alla startar på start_time), CHANGEOVER (växling:
-- start = föregående sträckas måltid) och RESTART (växling, men lag som inte växlat
-- före start_time startar då). Sträcka 1 är alltid masstart. Valfri variant per sträcka
-- (gafflad bana); NULL = lagen fördelas över banans varianter.
CREATE TABLE "relay_leg" (
  "class_id" uuid NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "leg" integer NOT NULL,
  "start_method" text NOT NULL,
  "start_time" timestamptz,
  "course_variant_code" text,
  CONSTRAINT "relay_leg_pk" PRIMARY KEY ("class_id", "leg"),
  CONSTRAINT "relay_leg_class_fk" FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "relay_leg_number_check" CHECK ("leg" BETWEEN 1 AND 20),
  CONSTRAINT "relay_leg_method_check" CHECK ("start_method" IN ('MASS_START', 'CHANGEOVER', 'RESTART')),
  CONSTRAINT "relay_leg_time_check" CHECK (("start_method" = 'CHANGEOVER') = ("start_time" IS NULL)),
  CONSTRAINT "relay_leg_first_check" CHECK ("leg" <> 1 OR "start_method" = 'MASS_START'),
  CONSTRAINT "relay_leg_variant_check" CHECK ("course_variant_code" IS NULL OR
    (char_length("course_variant_code") BETWEEN 1 AND 32 AND "course_variant_code" = btrim("course_variant_code")))
);
CREATE INDEX "relay_leg_race_idx" ON "relay_leg"("race_id");

CREATE TABLE "team" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "class_id" uuid NOT NULL,
  "number" integer NOT NULL,
  "name" text NOT NULL,
  "organisation_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "team_class_fk" FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "team_race_number_uidx" UNIQUE ("race_id", "number"),
  CONSTRAINT "team_id_class_uidx" UNIQUE ("id", "class_id"),
  CONSTRAINT "team_number_check" CHECK ("number" BETWEEN 1 AND 99999),
  CONSTRAINT "team_name_check" CHECK (char_length("name") BETWEEN 1 AND 160 AND "name" = btrim("name")),
  CONSTRAINT "team_organisation_check" CHECK ("organisation_name" IS NULL OR
    (char_length("organisation_name") BETWEEN 1 AND 200 AND "organisation_name" = btrim("organisation_name")))
);
CREATE INDEX "team_class_idx" ON "team"("class_id");

-- Sträcklöparen: lag och sträcka. Laget och deltagaren har samma klass (sammansatt främmande nyckel).
ALTER TABLE "entry" ADD COLUMN "team_id" uuid;
ALTER TABLE "entry" ADD COLUMN "relay_leg" integer;
ALTER TABLE "entry" ADD CONSTRAINT "entry_team_fk" FOREIGN KEY ("team_id", "class_id") REFERENCES "team"("id", "class_id");
ALTER TABLE "entry" ADD CONSTRAINT "entry_relay_leg_check"
  CHECK (("team_id" IS NULL) = ("relay_leg" IS NULL) AND ("relay_leg" IS NULL OR "relay_leg" BETWEEN 1 AND 20));
CREATE UNIQUE INDEX "entry_team_leg_uidx" ON "entry"("team_id", "relay_leg") WHERE "team_id" IS NOT NULL;

-- Journal för stafettens administration: ny stafettklass (CLASS), nytt lag (TEAM), byte av
-- sträcklöpare (LEG_RUNNER) och start-/omstartstider (START_TIMES). Samma request-id ger samma kvitto.
CREATE TABLE "relay_request" (
  "request_id" uuid PRIMARY KEY,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "kind" text NOT NULL,
  "class_id" uuid NOT NULL,
  "team_id" uuid,
  "actor_credential_id" uuid NOT NULL,
  "capability" pairing_admin_capability NOT NULL,
  "request" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "relay_request_class_fk" FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "relay_request_team_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id"),
  CONSTRAINT "relay_request_actor_scope_fk" FOREIGN KEY ("actor_credential_id", "race_id", "capability")
    REFERENCES "pairing_admin_access_credential"("id", "race_id", "capability"),
  CONSTRAINT "relay_request_role_check" CHECK ("capability" = 'MANAGE_RACE'),
  CONSTRAINT "relay_request_kind_check" CHECK (
    ("kind" IN ('CLASS', 'START_TIMES') AND "team_id" IS NULL) OR
    ("kind" IN ('TEAM', 'LEG_RUNNER') AND "team_id" IS NOT NULL)),
  CONSTRAINT "relay_request_json_check" CHECK (jsonb_typeof("request") = 'object' AND jsonb_typeof("response") = 'object')
);
CREATE TRIGGER relay_request_immutable BEFORE UPDATE OR DELETE ON "relay_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
