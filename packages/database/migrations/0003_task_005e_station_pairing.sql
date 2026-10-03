CREATE TABLE "station_pairing_grant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "scope" station_credential_scope NOT NULL,
  "secret_hash" text NOT NULL CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "credential_expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at"),
  CHECK ("expires_at" <= "issued_at" + interval '15 minutes'),
  CHECK ("credential_expires_at" > "expires_at")
);
CREATE INDEX "station_pairing_grant_race_idx"
ON "station_pairing_grant"("race_id", "scope");

CREATE TABLE "station_pairing_grant_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grant_id" uuid NOT NULL REFERENCES "station_pairing_grant"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL
);
CREATE UNIQUE INDEX "station_pairing_grant_revocation_grant_uidx"
ON "station_pairing_grant_revocation"("grant_id");

CREATE TABLE "station_pairing_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grant_id" uuid NOT NULL REFERENCES "station_pairing_grant"("id"),
  "attempt_id" uuid,
  "device_id" uuid,
  "outcome" text NOT NULL CHECK ("outcome" IN (
    'AUTH_FAILED', 'BODY_INVALID', 'IDEMPOTENCY_KEY_INVALID',
    'CONFLICT', 'REDEEMED'
  )),
  "attempted_at" timestamptz NOT NULL
);
CREATE INDEX "station_pairing_attempt_grant_time_idx"
ON "station_pairing_attempt"("grant_id", "attempted_at");

CREATE TABLE "station_pairing_redemption" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "grant_id" uuid NOT NULL REFERENCES "station_pairing_grant"("id"),
  "attempt_id" uuid NOT NULL,
  "station_device_id" uuid NOT NULL REFERENCES "station_device"("id"),
  "credential_id" uuid NOT NULL REFERENCES "station_credential"("id"),
  "redeemed_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "station_pairing_redemption_grant_uidx"
ON "station_pairing_redemption"("grant_id");
CREATE UNIQUE INDEX "station_pairing_redemption_attempt_uidx"
ON "station_pairing_redemption"("attempt_id");
CREATE UNIQUE INDEX "station_pairing_redemption_credential_uidx"
ON "station_pairing_redemption"("credential_id");

CREATE TRIGGER station_pairing_grant_immutable
BEFORE UPDATE OR DELETE ON "station_pairing_grant"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER station_pairing_grant_revocation_immutable
BEFORE UPDATE OR DELETE ON "station_pairing_grant_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER station_pairing_attempt_immutable
BEFORE UPDATE OR DELETE ON "station_pairing_attempt"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER station_pairing_redemption_immutable
BEFORE UPDATE OR DELETE ON "station_pairing_redemption"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
