-- PLAN.md steg 22: stämplingstiderna löses mot avläsningsstationens klocka (GET_TIME vid handskakningen) i stället
-- för datorns. Avläsningen bär vilken klocka som användes och stationens avvikelse från datorn, så att en
-- felställd station syns i efterhand. Råmeddelandet (raw_device_message.raw_payload) är oförändrat.
ALTER TABLE "card_readout" ADD COLUMN "clock_source" text;
ALTER TABLE "card_readout" ADD COLUMN "clock_offset_ms" integer;
ALTER TABLE "card_readout" ADD CONSTRAINT "card_readout_clock_source_check"
  CHECK ("clock_source" IS NULL OR "clock_source" IN ('station', 'device'));

-- Dubbla klass- och bannamn i samma tävling avvisas (PLAN.md steg 22). Jämförelsen bortser från skiftläge.
-- Tjänsterna kontrollerar före skrivning och svarar "finns redan"; indexet är den sista spärren.
CREATE UNIQUE INDEX "class_race_name_uidx" ON "class" ("race_id", lower("name"));
CREATE UNIQUE INDEX "course_race_name_uidx" ON "course" ("race_id", lower("name"));
