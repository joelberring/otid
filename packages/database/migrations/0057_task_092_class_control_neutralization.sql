CREATE TABLE class_control_neutralization (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  class_id uuid NOT NULL,
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  course_control_id uuid NOT NULL REFERENCES course_control(id),
  sequence integer NOT NULL,
  control_code integer NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  expected_snapshot_version integer NOT NULL,
  basis_hash text NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(sequence > 0),
  CHECK(control_code > 0),
  CHECK(expected_snapshot_version > 0),
  CHECK(basis_hash ~ '^[a-f0-9]{64}$'),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object'),
  UNIQUE(class_id, course_version_id),
  UNIQUE(id, race_id, class_id, course_version_id, course_control_id, sequence, control_code)
);
CREATE INDEX class_control_neutralization_race_idx ON class_control_neutralization(race_id);

ALTER TABLE result_revision ADD COLUMN control_neutralization_id uuid;
ALTER TABLE result_revision ADD CONSTRAINT result_revision_control_neutralization_fkey
  FOREIGN KEY(control_neutralization_id) REFERENCES class_control_neutralization(id);

CREATE TRIGGER class_control_neutralization_immutable BEFORE UPDATE OR DELETE ON class_control_neutralization
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the neutralization write path. Preserve the immutable
-- decision and revision provenance; repair forward or restore a verified backup.
