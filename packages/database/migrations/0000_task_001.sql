CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "start_rule" AS ENUM ('FIXED', 'PUNCH');
CREATE TYPE "import_kind" AS ENUM ('CourseData', 'EntryList');
CREATE TYPE "revision_cause" AS ENUM ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION');

CREATE TABLE "event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "starts_on" date NOT NULL,
  "time_zone" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "race" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "event"("id"),
  "name" text NOT NULL,
  "race_date" date NOT NULL,
  "snapshot_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "race_event_idx" ON "race"("event_id");

CREATE TABLE "course" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "name" text NOT NULL,
  "external_source" text,
  "external_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "course_external_uidx" ON "course"("race_id", "external_source", "external_id");
CREATE TABLE "course_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL REFERENCES "course"("id"),
  "version" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("course_id", "version")
);
CREATE TABLE "control" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "code" integer NOT NULL,
  "kind" text NOT NULL DEFAULT 'CONTROL',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("race_id", "code")
);
CREATE TABLE "course_control" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "control_id" uuid NOT NULL REFERENCES "control"("id"),
  "sequence" integer NOT NULL,
  UNIQUE ("course_version_id", "sequence")
);
CREATE TABLE "class" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "name" text NOT NULL,
  "course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "start_rule" start_rule NOT NULL DEFAULT 'FIXED',
  "external_source" text,
  "external_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "class_external_uidx" ON "class"("race_id", "external_source", "external_id");
CREATE TABLE "entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "class_id" uuid NOT NULL REFERENCES "class"("id"),
  "given_name" text NOT NULL,
  "family_name" text NOT NULL,
  "organisation_name" text,
  "fixed_start_time" timestamptz,
  "external_source" text,
  "external_id" text,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "entry_external_uidx" ON "entry"("race_id", "external_source", "external_id");
CREATE INDEX "entry_class_idx" ON "entry"("class_id");
CREATE TABLE "card_assignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "card_number" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("race_id", "card_number")
);
CREATE TABLE "import_file" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "kind" import_kind NOT NULL,
  "content_hash" text NOT NULL,
  "original_xml" text NOT NULL,
  "report" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("race_id", "kind", "content_hash")
);
CREATE TABLE "raw_device_message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "device_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "local_sequence" integer NOT NULL CHECK ("local_sequence" > 0),
  "package_version" integer NOT NULL,
  "station_received_at" timestamptz NOT NULL,
  "server_received_at" timestamptz NOT NULL DEFAULT now(),
  "transport" text NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "content_hash" text NOT NULL CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  "parser_status" text NOT NULL DEFAULT 'normalized',
  UNIQUE ("device_id", "local_sequence")
);
CREATE TABLE "card_readout" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "raw_message_id" uuid NOT NULL UNIQUE REFERENCES "raw_device_message"("id"),
  "card_number" text NOT NULL,
  "start_punched_at" timestamptz,
  "finish_punched_at" timestamptz NOT NULL,
  "punches" jsonb NOT NULL,
  "read_at" timestamptz NOT NULL
);
CREATE TABLE "result_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "readout_id" uuid NOT NULL REFERENCES "card_readout"("id"),
  "revision" integer NOT NULL,
  "cause" revision_cause NOT NULL,
  "status" text NOT NULL,
  "reason" text NOT NULL,
  "evaluation" jsonb NOT NULL,
  "engine_version" text NOT NULL,
  "snapshot_version" integer NOT NULL,
  "course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "published" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("entry_id", "revision")
);
CREATE INDEX "result_revision_public_idx" ON "result_revision"("race_id", "published");
CREATE TABLE "audit_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER raw_device_message_immutable BEFORE UPDATE OR DELETE ON "raw_device_message"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER result_revision_immutable BEFORE UPDATE OR DELETE ON "result_revision"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER course_version_immutable BEFORE UPDATE OR DELETE ON "course_version"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
