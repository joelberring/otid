DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'manual_course_class_create_request'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'manual_course_class_create_request'::regclass AND attname = 'class_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'manual_course_class_create_request'::regclass AND attname = 'course_version_id')
    ]::smallint[];
  IF constraint_name IS NULL THEN RAISE EXCEPTION 'TASK082 requires the TASK081 class/version journal constraint'; END IF;
  EXECUTE format('ALTER TABLE manual_course_class_create_request DROP CONSTRAINT %I', constraint_name);
END $$;
ALTER TABLE manual_course_class_create_request
  ADD CONSTRAINT manual_course_class_create_request_class_race_fk
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id);

CREATE TABLE manual_course_version_class_relink_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  course_id uuid NOT NULL,
  class_id uuid NOT NULL,
  previous_course_version_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  UNIQUE(request_id, race_id),
  FOREIGN KEY(course_id, race_id) REFERENCES course(id, race_id),
  FOREIGN KEY(previous_course_version_id, course_id) REFERENCES course_version(id, course_id),
  FOREIGN KEY(course_version_id, course_id) REFERENCES course_version(id, course_id),
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(previous_course_version_id <> course_version_id),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER manual_course_version_class_relink_request_immutable
BEFORE UPDATE OR DELETE ON manual_course_version_class_relink_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer/UI; never drop populated immutable journals or
-- course versions. Correct forward additively or restore a verified full backup.
