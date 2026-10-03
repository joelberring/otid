CREATE TABLE "device_ingest_outcome" (
  "raw_message_id" uuid PRIMARY KEY REFERENCES "raw_device_message"("id"),
  "server_result" jsonb NOT NULL,
  "evaluation_hash" text NOT NULL CHECK ("evaluation_hash" ~ '^[a-f0-9]{64}$'),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER device_ingest_outcome_immutable
BEFORE UPDATE OR DELETE ON "device_ingest_outcome"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
