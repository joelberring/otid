ALTER TABLE course ADD CONSTRAINT course_id_race_uidx UNIQUE(id, race_id);
ALTER TABLE course_version ADD CONSTRAINT course_version_id_course_uidx UNIQUE(id, course_id);
ALTER TABLE class ADD CONSTRAINT class_id_course_version_uidx UNIQUE(id, course_version_id);

CREATE TABLE manual_course_class_create_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  course_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  UNIQUE(request_id, race_id),
  FOREIGN KEY(course_id, race_id) REFERENCES course(id, race_id),
  FOREIGN KEY(course_version_id, course_id) REFERENCES course_version(id, course_id),
  FOREIGN KEY(class_id, course_version_id) REFERENCES class(id, course_version_id),
  FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER manual_course_class_create_request_immutable
BEFORE UPDATE OR DELETE ON manual_course_class_create_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER course_control_immutable
BEFORE UPDATE OR DELETE ON course_control
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer/UI; never drop populated immutable history or
-- course controls. Correct forward additively or restore a verified full backup.
