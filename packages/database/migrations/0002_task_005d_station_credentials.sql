CREATE TYPE "station_credential_scope" AS ENUM ('READOUT');

CREATE TABLE "station_device" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "station_device_external_uidx" ON "station_device"("device_id");

CREATE TABLE "station_credential" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "station_device_id" uuid NOT NULL REFERENCES "station_device"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "scope" station_credential_scope NOT NULL,
  "generation" integer NOT NULL CHECK ("generation" > 0),
  "secret_hash" text NOT NULL CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at")
);
CREATE UNIQUE INDEX "station_credential_generation_uidx"
ON "station_credential"("station_device_id", "race_id", "scope", "generation");
CREATE INDEX "station_credential_race_idx" ON "station_credential"("race_id", "scope");

CREATE TABLE "station_credential_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credential_id" uuid NOT NULL REFERENCES "station_credential"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL
);
CREATE UNIQUE INDEX "station_credential_revocation_credential_uidx"
ON "station_credential_revocation"("credential_id");

CREATE TRIGGER station_credential_immutable
BEFORE UPDATE OR DELETE ON "station_credential"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER station_credential_revocation_immutable
BEFORE UPDATE OR DELETE ON "station_credential_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER audit_event_immutable
BEFORE UPDATE OR DELETE ON "audit_event"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
