-- TASK301 / ADR-0167: immutable review/actor/receipt for one manual class name correction.
CREATE TABLE manual_class_name_change_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  class_id uuid NOT NULL,
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  CONSTRAINT manual_class_name_change_request_scope_uidx UNIQUE(request_id, race_id, class_id),
  CONSTRAINT manual_class_name_change_request_class_race_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT manual_class_name_change_request_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT manual_class_name_change_request_role_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT manual_class_name_change_request_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER manual_class_name_change_request_immutable
BEFORE UPDATE OR DELETE ON manual_class_name_change_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore: disable the name writer/UI before rollback. Keep this journal with
-- race, class, course_version, pairing_admin_access_credential, and audit_event
-- in a verified full PostgreSQL backup. Do not drop populated history; correct
-- forward or restore that full backup.
