ALTER TABLE class ADD COLUMN max_entries integer;
ALTER TABLE class ADD COLUMN capacity_version integer NOT NULL DEFAULT 1;
ALTER TABLE class ADD CONSTRAINT class_max_entries_check CHECK (max_entries IS NULL OR max_entries BETWEEN 0 AND 10000);
ALTER TABLE class ADD CONSTRAINT class_capacity_version_check CHECK (capacity_version > 0);
CREATE TABLE class_capacity_change_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
  race_id uuid NOT NULL REFERENCES race(id), class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL, capability pairing_admin_capability NOT NULL,
  previous_max_entries integer, max_entries integer,
  version_before integer NOT NULL, version_after integer NOT NULL, entry_count integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(class_id,race_id) REFERENCES class(id,race_id),
  FOREIGN KEY(actor_credential_id,race_id,capability) REFERENCES pairing_admin_access_credential(id,race_id,capability),
  CONSTRAINT class_capacity_role_check CHECK(capability::text = 'MANAGE_RACE'),
  CONSTRAINT class_capacity_change_check CHECK(previous_max_entries IS DISTINCT FROM max_entries),
  CONSTRAINT class_capacity_versions_check CHECK(version_before > 0 AND version_after::bigint = version_before::bigint + 1),
  CONSTRAINT class_capacity_limits_check CHECK(
    (previous_max_entries IS NULL OR previous_max_entries BETWEEN 0 AND 10000) AND
    (max_entries IS NULL OR max_entries BETWEEN 0 AND 10000) AND entry_count >= 0 AND
    (max_entries IS NULL OR entry_count <= max_entries))
);
CREATE UNIQUE INDEX class_capacity_version_uidx ON class_capacity_change_request(class_id,version_before);
CREATE TRIGGER class_capacity_immutable BEFORE UPDATE OR DELETE ON class_capacity_change_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
