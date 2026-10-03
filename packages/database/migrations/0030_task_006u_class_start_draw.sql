ALTER TYPE "pairing_admin_capability" ADD VALUE IF NOT EXISTS 'DRAW_CLASS_START_TIMES';
ALTER TYPE "audit_actor_kind" ADD VALUE IF NOT EXISTS 'CLASS_START_DRAW_ACCESS_CREDENTIAL';

ALTER TABLE "pairing_admin_access_credential"
ADD CONSTRAINT "pairing_admin_class_start_draw_lifetime_check"
CHECK ("capability"::text <> 'DRAW_CLASS_START_TIMES' OR "expires_at" <= "issued_at" + interval '8 hours') NOT VALID;
ALTER TABLE "pairing_admin_access_credential"
VALIDATE CONSTRAINT "pairing_admin_class_start_draw_lifetime_check";

CREATE TABLE "class_start_draw_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "class_id" uuid NOT NULL REFERENCES "class"("id"),
  "actor_credential_id" uuid NOT NULL REFERENCES "pairing_admin_access_credential"("id"),
  "source_hash" text NOT NULL,
  "time_zone" text NOT NULL,
  "algorithm_version" text NOT NULL,
  "seed" bigint NOT NULL,
  "first_start_time" timestamptz NOT NULL,
  "interval_seconds" integer NOT NULL,
  "entry_count" integer NOT NULL,
  "changed_entry_count" integer NOT NULL,
  "snapshot_version_before" integer NOT NULL,
  "snapshot_version_after" integer NOT NULL,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "class_start_draw_request_source_hash_check" CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "class_start_draw_request_seed_check" CHECK ("seed" BETWEEN 1 AND 4294967295),
  CONSTRAINT "class_start_draw_request_interval_check" CHECK ("interval_seconds" BETWEEN 1 AND 3600),
  CONSTRAINT "class_start_draw_request_count_check" CHECK ("entry_count" BETWEEN 1 AND 10000 AND "changed_entry_count" BETWEEN 1 AND "entry_count"),
  CONSTRAINT "class_start_draw_request_snapshot_check" CHECK ("snapshot_version_before" > 0 AND "snapshot_version_after" = "snapshot_version_before" + 1)
);
CREATE UNIQUE INDEX "class_start_draw_request_request_uidx" ON "class_start_draw_request"("request_id");
CREATE INDEX "class_start_draw_request_race_time_idx" ON "class_start_draw_request"("race_id", "changed_at");

CREATE TABLE "class_start_draw_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "draw_request_id" uuid NOT NULL REFERENCES "class_start_draw_request"("id"),
  "entry_id" uuid NOT NULL REFERENCES "entry"("id"),
  "display_name" text NOT NULL,
  "previous_fixed_start_time" timestamptz,
  "fixed_start_time" timestamptz NOT NULL,
  "entry_version_before" integer NOT NULL,
  "entry_version_after" integer NOT NULL,
  CONSTRAINT "class_start_draw_item_version_check" CHECK ("entry_version_before" > 0 AND "entry_version_after" = "entry_version_before" + CASE WHEN "previous_fixed_start_time" IS DISTINCT FROM "fixed_start_time" THEN 1 ELSE 0 END)
);
CREATE UNIQUE INDEX "class_start_draw_item_request_entry_uidx" ON "class_start_draw_item"("draw_request_id", "entry_id");

CREATE TRIGGER class_start_draw_request_immutable
BEFORE UPDATE OR DELETE ON "class_start_draw_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER class_start_draw_item_immutable
BEFORE UPDATE OR DELETE ON "class_start_draw_item"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only migration. Incident recovery disables the writer and creates a
-- new version-bound decision or restores a verified backup; journals stay intact.
