ALTER TABLE card_assignment DROP CONSTRAINT IF EXISTS card_assignment_race_id_card_number_key;
DROP INDEX IF EXISTS card_assignment_race_card_uidx;
CREATE UNIQUE INDEX card_assignment_active_race_card_uidx
  ON card_assignment(race_id, card_number) WHERE active;

CREATE TABLE entry_card_rental_reuse_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  source_entry_id uuid NOT NULL,
  source_class_id uuid NOT NULL,
  source_assignment_id uuid NOT NULL,
  card_number text NOT NULL,
  target_entry_id uuid NOT NULL,
  target_class_id uuid NOT NULL,
  target_assignment_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  source_entry_version_before integer NOT NULL,
  source_entry_version_after integer NOT NULL,
  target_entry_version_before integer NOT NULL,
  target_entry_version_after integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_card_rental_reuse_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT entry_card_rental_reuse_distinct_entries_check CHECK(source_entry_id <> target_entry_id),
  CONSTRAINT entry_card_rental_reuse_distinct_assignments_check CHECK(source_assignment_id <> target_assignment_id),
  CONSTRAINT entry_card_rental_reuse_versions_check CHECK(
    source_entry_version_before > 0 AND source_entry_version_after::bigint = source_entry_version_before::bigint + 1 AND
    target_entry_version_before > 0 AND target_entry_version_after::bigint = target_entry_version_before::bigint + 1 AND
    snapshot_version_before > 0 AND snapshot_version_after::bigint = snapshot_version_before::bigint + 1),
  CONSTRAINT entry_card_rental_reuse_source_entry_scope_fk FOREIGN KEY(source_entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT entry_card_rental_reuse_source_class_scope_fk FOREIGN KEY(source_class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT entry_card_rental_reuse_source_assignment_scope_fk FOREIGN KEY(source_assignment_id, race_id, source_entry_id, card_number) REFERENCES card_assignment(id, race_id, entry_id, card_number),
  CONSTRAINT entry_card_rental_reuse_target_entry_scope_fk FOREIGN KEY(target_entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT entry_card_rental_reuse_target_class_scope_fk FOREIGN KEY(target_class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT entry_card_rental_reuse_target_assignment_scope_fk FOREIGN KEY(target_assignment_id, race_id, target_entry_id, card_number) REFERENCES card_assignment(id, race_id, entry_id, card_number),
  CONSTRAINT entry_card_rental_reuse_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE UNIQUE INDEX entry_card_rental_reuse_source_entry_version_uidx
  ON entry_card_rental_reuse_request(source_entry_id, source_entry_version_before);
CREATE UNIQUE INDEX entry_card_rental_reuse_target_entry_version_uidx
  ON entry_card_rental_reuse_request(target_entry_id, target_entry_version_before);
CREATE INDEX entry_card_rental_reuse_race_time_idx ON entry_card_rental_reuse_request(race_id, changed_at);
CREATE TRIGGER entry_card_rental_reuse_request_immutable BEFORE UPDATE OR DELETE ON entry_card_rental_reuse_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the reuse writer and UI, retain the active-card index,
-- assignments and immutable history, then correct forward additively or restore
-- a verified full backup. Never drop card history in a populated environment.
