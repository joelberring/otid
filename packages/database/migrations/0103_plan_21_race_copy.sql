-- PLAN.md steg 21: "Ny tävling som …". Kopian skapas i en transaktion i applikationslagret (nya rader för banor,
-- versioner, kontroller, klasser m.m.); här finns bara journalen som gör begäran idempotent (samma request-id ger
-- samma kopia) och visar varifrån tävlingen kopierades. Journalen ändras aldrig.
CREATE TABLE "race_copy_request" (
  "request_id" uuid PRIMARY KEY,
  "actor_account_id" uuid NOT NULL REFERENCES "user_account"("id"),
  "source_race_id" uuid NOT NULL REFERENCES "race"("id"),
  "event_id" uuid NOT NULL REFERENCES "event"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "request" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "race_copy_request_distinct_check" CHECK ("source_race_id" <> "race_id"),
  CONSTRAINT "race_copy_request_race_event_fk" FOREIGN KEY ("race_id", "event_id") REFERENCES "race"("id", "event_id")
);
CREATE UNIQUE INDEX "race_copy_request_race_uidx" ON "race_copy_request"("race_id");
CREATE INDEX "race_copy_request_source_idx" ON "race_copy_request"("source_race_id", "created_at");
CREATE TRIGGER "race_copy_request_immutable"
  BEFORE UPDATE OR DELETE ON "race_copy_request"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
