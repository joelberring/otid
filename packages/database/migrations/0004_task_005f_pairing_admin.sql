CREATE TYPE "pairing_admin_capability" AS ENUM ('PAIR_STATION');
CREATE TYPE "audit_actor_kind" AS ENUM ('PAIRING_ADMIN_ACCESS_CREDENTIAL');

CREATE TABLE "pairing_admin_access_credential" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "capability" pairing_admin_capability NOT NULL,
  "label" text NOT NULL CHECK (length(btrim("label")) BETWEEN 1 AND 120),
  "secret_hash" text NOT NULL CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at"),
  CHECK ("expires_at" <= "issued_at" + interval '24 hours')
);
CREATE INDEX "pairing_admin_access_credential_race_idx"
ON "pairing_admin_access_credential"("race_id", "capability");

CREATE TABLE "pairing_admin_access_credential_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL
);
CREATE UNIQUE INDEX "pairing_admin_access_credential_revocation_uidx"
ON "pairing_admin_access_credential_revocation"("credential_id");

CREATE TABLE "pairing_admin_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "access_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "session_secret_hash" text NOT NULL CHECK ("session_secret_hash" ~ '^[a-f0-9]{64}$'),
  "csrf_secret_hash" text NOT NULL CHECK ("csrf_secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at"),
  CHECK ("expires_at" <= "issued_at" + interval '8 hours')
);
CREATE INDEX "pairing_admin_session_credential_idx"
ON "pairing_admin_session"("access_credential_id");

CREATE TABLE "pairing_admin_session_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "pairing_admin_session"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL
);
CREATE UNIQUE INDEX "pairing_admin_session_revocation_uidx"
ON "pairing_admin_session_revocation"("session_id");

ALTER TABLE "station_pairing_grant"
ADD COLUMN "issuer_credential_id" uuid REFERENCES "pairing_admin_access_credential"("id");
ALTER TABLE "audit_event"
ADD COLUMN "actor_kind" audit_actor_kind,
ADD COLUMN "actor_id" uuid,
ADD COLUMN "request_id" uuid,
ADD CONSTRAINT "audit_event_actor_pair_check"
CHECK (("actor_kind" IS NULL) = ("actor_id" IS NULL));

CREATE TRIGGER pairing_admin_access_credential_immutable
BEFORE UPDATE OR DELETE ON "pairing_admin_access_credential"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER pairing_admin_access_credential_revocation_immutable
BEFORE UPDATE OR DELETE ON "pairing_admin_access_credential_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER pairing_admin_session_immutable
BEFORE UPDATE OR DELETE ON "pairing_admin_session"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER pairing_admin_session_revocation_immutable
BEFORE UPDATE OR DELETE ON "pairing_admin_session_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
