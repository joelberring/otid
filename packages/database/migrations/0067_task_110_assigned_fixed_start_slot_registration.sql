-- TASK110 is append-only. A lottad startslot for a new participant has its own
-- one-to-one immutable journal; this is not a generic slot reservation table.
CREATE TABLE "entry_registration_start_slot_assignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registration_request_id" uuid NOT NULL UNIQUE REFERENCES "entry_registration_request"("id"),
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
  CONSTRAINT "entry_registration_start_slot_assignment_capability_check"
    CHECK ("capability"::text IN ('REGISTER_ENTRY', 'MANAGE_RACE')),
  CONSTRAINT "entry_registration_start_slot_assignment_source_hash_check"
    CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "entry_registration_start_slot_assignment_time_precision_check"
    CHECK (date_trunc('milliseconds', "fixed_start_time") = "fixed_start_time")
);
CREATE INDEX "entry_registration_start_slot_assignment_race_class_time_idx"
ON "entry_registration_start_slot_assignment"("race_id", "target_class_id", "fixed_start_time");
CREATE TRIGGER entry_registration_start_slot_assignment_immutable
BEFORE UPDATE OR DELETE ON "entry_registration_start_slot_assignment"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Expand-only. On incident disable the writer/UI; preserve both registration
-- journals and correct forward, or restore a verified PostgreSQL backup.
