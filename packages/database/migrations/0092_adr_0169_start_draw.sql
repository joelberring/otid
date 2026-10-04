-- PLAN.md steg 9: lottning på riktigt. Flera klasser lottas på en gång med
-- startfållor, klubbseparering och vakanser. Den gamla enklassiga lottningen och
-- dess tilldelningsjournaler ersätts (ingen produktionsdata, ADR-0168 beslut 6).
DROP TABLE "entry_registration_start_slot_assignment";
DROP TABLE "entry_start_slot_assignment";
DROP TABLE "class_start_draw_item";
DROP TABLE "class_start_draw_request";

-- En sparad lottning: begäran, kvitto och slumpfröet (för revision, visas aldrig).
CREATE TABLE "start_draw_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL UNIQUE,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "actor_credential_id" uuid NOT NULL,
  "capability" pairing_admin_capability NOT NULL,
  "seed" bigint NOT NULL,
  "request" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "snapshot_version_before" integer NOT NULL,
  "snapshot_version_after" integer NOT NULL,
  "drawn_at" timestamptz NOT NULL,
  CONSTRAINT "start_draw_request_scope_uidx" UNIQUE ("id", "race_id"),
  CONSTRAINT "start_draw_request_actor_scope_fk" FOREIGN KEY ("actor_credential_id", "race_id", "capability")
    REFERENCES "pairing_admin_access_credential"("id", "race_id", "capability"),
  CONSTRAINT "start_draw_request_role_check" CHECK ("capability" = 'MANAGE_RACE'),
  CONSTRAINT "start_draw_request_seed_check" CHECK ("seed" BETWEEN 1 AND 4294967295),
  CONSTRAINT "start_draw_request_snapshot_check" CHECK ("snapshot_version_before" > 0 AND "snapshot_version_after" = "snapshot_version_before" + 1),
  CONSTRAINT "start_draw_request_json_check" CHECK (jsonb_typeof("request") = 'object' AND jsonb_typeof("response") = 'object')
);
CREATE INDEX "start_draw_request_race_time_idx" ON "start_draw_request"("race_id", "drawn_at");

-- Klassens plan i en lottning: startsätt, första start och intervall.
CREATE TABLE "start_draw_class" (
  "draw_id" uuid NOT NULL,
  "race_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "method" text NOT NULL,
  "first_start_time" timestamptz NOT NULL,
  "interval_seconds" integer NOT NULL,
  "vacancy_count" integer NOT NULL,
  PRIMARY KEY ("draw_id", "class_id"),
  CONSTRAINT "start_draw_class_draw_fk" FOREIGN KEY ("draw_id", "race_id") REFERENCES "start_draw_request"("id", "race_id"),
  CONSTRAINT "start_draw_class_class_fk" FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "start_draw_class_method_check" CHECK ("method" IN ('MINUTE', 'MASS')),
  CONSTRAINT "start_draw_class_interval_check" CHECK ("interval_seconds" BETWEEN 60 AND 3600 AND "interval_seconds" % 60 = 0),
  CONSTRAINT "start_draw_class_vacancy_check" CHECK ("vacancy_count" BETWEEN 0 AND 10000),
  CONSTRAINT "start_draw_class_minute_check" CHECK (date_trunc('minute', "first_start_time") = "first_start_time")
);

-- Lottade tider i startordning. entry_id NULL = vakant tid som efteranmälda får.
CREATE TABLE "start_draw_slot" (
  "draw_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "start_time" timestamptz NOT NULL,
  "entry_id" uuid REFERENCES "entry"("id"),
  PRIMARY KEY ("draw_id", "class_id", "position"),
  CONSTRAINT "start_draw_slot_class_fk" FOREIGN KEY ("draw_id", "class_id") REFERENCES "start_draw_class"("draw_id", "class_id"),
  CONSTRAINT "start_draw_slot_position_check" CHECK ("position" >= 0)
);

CREATE TRIGGER start_draw_request_immutable BEFORE UPDATE OR DELETE ON "start_draw_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER start_draw_class_immutable BEFORE UPDATE OR DELETE ON "start_draw_class"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER start_draw_slot_immutable BEFORE UPDATE OR DELETE ON "start_draw_slot"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Klassens gällande lottning. Töms när startsättet ändras i klasstabellen.
ALTER TABLE "class" ADD COLUMN "start_draw_id" uuid;
ALTER TABLE "class" ADD CONSTRAINT "class_start_draw_fk"
  FOREIGN KEY ("start_draw_id", "id") REFERENCES "start_draw_class"("draw_id", "class_id");
ALTER TABLE "class" ADD CONSTRAINT "class_start_draw_rule_check" CHECK ("start_draw_id" IS NULL OR "start_rule" = 'FIXED');

-- Starttiden som appen gav en efteranmäld i en lottad klass (NULL = ingen eller angiven av admin).
ALTER TABLE "entry_registration_request" ADD COLUMN "assigned_start_time" timestamptz;
