CREATE TABLE manual_course_result_bearing_relink_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  course_id uuid NOT NULL,
  class_id uuid NOT NULL,
  previous_course_version_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  source_snapshot_version integer NOT NULL,
  source_hash text NOT NULL,
  frozen_basis jsonb NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  changed_at timestamptz NOT NULL,
  UNIQUE(request_id, race_id),
  FOREIGN KEY(course_id, race_id) REFERENCES course(id, race_id),
  FOREIGN KEY(previous_course_version_id, course_id) REFERENCES course_version(id, course_id),
  FOREIGN KEY(course_version_id, course_id) REFERENCES course_version(id, course_id),
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(previous_course_version_id <> course_version_id),
  CHECK(source_snapshot_version > 0),
  CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  CHECK(jsonb_typeof(frozen_basis) = 'object' AND jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER manual_course_result_bearing_relink_request_immutable
BEFORE UPDATE OR DELETE ON manual_course_result_bearing_relink_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer/UI; correct forward additively or restore a
-- verified full backup. Never drop populated immutable journals, course
-- versions, result history, or manual decisions.
