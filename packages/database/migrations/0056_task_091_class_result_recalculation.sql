CREATE TABLE class_result_recalculation (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  expected_snapshot_version integer NOT NULL,
  expected_engine_version text NOT NULL,
  manifest_hash text NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  recalculated_at timestamptz NOT NULL,
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(expected_snapshot_version > 0),
  CHECK(length(btrim(expected_engine_version)) BETWEEN 1 AND 64),
  CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);
CREATE INDEX class_result_recalculation_race_time_idx ON class_result_recalculation(race_id, recalculated_at);
CREATE TABLE class_result_recalculation_item (
  request_id uuid NOT NULL REFERENCES class_result_recalculation(request_id),
  race_id uuid NOT NULL,
  class_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  expected_entry_version integer NOT NULL,
  expected_assignment_id uuid NOT NULL,
  expected_readout_id uuid NOT NULL,
  expected_result_revision_id uuid NOT NULL,
  expected_result_revision integer NOT NULL,
  created_result_revision_id uuid NOT NULL,
  created_result_revision integer NOT NULL,
  PRIMARY KEY(request_id, entry_id),
  UNIQUE(created_result_revision_id),
  FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  FOREIGN KEY(expected_assignment_id) REFERENCES card_assignment(id),
  FOREIGN KEY(expected_readout_id) REFERENCES card_readout(id),
  FOREIGN KEY(expected_result_revision_id) REFERENCES result_revision(id),
  FOREIGN KEY(created_result_revision_id) REFERENCES result_revision(id),
  CHECK(expected_entry_version > 0 AND expected_result_revision > 0),
  CHECK(created_result_revision = expected_result_revision + 1)
);
CREATE INDEX class_result_recalculation_item_race_entry_idx ON class_result_recalculation_item(race_id, entry_id);
CREATE TRIGGER class_result_recalculation_immutable BEFORE UPDATE OR DELETE ON class_result_recalculation
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER class_result_recalculation_item_immutable BEFORE UPDATE OR DELETE ON class_result_recalculation_item
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the protected group action. Preserve immutable group journals
-- and revisions; repair forward or restore a verified PostgreSQL backup.
