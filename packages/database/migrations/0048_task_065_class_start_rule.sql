CREATE TABLE class_start_rule_change (
  request_id uuid PRIMARY KEY, race_id uuid NOT NULL, class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL, capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL, response jsonb NOT NULL,
  UNIQUE(request_id,race_id,class_id),
  FOREIGN KEY(class_id,race_id) REFERENCES class(id,race_id),
  FOREIGN KEY(actor_credential_id,race_id,capability) REFERENCES pairing_admin_access_credential(id,race_id,capability),
  CHECK(capability = 'MANAGE_RACE'),
  CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);
CREATE TABLE class_start_rule_change_item (
  request_id uuid NOT NULL, race_id uuid NOT NULL, class_id uuid NOT NULL,
  entry_id uuid NOT NULL, version_before integer NOT NULL, version_after integer NOT NULL,
  previous_fixed_start_time timestamptz, fixed_start_time timestamptz,
  PRIMARY KEY(request_id,entry_id),
  FOREIGN KEY(request_id,race_id,class_id) REFERENCES class_start_rule_change(request_id,race_id,class_id),
  FOREIGN KEY(entry_id,race_id) REFERENCES entry(id,race_id),
  CHECK(version_before > 0 AND version_after::bigint IN (version_before::bigint,version_before::bigint+1))
);
CREATE TRIGGER class_start_rule_change_immutable BEFORE UPDATE OR DELETE ON class_start_rule_change
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER class_start_rule_change_item_immutable BEFORE UPDATE OR DELETE ON class_start_rule_change_item
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Rollback: disable the writer; retain journal and readers. Use a new audited
-- change for correction. Never drop populated history; restore only a verified backup.
