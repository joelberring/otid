-- ADR-0172 beslut 5 / PLAN.md steg 20: radiokontroller via ROC eller OResults.
-- Kopplingen och valet av radiokontroller är inställningar (ändras). Radiostämplingarna är råa och
-- oföränderliga, skilda från avläsningarna. Matchningen mot löpare sker vid läsning (bricka kan ändras).

-- Tävlingens koppling: källa och enhetens id hos tjänsten (extern identitet, aldrig primärnyckel), lastId
-- (högsta stämplings-id som sparats) och senaste hämtningens läge. Bytt källa eller enhet nollställer lastId.
CREATE TABLE "race_radio_link" (
  "race_id" uuid PRIMARY KEY REFERENCES "race"("id"),
  "source" text NOT NULL,
  "unit_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_punch_id" bigint NOT NULL DEFAULT 0,
  "last_attempt_at" timestamptz,
  "last_success_at" timestamptz,
  "last_error" text,
  "last_error_at" timestamptz,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "malformed_lines" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "race_radio_link_source_check" CHECK ("source" IN ('ROC', 'ORESULTS')),
  CONSTRAINT "race_radio_link_unit_check" CHECK ("unit_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "race_radio_link_counts_check" CHECK ("last_punch_id" >= 0 AND "consecutive_failures" >= 0 AND "malformed_lines" >= 0),
  CONSTRAINT "race_radio_link_error_check" CHECK (("last_error" IS NULL) = ("last_error_at" IS NULL) AND ("last_error" IS NULL OR
    "last_error" IN ('INVALID_INPUT', 'INVALID_RESPONSE', 'UPSTREAM_UNAVAILABLE', 'REJECTED', 'NOT_FOUND', 'RESPONSE_TOO_LARGE', 'TIMEOUT')))
);

-- Kontrollerna som är radiokontroller, med ett valfritt namn ("Radio 1", "Förvarning").
CREATE TABLE "race_radio_control" (
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "control_code" integer NOT NULL,
  "label" text,
  PRIMARY KEY ("race_id", "control_code"),
  CONSTRAINT "race_radio_control_code_check" CHECK ("control_code" BETWEEN 1 AND 9999),
  CONSTRAINT "race_radio_control_label_check" CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 40)
);

-- Radiostämplingarna som de kom. Idempotent på (tävling, källa, enhet, stämplings-id) och på samma
-- stämpling (bricka, kontroll, tid) med ett annat id. Raden från tjänsten sparas oförändrad.
CREATE TABLE "radio_punch" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "source" text NOT NULL,
  "unit_id" text NOT NULL,
  "punch_id" bigint NOT NULL,
  "control_code" integer NOT NULL,
  "card_number" text NOT NULL,
  "punched_at" timestamptz NOT NULL,
  "local_time" text NOT NULL,
  "raw_line" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  CONSTRAINT "radio_punch_source_check" CHECK ("source" IN ('ROC', 'ORESULTS')),
  CONSTRAINT "radio_punch_values_check" CHECK ("punch_id" > 0 AND "control_code" BETWEEN 1 AND 9999 AND
    "card_number" ~ '^[1-9][0-9]{0,7}$' AND "local_time" ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' AND char_length("raw_line") <= 1000)
);
CREATE UNIQUE INDEX "radio_punch_source_uidx" ON "radio_punch"("race_id", "source", "unit_id", "punch_id");
CREATE UNIQUE INDEX "radio_punch_content_uidx" ON "radio_punch"("race_id", "card_number", "control_code", "punched_at");
CREATE INDEX "radio_punch_race_time_idx" ON "radio_punch"("race_id", "punched_at");
CREATE TRIGGER "radio_punch_immutable"
  BEFORE UPDATE OR DELETE ON "radio_punch"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Nya radiostämplingar väcker de publika listorna och speakern (samma tekniska markör som för resultat,
-- utan innehåll). En markör per tävling och insättning.
CREATE FUNCTION record_radio_punch_update_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_race uuid;
  recorded_sequence bigint;
BEGIN
  FOR changed_race IN SELECT DISTINCT race_id FROM new_radio_punches LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(changed_race::text, 0));
    INSERT INTO public_result_update_event(race_id) VALUES (changed_race) RETURNING event_sequence INTO recorded_sequence;
    DELETE FROM public_result_update_event
    WHERE race_id = changed_race
      AND event_sequence < (
        SELECT event_sequence FROM public_result_update_event
        WHERE race_id = changed_race ORDER BY event_sequence DESC OFFSET 999 LIMIT 1
      );
    PERFORM pg_notify('otid_public_result_update', changed_race::text || ':' || recorded_sequence::text);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "radio_punch_public_update_event"
  AFTER INSERT ON "radio_punch"
  REFERENCING NEW TABLE AS new_radio_punches
  FOR EACH STATEMENT EXECUTE FUNCTION record_radio_punch_update_event();
