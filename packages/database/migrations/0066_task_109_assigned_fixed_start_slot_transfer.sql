-- TASK109 is append-only.  A slot claim is evidence attached to one existing
-- transfer request; current slot occupancy is decided under the application race lock.
ALTER TABLE "class_start_draw_request"
ADD CONSTRAINT "class_start_draw_request_scope_key"
UNIQUE ("id", "race_id", "class_id", "source_hash");

CREATE TABLE "entry_start_slot_assignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_request_id" uuid NOT NULL UNIQUE REFERENCES "entry_transfer_request"("id"),
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "entry_id" uuid NOT NULL,
  "target_class_id" uuid NOT NULL,
  "draw_request_id" uuid NOT NULL,
  "source_hash" text NOT NULL,
  "fixed_start_time" timestamptz NOT NULL,
  "actor_credential_id" uuid NOT NULL,
  "capability" pairing_admin_capability NOT NULL,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("entry_id", "race_id") REFERENCES "entry"("id", "race_id"),
  FOREIGN KEY ("target_class_id", "race_id") REFERENCES "class"("id", "race_id"),
  FOREIGN KEY ("draw_request_id", "race_id", "target_class_id", "source_hash")
    REFERENCES "class_start_draw_request"("id", "race_id", "class_id", "source_hash"),
  FOREIGN KEY ("actor_credential_id", "race_id", "capability")
    REFERENCES "pairing_admin_access_credential"("id", "race_id", "capability"),
  CONSTRAINT "entry_start_slot_assignment_capability_check" CHECK ("capability"::text = 'MANAGE_RACE'),
  CONSTRAINT "entry_start_slot_assignment_source_hash_check" CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "entry_start_slot_assignment_time_precision_check"
    CHECK (date_trunc('milliseconds', "fixed_start_time") = "fixed_start_time")
);
CREATE INDEX "entry_start_slot_assignment_race_class_time_idx"
ON "entry_start_slot_assignment"("race_id", "target_class_id", "fixed_start_time");
CREATE TRIGGER entry_start_slot_assignment_immutable
BEFORE UPDATE OR DELETE ON "entry_start_slot_assignment"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only migration.  If the writer is disabled, retain transfer and slot
-- evidence, correct forward with a later immutable decision, or restore a
-- verified PostgreSQL backup containing both journals.
