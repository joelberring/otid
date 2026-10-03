ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'FINALIZE_RESULTS';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'RESULT_FINALIZATION_ACCESS_CREDENTIAL';
CREATE TYPE "result_finalization_scope" AS ENUM ('CLASS', 'RACE');

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_result_finalization_lifetime_check"
CHECK (
  "capability"::text <> 'FINALIZE_RESULTS'
  OR "expires_at" <= "issued_at" + interval '8 hours'
) NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_result_finalization_lifetime_check";

-- This additively lets PostgreSQL prove that a class finalization belongs to
-- its race without changing or rewriting an existing class row.
CREATE UNIQUE INDEX "class_id_race_uidx" ON "class"("id", "race_id");

CREATE TABLE "result_finalization" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "scope" "result_finalization_scope" NOT NULL,
  "class_id" uuid,
  "scope_revision" integer NOT NULL,
  "source_snapshot_version" integer NOT NULL,
  "source_hash" text NOT NULL,
  "frozen_projection" jsonb NOT NULL,
  "complete_xml" text,
  "complete_xml_hash" text,
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "finalized_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "result_finalization_class_race_fk"
    FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "result_finalization_scope_revision_check"
    CHECK ("scope_revision" > 0),
  CONSTRAINT "result_finalization_source_snapshot_version_check"
    CHECK ("source_snapshot_version" > 0),
  CONSTRAINT "result_finalization_source_hash_check"
    CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "result_finalization_frozen_projection_object_check"
    CHECK (jsonb_typeof("frozen_projection") = 'object'),
  CONSTRAINT "result_finalization_scope_payload_check"
    CHECK (
      (
        "scope" = 'CLASS'
        AND "class_id" IS NOT NULL
        AND "complete_xml" IS NULL
        AND "complete_xml_hash" IS NULL
      )
      OR
      (
        "scope" = 'RACE'
        AND "class_id" IS NULL
        AND "complete_xml" IS NOT NULL
        AND length("complete_xml") > 0
        AND "complete_xml_hash" IS NOT NULL
        AND "complete_xml_hash" ~ '^[a-f0-9]{64}$'
      )
    )
);

CREATE UNIQUE INDEX "result_finalization_request_uidx"
ON "result_finalization"("request_id");
CREATE UNIQUE INDEX "result_finalization_race_scope_revision_uidx"
ON "result_finalization"("race_id", "scope_revision")
WHERE "scope" = 'RACE';
CREATE UNIQUE INDEX "result_finalization_class_scope_revision_uidx"
ON "result_finalization"("class_id", "scope_revision")
WHERE "scope" = 'CLASS';
CREATE INDEX "result_finalization_race_finalized_idx"
ON "result_finalization"("race_id", "finalized_at", "id");

CREATE TRIGGER result_finalization_immutable
BEFORE UPDATE OR DELETE ON "result_finalization"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
