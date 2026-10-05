-- ADR-0170 beslut 4 / PLAN.md steg 14: Eventor och banfiler, även uppdateringar.
-- Den gamla CLI-styrda Eventor-kopplingen (TASK 006V/098/101: anslutning per skapandecredential,
-- grant till IMPORT_IOF-credential) ersätts av en koppling per tävling som administratören
-- sköter i Inställningar. Ingen produktionsdata finns (ADR-0168 beslut 6).
DROP TABLE "eventor_entry_import_request";
DROP TABLE "eventor_race_import_grant_revocation";
DROP TABLE "eventor_race_import_grant";
DROP TABLE "eventor_import_request";
DROP TABLE "eventor_connection_revocation";
DROP TABLE "eventor_connection";

-- Tävlingens Eventor-koppling: klubbens API-nyckel (AES-256-GCM, masternyckeln finns bara i
-- serverns miljö), klubben som nyckeln tillhör och vald tävling i Eventor. Eventors id är
-- extern identitet, aldrig primärnyckel.
CREATE TABLE "race_eventor_link" (
  "race_id" uuid PRIMARY KEY REFERENCES "race"("id"),
  "key_id" text,
  "iv" text,
  "tag" text,
  "ciphertext" text,
  "organisation_id" text,
  "organisation_name" text,
  "event_id" text,
  "event_name" text,
  "event_date" date,
  "event_form" text,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "race_eventor_link_envelope_check" CHECK (
    ("key_id" IS NULL AND "iv" IS NULL AND "tag" IS NULL AND "ciphertext" IS NULL) OR
    ("key_id" ~ '^[a-z0-9-]{1,64}$' AND "iv" ~ '^[A-Za-z0-9_-]{16}$' AND "tag" ~ '^[A-Za-z0-9_-]{22}$'
      AND "ciphertext" ~ '^[A-Za-z0-9_-]{22,172}$')),
  CONSTRAINT "race_eventor_link_organisation_check" CHECK (("organisation_id" IS NULL) = ("organisation_name" IS NULL)),
  CONSTRAINT "race_eventor_link_event_check" CHECK (("event_id" IS NULL) = ("event_name" IS NULL) AND
    ("event_id" IS NULL) = ("event_date" IS NULL) AND ("event_id" IS NULL) = ("event_form" IS NULL) AND
    ("event_form" IS NULL OR "event_form" IN ('INDIVIDUAL', 'RELAY', 'OTHER')))
);

-- En läsning av en källa (Eventor eller banfil) som visas som skillnader och godkänns.
-- Projektionen är källans innehåll i O-Tids modell; banfilens XML sparas som den lästes in.
-- När skillnaderna godkänns sätts applied_* (idempotent med request-id).
CREATE TABLE "source_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "source" text NOT NULL,
  "content_hash" text NOT NULL,
  "projection" jsonb NOT NULL,
  "original_xml" text,
  "file_name" text,
  "fetched_at" timestamptz NOT NULL,
  "applied_request_id" uuid,
  "applied_at" timestamptz,
  "actor_credential_id" uuid,
  "apply_request" jsonb,
  "apply_response" jsonb,
  CONSTRAINT "source_snapshot_source_check" CHECK ("source" IN ('EVENTOR', 'COURSE_FILE')),
  CONSTRAINT "source_snapshot_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "source_snapshot_applied_check" CHECK (
    ("applied_request_id" IS NULL) = ("applied_at" IS NULL) AND ("applied_at" IS NULL) = ("apply_response" IS NULL) AND
    ("applied_at" IS NULL) = ("apply_request" IS NULL) AND ("applied_at" IS NULL) = ("actor_credential_id" IS NULL)),
  CONSTRAINT "source_snapshot_file_check" CHECK (("source" = 'COURSE_FILE') = ("original_xml" IS NOT NULL))
);
CREATE UNIQUE INDEX "source_snapshot_applied_request_uidx" ON "source_snapshot"("applied_request_id");
CREATE INDEX "source_snapshot_race_source_idx" ON "source_snapshot"("race_id", "source", "fetched_at");

-- Stafettlag från Eventor: lagets anmälnings-id är extern identitet.
ALTER TABLE "team" ADD COLUMN "external_source" text;
ALTER TABLE "team" ADD COLUMN "external_id" text;
CREATE UNIQUE INDEX "team_external_uidx" ON "team"("race_id", "external_source", "external_id");
