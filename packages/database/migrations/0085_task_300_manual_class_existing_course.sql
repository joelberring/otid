-- TASK300 / ADR-0166: preserve the exact actor, target, intent, and receipt.
CREATE TABLE manual_class_create_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  course_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  CONSTRAINT manual_class_create_request_scope_uidx UNIQUE(request_id, race_id),
  CONSTRAINT manual_class_create_request_course_race_fk FOREIGN KEY(course_id, race_id) REFERENCES course(id, race_id),
  CONSTRAINT manual_class_create_request_version_course_fk FOREIGN KEY(course_version_id, course_id) REFERENCES course_version(id, course_id),
  CONSTRAINT manual_class_create_request_class_race_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT manual_class_create_request_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT manual_class_create_request_role_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT manual_class_create_request_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER manual_class_create_request_immutable
BEFORE UPDATE OR DELETE ON manual_class_create_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore: keep this immutable journal with race, class, course, course_version,
-- pairing_admin_access_credential and audit_event in a verified full PostgreSQL
-- backup. If rollback is necessary, disable the writer/UI; do not drop a
-- populated journal. Correct forward or restore the verified full backup.
