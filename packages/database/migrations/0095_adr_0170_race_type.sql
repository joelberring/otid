-- ADR-0170 beslut 1 / PLAN.md steg 12: tävlingstyp. Typen styr vilka delar av arbetsytan som
-- syns och vilka förval som gäller. Den är en vy, inte en egen kodväg: att byta typ tar aldrig
-- bort data. Befintliga lopp blir STANDARD (Tävling).
ALTER TABLE "race" ADD COLUMN "race_type" text NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "race" ADD CONSTRAINT "race_type_check"
  CHECK ("race_type" IN ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING'));

-- Skapandejournalen jämför typen vid omsändning med samma request-id.
ALTER TABLE "user_account_event_creation_request" ADD COLUMN "race_type" text NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "user_account_event_creation_request" ADD CONSTRAINT "user_account_event_creation_race_type_check"
  CHECK ("race_type" IN ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING'));

-- Inställningar (namn, datum, typ): idempotent journal med request-id, som övriga ändringar i arbetsytan.
CREATE TABLE "race_settings_request" (
  "request_id" uuid PRIMARY KEY,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "actor_credential_id" uuid NOT NULL,
  "capability" "pairing_admin_capability" NOT NULL,
  "request" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL
);
CREATE INDEX "race_settings_request_race_idx" ON "race_settings_request"("race_id");
