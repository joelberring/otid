ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'EVENT_CREATION_ACCESS_CREDENTIAL';

-- The composite key lets the immutable request journal prove that its created
-- race belongs to its created event with an ordinary PostgreSQL foreign key.
CREATE UNIQUE INDEX "race_id_event_uidx" ON "race"("id", "event_id");

CREATE TABLE "event_creation_access_credential" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL CHECK (length(btrim("label")) BETWEEN 1 AND 120),
  "secret_hash" text NOT NULL CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at"),
  CHECK ("expires_at" <= "issued_at" + interval '8 hours')
);

CREATE TABLE "event_creation_access_credential_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credential_id" uuid NOT NULL REFERENCES "event_creation_access_credential"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX "event_creation_access_credential_revocation_uidx"
ON "event_creation_access_credential_revocation"("credential_id");

CREATE TABLE "event_creation_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "access_credential_id" uuid NOT NULL REFERENCES "event_creation_access_credential"("id"),
  "session_secret_hash" text NOT NULL CHECK ("session_secret_hash" ~ '^[a-f0-9]{64}$'),
  "csrf_secret_hash" text NOT NULL CHECK ("csrf_secret_hash" ~ '^[a-f0-9]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CHECK ("expires_at" > "issued_at"),
  CHECK ("expires_at" <= "issued_at" + interval '1 hour')
);
CREATE INDEX "event_creation_session_credential_idx"
ON "event_creation_session"("access_credential_id");

CREATE TABLE "event_creation_session_revocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "event_creation_session"("id"),
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX "event_creation_session_revocation_uidx"
ON "event_creation_session_revocation"("session_id");

CREATE TABLE "event_creation_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "actor_credential_id" uuid NOT NULL REFERENCES "event_creation_access_credential"("id"),
  "event_name" text NOT NULL CHECK (length(btrim("event_name")) BETWEEN 2 AND 160),
  "race_name" text NOT NULL CHECK (length(btrim("race_name")) BETWEEN 2 AND 160),
  "race_date" date NOT NULL,
  "time_zone" text NOT NULL CHECK (length(btrim("time_zone")) BETWEEN 1 AND 100),
  "event_id" uuid NOT NULL REFERENCES "event"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_creation_request_race_event_fk"
    FOREIGN KEY ("race_id", "event_id") REFERENCES "race"("id", "event_id")
);
CREATE UNIQUE INDEX "event_creation_request_request_uidx" ON "event_creation_request"("request_id");
CREATE UNIQUE INDEX "event_creation_request_event_uidx" ON "event_creation_request"("event_id");
CREATE UNIQUE INDEX "event_creation_request_race_uidx" ON "event_creation_request"("race_id");
CREATE INDEX "event_creation_request_actor_time_idx"
ON "event_creation_request"("actor_credential_id", "created_at");

CREATE TRIGGER event_creation_access_credential_immutable
BEFORE UPDATE OR DELETE ON "event_creation_access_credential"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_creation_access_credential_revocation_immutable
BEFORE UPDATE OR DELETE ON "event_creation_access_credential_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_creation_session_immutable
BEFORE UPDATE OR DELETE ON "event_creation_session"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_creation_session_revocation_immutable
BEFORE UPDATE OR DELETE ON "event_creation_session_revocation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_creation_request_immutable
BEFORE UPDATE OR DELETE ON "event_creation_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
